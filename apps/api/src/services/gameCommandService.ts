import { randomBytes, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import {
  createGame,
  createSeededRandom,
  type GameCommand,
  type GameEvent,
  type GameState,
  isPlayerDiedEvent,
  reduceGame,
  type StatefulRandomSource,
} from '@dungeon-crawler/domain';
import {
  diffClientProjections,
  type ExecuteGameCommandRequest,
  type GameCommandResult,
  type GameErrorCode,
  type GameStateResponse,
  type NewGameRequest,
  type NewGameResponse,
  projectGameState,
} from '@dungeon-crawler/protocol';
import type { Db, MongoServerError } from 'mongodb';
import { getDb } from '@/services/database.js';
import {
  createSessionToken,
  hashSessionToken,
  sessionTokenMatches,
} from '@/services/sessionToken.js';
import type {
  GameActionReceipt,
  LegacyGameDocument,
  LeaderboardDelivery,
  LeaderboardDoc,
  StoredGameDocument,
} from '@/types/database.js';
import { GameServiceError } from '@/types/gameServiceErrors.js';
import { logger as defaultLogger } from '@/utils/logger.js';

export const ACTION_RECEIPT_LIMIT = 16;
export const LEADERBOARD_RECONCILIATION_BATCH_SIZE = 100;
export const LEADERBOARD_RECONCILIATION_CONCURRENCY = 5;
export const DURABLE_WRITE_CONCERN = {
  w: 'majority' as const,
  j: true,
};

interface ServiceLogger {
  info(object: object, message?: string): void;
  warn(object: object, message?: string): void;
  error(object: object, message?: string): void;
}

type GameCommandOutcome =
  | 'committed'
  | 'exact_retry'
  | 'invalid_command'
  | 'revision_conflict'
  | 'action_id_reused'
  | 'game_finished'
  | 'unauthorized'
  | 'game_not_found'
  | 'rate_limited'
  | 'database_failure'
  | 'rejected'
  | 'internal_failure';

const COMMAND_OUTCOME_BY_ERROR_CODE = {
  INVALID_COMMAND: 'invalid_command',
  REVISION_CONFLICT: 'revision_conflict',
  ACTION_ID_REUSED: 'action_id_reused',
  GAME_FINISHED: 'game_finished',
  UNAUTHORIZED: 'unauthorized',
  GAME_NOT_FOUND: 'game_not_found',
  RATE_LIMITED: 'rate_limited',
  DATABASE_UNAVAILABLE: 'database_failure',
  DATABASE_ERROR: 'database_failure',
  INVALID_PLAYER_NAME: 'rejected',
  PROTOCOL_MISMATCH: 'rejected',
} satisfies Record<GameErrorCode, GameCommandOutcome>;

export interface GameCommandServiceDependencies {
  getDatabase: () => Db;
  now: () => Date;
  monotonicNow: () => number;
  createId: () => string;
  createToken: () => string;
  createSeed: () => string;
  logger: ServiceLogger;
  applyTransition: typeof reduceGame;
}

const defaultDependencies: GameCommandServiceDependencies = {
  getDatabase: getDb,
  now: () => new Date(),
  monotonicNow: () => performance.now(),
  createId: randomUUID,
  createToken: createSessionToken,
  createSeed: () => randomBytes(32).toString('base64url'),
  logger: defaultLogger,
  applyTransition: reduceGame,
};

function cloneGame(game: GameState): GameState {
  return structuredClone(game);
}

function requestFingerprint(
  expectedRevision: number,
  command: GameCommand,
): string {
  switch (command.type) {
    case 'move':
      return `${expectedRevision}:move:${command.direction}`;
    case 'attack':
      return `${expectedRevision}:attack`;
    case 'descend':
      return `${expectedRevision}:descend`;
  }
}

function duplicateKey(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as MongoServerError).code === 11000
  );
}

function authenticate(
  document: StoredGameDocument,
  sessionToken: string,
): void {
  if (
    !sessionToken ||
    !sessionTokenMatches(sessionToken, document.sessionTokenHash)
  ) {
    throw new GameServiceError('UNAUTHORIZED', 'Invalid game credentials');
  }
}

function receiptResult(
  document: StoredGameDocument,
  request: ExecuteGameCommandRequest,
): GameCommandResult | undefined {
  const receipt = document.actionReceipts.find(
    (candidate) => candidate.actionId === request.actionId,
  );
  if (!receipt) return undefined;

  const fingerprint = requestFingerprint(
    request.expectedRevision,
    request.command,
  );
  if (receipt.requestFingerprint !== fingerprint) {
    throw new GameServiceError(
      'ACTION_ID_REUSED',
      'This action ID was already used for a different request',
      { actionId: request.actionId },
    );
  }
  return {
    actionId: receipt.actionId,
    revision: document.revision,
    state: projectGameState(document.game, document.revision),
    events: receipt.events,
    deltas: receipt.revision === document.revision ? receipt.deltas : [],
  };
}

function leaderboardDelivery(
  game: GameState,
  events: GameEvent[],
  finishedAt: Date,
): LeaderboardDelivery {
  if (game.status === 'active') return { status: 'none' };
  const death = events.find(isPlayerDiedEvent);
  return {
    status: 'pending',
    outcome: {
      playerName: game.playerName,
      score: game.score,
      floor: game.floor,
      killedBy: death?.data.killedBy ?? null,
      killedByType: death?.data.killedByType ?? null,
      killedByVariant: death?.data.killedByVariant ?? null,
      finishedAt,
    },
  };
}

function databaseFailure(): GameServiceError {
  return new GameServiceError(
    'DATABASE_ERROR',
    'Game progress could not be saved. Please try again.',
  );
}

function databaseErrorMetadata(error: unknown): {
  databaseErrorName: string;
  databaseErrorCode?: string | number;
} {
  const databaseErrorName =
    error instanceof Error ? error.name : 'UnknownDatabaseError';
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return { databaseErrorName };
  }
  const code = error.code;
  return typeof code === 'string' || typeof code === 'number'
    ? { databaseErrorName, databaseErrorCode: code }
    : { databaseErrorName };
}

function commandOutcomeForError(error: unknown): GameCommandOutcome {
  if (!(error instanceof GameServiceError)) return 'internal_failure';
  return COMMAND_OUTCOME_BY_ERROR_CODE[error.code];
}

function elapsedMilliseconds(startedAt: number, finishedAt: number): number {
  const duration = finishedAt - startedAt;
  return Number.isFinite(duration) && duration >= 0 ? duration : 0;
}

interface CommandExecution {
  result: GameCommandResult;
  outcome: 'committed' | 'exact_retry';
}

export function createGameCommandService(
  overrides: Partial<GameCommandServiceDependencies> = {},
) {
  const dependencies = { ...defaultDependencies, ...overrides };
  const games = () =>
    dependencies.getDatabase().collection<StoredGameDocument>('games');
  let reconciliationInFlight: Promise<number> | null = null;

  async function findGame(gameId: string): Promise<StoredGameDocument> {
    let document: StoredGameDocument | null;
    try {
      document = await games().findOne({ _id: gameId });
    } catch (error) {
      dependencies.logger.error(
        { ...databaseErrorMetadata(error), gameId },
        'Game read failed',
      );
      throw databaseFailure();
    }
    if (!document) {
      throw new GameServiceError('GAME_NOT_FOUND', 'Game not found');
    }
    return document;
  }

  async function deliverLeaderboard(gameId: string): Promise<void> {
    const document = await games().findOne({ _id: gameId });
    if (document?.leaderboard.status !== 'pending') return;

    const outcome = document.leaderboard.outcome;
    const entry: LeaderboardDoc = {
      _id: gameId,
      playerName: outcome.playerName,
      score: outcome.score,
      floor: outcome.floor,
      killedBy: outcome.killedBy,
      killedByType: outcome.killedByType,
      killedByVariant: outcome.killedByVariant,
      createdAt: outcome.finishedAt,
    };
    const insertOnlyFields: Omit<LeaderboardDoc, '_id'> = {
      playerName: entry.playerName,
      score: entry.score,
      floor: entry.floor,
      killedBy: entry.killedBy,
      killedByType: entry.killedByType,
      killedByVariant: entry.killedByVariant,
      createdAt: entry.createdAt,
    };

    await dependencies
      .getDatabase()
      .collection<LeaderboardDoc>('leaderboard')
      .updateOne(
        { _id: gameId },
        { $setOnInsert: insertOnlyFields },
        { upsert: true, writeConcern: DURABLE_WRITE_CONCERN },
      );
    await games().updateOne(
      { _id: gameId, 'leaderboard.status': 'pending' },
      { $set: { 'leaderboard.status': 'submitted' } },
      { writeConcern: DURABLE_WRITE_CONCERN },
    );
  }

  async function tryDeliverLeaderboard(gameId: string): Promise<void> {
    try {
      await deliverLeaderboard(gameId);
    } catch (error) {
      dependencies.logger.error(
        { ...databaseErrorMetadata(error), gameId },
        'Leaderboard delivery deferred',
      );
    }
  }

  async function createGameSession(
    input: NewGameRequest,
  ): Promise<NewGameResponse> {
    const sessionToken = dependencies.createToken();
    const seed = dependencies.createSeed();
    const random = createSeededRandom(seed);
    const gameId = dependencies.createId();
    const now = dependencies.now();
    const game = createGame(
      {
        gameId,
        playerId: dependencies.createId(),
        playerName: input.playerName,
        character: input.character,
      },
      { clock: { now: () => new Date(now) }, random },
    );
    const document: StoredGameDocument = {
      _id: gameId,
      schemaVersion: 1,
      sessionTokenHash: hashSessionToken(sessionToken),
      revision: 0,
      random: { seed, state: random.snapshot() },
      game,
      actionReceipts: [],
      leaderboard: { status: 'none' },
      updatedAt: now,
    };

    try {
      await games().insertOne(document, {
        writeConcern: DURABLE_WRITE_CONCERN,
      });
    } catch (error) {
      dependencies.logger.error(
        { ...databaseErrorMetadata(error), gameId },
        'Game creation failed',
      );
      throw databaseFailure();
    }

    const state = projectGameState(game, 0);
    return { gameId, sessionToken, revision: 0, state };
  }

  async function migrateLegacyGame(gameId: string): Promise<NewGameResponse> {
    const sessionToken = dependencies.createToken();
    const seed = dependencies.createSeed();
    const random = createSeededRandom(seed);
    const legacy = await dependencies
      .getDatabase()
      .collection<LegacyGameDocument>('games')
      .findOne({
        _id: gameId,
        sessionTokenHash: { $exists: false },
        game: { $exists: false },
      } as never);
    if (!legacy) {
      throw new GameServiceError(
        'GAME_NOT_FOUND',
        'Legacy game not found or already migrated',
      );
    }
    if (legacy.status !== 'active') {
      throw new GameServiceError('GAME_FINISHED', 'Game is already finished');
    }

    const document: StoredGameDocument = {
      _id: gameId,
      schemaVersion: 1,
      sessionTokenHash: hashSessionToken(sessionToken),
      revision: 0,
      random: { seed, state: random.snapshot() },
      game: cloneGame(legacy),
      actionReceipts: [],
      leaderboard: { status: 'none' },
      updatedAt: legacy.updatedAt,
    };
    let migrated: { matchedCount: number };
    try {
      migrated = await dependencies
        .getDatabase()
        .collection<StoredGameDocument>('games')
        .replaceOne(
          {
            _id: gameId,
            sessionTokenHash: { $exists: false },
            game: { $exists: false },
          } as never,
          document,
          { writeConcern: DURABLE_WRITE_CONCERN },
        );
    } catch (error) {
      dependencies.logger.error(
        { ...databaseErrorMetadata(error), gameId },
        'Legacy game migration failed',
      );
      throw databaseFailure();
    }
    if (migrated.matchedCount === 0) {
      throw new GameServiceError(
        'GAME_NOT_FOUND',
        'Legacy game not found or already migrated',
      );
    }
    const state = projectGameState(document.game, 0);
    return { gameId, sessionToken, revision: 0, state };
  }

  async function readGame(
    gameId: string,
    sessionToken: string,
  ): Promise<GameStateResponse> {
    const document = await findGame(gameId);
    authenticate(document, sessionToken);
    void tryDeliverLeaderboard(gameId);
    const state = projectGameState(document.game, document.revision);
    return { revision: document.revision, state };
  }

  async function executeGameCommandCore(
    request: ExecuteGameCommandRequest,
  ): Promise<CommandExecution> {
    const document = await findGame(request.gameId);
    authenticate(document, request.sessionToken);

    const cached = receiptResult(document, request);
    if (cached) {
      void tryDeliverLeaderboard(request.gameId);
      return { result: cached, outcome: 'exact_retry' };
    }

    let actionOwner: StoredGameDocument | null;
    try {
      actionOwner = await games().findOne(
        {
          _id: { $ne: request.gameId },
          'actionReceipts.actionId': request.actionId,
        },
        { projection: { _id: 1 } },
      );
    } catch (error) {
      dependencies.logger.error(
        {
          ...databaseErrorMetadata(error),
          gameId: request.gameId,
          actionId: request.actionId,
        },
        'Action identity lookup failed',
      );
      throw databaseFailure();
    }
    if (actionOwner) {
      throw new GameServiceError(
        'ACTION_ID_REUSED',
        'This action ID was already used for a different game',
        { actionId: request.actionId },
      );
    }

    if (document.game.status !== 'active') {
      throw new GameServiceError('GAME_FINISHED', 'Game is already finished', {
        actionId: request.actionId,
        revision: document.revision,
        state: projectGameState(document.game, document.revision),
      });
    }
    if (document.revision !== request.expectedRevision) {
      throw new GameServiceError(
        'REVISION_CONFLICT',
        'Game state changed; synchronize and try a new action',
        {
          actionId: request.actionId,
          revision: document.revision,
          state: projectGameState(document.game, document.revision),
        },
      );
    }

    const nextGame = cloneGame(document.game);
    const random: StatefulRandomSource = createSeededRandom(
      document.random.seed,
      document.random.state,
    );
    const before = projectGameState(document.game, document.revision);
    const transition = dependencies.applyTransition(nextGame, request.command, {
      clock: { now: dependencies.now },
      random,
    });
    if (!transition.accepted) {
      throw new GameServiceError(
        'INVALID_COMMAND',
        'The command is not valid for the current game state',
        {
          actionId: request.actionId,
          revision: document.revision,
          state: before,
        },
      );
    }

    const revision = document.revision + 1;
    const state = projectGameState(transition.state, revision);
    const result: GameCommandResult = {
      actionId: request.actionId,
      revision,
      state,
      events: transition.events,
      deltas: diffClientProjections(before, state, transition.events),
    };
    const receipt: GameActionReceipt = {
      actionId: request.actionId,
      requestFingerprint: requestFingerprint(
        request.expectedRevision,
        request.command,
      ),
      revision,
      events: result.events,
      deltas: result.deltas,
      recordedAt: dependencies.now(),
    };
    const nextDocument: StoredGameDocument = {
      ...document,
      schemaVersion: 1,
      revision,
      random: { seed: document.random.seed, state: random.snapshot() },
      game: transition.state,
      actionReceipts: [
        ...document.actionReceipts.slice(-(ACTION_RECEIPT_LIMIT - 1)),
        receipt,
      ],
      leaderboard:
        document.leaderboard.status === 'none'
          ? leaderboardDelivery(
              transition.state,
              transition.events,
              dependencies.now(),
            )
          : document.leaderboard,
      updatedAt: transition.state.updatedAt,
    };

    try {
      const write = await games().replaceOne(
        { _id: request.gameId, revision: request.expectedRevision },
        nextDocument,
        { writeConcern: DURABLE_WRITE_CONCERN },
      );
      if (write.matchedCount === 0) {
        const current = await findGame(request.gameId);
        authenticate(current, request.sessionToken);
        const concurrentRetry = receiptResult(current, request);
        if (concurrentRetry) {
          return { result: concurrentRetry, outcome: 'exact_retry' };
        }
        throw new GameServiceError(
          'REVISION_CONFLICT',
          'Game state changed; synchronize and try a new action',
          {
            actionId: request.actionId,
            revision: current.revision,
            state: projectGameState(current.game, current.revision),
          },
        );
      }
    } catch (error) {
      if (error instanceof GameServiceError) throw error;
      if (duplicateKey(error)) {
        const current = await findGame(request.gameId);
        const concurrentRetry = receiptResult(current, request);
        if (concurrentRetry) {
          return { result: concurrentRetry, outcome: 'exact_retry' };
        }
        throw new GameServiceError(
          'ACTION_ID_REUSED',
          'This action ID was already used for a different request',
          { actionId: request.actionId },
        );
      }
      dependencies.logger.error(
        {
          ...databaseErrorMetadata(error),
          gameId: request.gameId,
          actionId: request.actionId,
          expectedRevision: request.expectedRevision,
        },
        'Durable command write failed',
      );
      throw databaseFailure();
    }

    void tryDeliverLeaderboard(request.gameId);
    return { result, outcome: 'committed' };
  }

  async function executeGameCommand(
    request: ExecuteGameCommandRequest,
  ): Promise<GameCommandResult> {
    const startedAt = dependencies.monotonicNow();
    try {
      const execution = await executeGameCommandCore(request);
      dependencies.logger.info(
        {
          gameId: request.gameId,
          actionId: request.actionId,
          expectedRevision: request.expectedRevision,
          commandType: request.command.type,
          durationMs: elapsedMilliseconds(
            startedAt,
            dependencies.monotonicNow(),
          ),
          outcome: execution.outcome,
          revision: execution.result.revision,
        },
        'Game command outcome',
      );
      return execution.result;
    } catch (error) {
      const outcome = commandOutcomeForError(error);
      const publicError = error instanceof GameServiceError ? error : undefined;
      const record = {
        gameId: request.gameId,
        actionId: request.actionId,
        expectedRevision: request.expectedRevision,
        commandType: request.command.type,
        durationMs: elapsedMilliseconds(startedAt, dependencies.monotonicNow()),
        outcome,
        ...(publicError ? { errorCode: publicError.code } : {}),
        ...(publicError?.safeContext?.revision !== undefined
          ? { revision: publicError.safeContext.revision }
          : {}),
      };
      const message = 'Game command outcome';
      if (outcome === 'database_failure' || outcome === 'internal_failure') {
        dependencies.logger.error(record, message);
      } else {
        dependencies.logger.info(record, message);
      }
      throw error;
    }
  }

  async function deleteGame(
    gameId: string,
    sessionToken: string,
  ): Promise<void> {
    const document = await findGame(gameId);
    authenticate(document, sessionToken);
    if (document.game.status !== 'active') {
      void tryDeliverLeaderboard(gameId);
      throw new GameServiceError('GAME_FINISHED', 'Game is already finished', {
        revision: document.revision,
        state: projectGameState(document.game, document.revision),
      });
    }
    try {
      const result = await games().deleteOne(
        {
          _id: gameId,
          sessionTokenHash: document.sessionTokenHash,
          revision: document.revision,
          'game.status': 'active',
          'leaderboard.status': 'none',
        },
        { writeConcern: DURABLE_WRITE_CONCERN },
      );
      if (result.deletedCount === 0) {
        const current = await findGame(gameId);
        authenticate(current, sessionToken);
        if (current.game.status !== 'active') {
          void tryDeliverLeaderboard(gameId);
          throw new GameServiceError(
            'GAME_FINISHED',
            'Game is already finished',
            {
              revision: current.revision,
              state: projectGameState(current.game, current.revision),
            },
          );
        }
        throw new GameServiceError(
          'REVISION_CONFLICT',
          'Game state changed; synchronize before abandoning',
          {
            revision: current.revision,
            state: projectGameState(current.game, current.revision),
          },
        );
      }
    } catch (error) {
      if (error instanceof GameServiceError) throw error;
      dependencies.logger.error(
        { ...databaseErrorMetadata(error), gameId },
        'Game deletion failed',
      );
      throw databaseFailure();
    }
  }

  function reconcilePendingLeaderboards(): Promise<number> {
    if (reconciliationInFlight) return reconciliationInFlight;
    const run = (async () => {
      const pending = await games()
        .find({ 'leaderboard.status': 'pending' }, { projection: { _id: 1 } })
        .limit(LEADERBOARD_RECONCILIATION_BATCH_SIZE)
        .toArray();
      let next = 0;
      const worker = async (): Promise<number> => {
        let delivered = 0;
        while (next < pending.length) {
          const document = pending[next++];
          if (!document) break;
          try {
            await deliverLeaderboard(document._id);
            delivered += 1;
          } catch {
            // Failed deliveries remain pending for a later bounded pass.
          }
        }
        return delivered;
      };
      const workers = Array.from(
        {
          length: Math.min(
            LEADERBOARD_RECONCILIATION_CONCURRENCY,
            pending.length,
          ),
        },
        worker,
      );
      const counts = await Promise.all(workers);
      return counts.reduce((total, count) => total + count, 0);
    })();
    reconciliationInFlight = run;
    void run.then(
      () => {
        if (reconciliationInFlight === run) reconciliationInFlight = null;
      },
      () => {
        if (reconciliationInFlight === run) reconciliationInFlight = null;
      },
    );
    return run;
  }

  return {
    createGameSession,
    migrateLegacyGame,
    readGame,
    executeGameCommand,
    deleteGame,
    deliverLeaderboard,
    reconcilePendingLeaderboards,
  };
}

const service = createGameCommandService();

export const createGameSession = service.createGameSession;
export const migrateLegacyGame = service.migrateLegacyGame;
export const readGame = service.readGame;
export const executeGameCommand = service.executeGameCommand;
export const deleteGame = service.deleteGame;
export const reconcilePendingLeaderboards =
  service.reconcilePendingLeaderboards;

let reconciliationInterval: NodeJS.Timeout | null = null;

export function startLeaderboardReconciliation(): void {
  if (reconciliationInterval) return;
  void reconcilePendingLeaderboards().catch((error) => {
    defaultLogger.error(
      databaseErrorMetadata(error),
      'Leaderboard reconciliation failed',
    );
  });
  reconciliationInterval = setInterval(() => {
    void reconcilePendingLeaderboards().catch((error) => {
      defaultLogger.error(
        databaseErrorMetadata(error),
        'Leaderboard reconciliation failed',
      );
    });
  }, 60_000);
}

export function stopLeaderboardReconciliation(): void {
  if (!reconciliationInterval) return;
  clearInterval(reconciliationInterval);
  reconciliationInterval = null;
}
