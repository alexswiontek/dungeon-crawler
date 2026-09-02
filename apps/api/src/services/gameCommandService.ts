import { randomBytes, randomUUID } from 'node:crypto';
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
  LeaderboardDelivery,
  LeaderboardDoc,
  StoredGameDocument,
} from '@/types/database.js';
import { GameServiceError } from '@/types/gameServiceErrors.js';
import { logger as defaultLogger } from '@/utils/logger.js';

export const ACTION_RECEIPT_LIMIT = 16;
export const DURABLE_WRITE_CONCERN = {
  w: 'majority' as const,
  j: true,
};

interface ServiceLogger {
  info(object: object, message?: string): void;
  warn(object: object, message?: string): void;
  error(object: object, message?: string): void;
}

export interface GameCommandServiceDependencies {
  getDatabase: () => Db;
  now: () => Date;
  createId: () => string;
  createToken: () => string;
  createSeed: () => string;
  logger: ServiceLogger;
  applyTransition: typeof reduceGame;
}

const defaultDependencies: GameCommandServiceDependencies = {
  getDatabase: getDb,
  now: () => new Date(),
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
  return receipt.result;
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

export function createGameCommandService(
  overrides: Partial<GameCommandServiceDependencies> = {},
) {
  const dependencies = { ...defaultDependencies, ...overrides };
  const games = () =>
    dependencies.getDatabase().collection<StoredGameDocument>('games');

  async function findGame(gameId: string): Promise<StoredGameDocument> {
    let document: StoredGameDocument | null;
    try {
      document = await games().findOne({ _id: gameId });
    } catch (error) {
      dependencies.logger.error({ err: error, gameId }, 'Game read failed');
      throw databaseFailure();
    }
    if (!document) {
      throw new GameServiceError('GAME_NOT_FOUND', 'Game not found');
    }
    return document;
  }

  async function deliverLeaderboard(gameId: string): Promise<void> {
    const document = await games().findOne({ _id: gameId });
    if (!document || document.leaderboard.status !== 'pending') return;

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
        { err: error, gameId },
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
      dependencies.logger.error({ err: error, gameId }, 'Game creation failed');
      throw databaseFailure();
    }

    const state = projectGameState(game, 0);
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

  async function executeGameCommand(
    request: ExecuteGameCommandRequest,
  ): Promise<GameCommandResult> {
    const document = await findGame(request.gameId);
    authenticate(document, request.sessionToken);

    const cached = receiptResult(document, request);
    if (cached) {
      void tryDeliverLeaderboard(request.gameId);
      return cached;
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
        { err: error, gameId: request.gameId, actionId: request.actionId },
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
      expectedRevision: request.expectedRevision,
      command: request.command,
      result,
      recordedAt: dependencies.now(),
    };
    const nextDocument: StoredGameDocument = {
      ...document,
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
        if (concurrentRetry) return concurrentRetry;
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
        if (concurrentRetry) return concurrentRetry;
        throw new GameServiceError(
          'ACTION_ID_REUSED',
          'This action ID was already used for a different request',
          { actionId: request.actionId },
        );
      }
      dependencies.logger.error(
        {
          err: error,
          gameId: request.gameId,
          actionId: request.actionId,
          expectedRevision: request.expectedRevision,
        },
        'Durable command write failed',
      );
      throw databaseFailure();
    }

    dependencies.logger.info(
      {
        gameId: request.gameId,
        actionId: request.actionId,
        revision,
        commandType: request.command.type,
      },
      'Game command committed',
    );
    void tryDeliverLeaderboard(request.gameId);
    return result;
  }

  async function deleteGame(
    gameId: string,
    sessionToken: string,
  ): Promise<void> {
    const document = await findGame(gameId);
    authenticate(document, sessionToken);
    if (document.leaderboard.status === 'pending') {
      try {
        await deliverLeaderboard(gameId);
      } catch (error) {
        dependencies.logger.error(
          { err: error, gameId },
          'Cannot delete game before pending leaderboard delivery',
        );
        throw databaseFailure();
      }
    }
    try {
      const result = await games().deleteOne(
        { _id: gameId, sessionTokenHash: document.sessionTokenHash },
        { writeConcern: DURABLE_WRITE_CONCERN },
      );
      if (result.deletedCount === 0) {
        throw new GameServiceError('GAME_NOT_FOUND', 'Game not found');
      }
    } catch (error) {
      if (error instanceof GameServiceError) throw error;
      dependencies.logger.error({ err: error, gameId }, 'Game deletion failed');
      throw databaseFailure();
    }
  }

  async function reconcilePendingLeaderboards(): Promise<number> {
    const pending = await games()
      .find({ 'leaderboard.status': 'pending' }, { projection: { _id: 1 } })
      .toArray();
    const results = await Promise.allSettled(
      pending.map((document) => deliverLeaderboard(document._id)),
    );
    return results.filter((result) => result.status === 'fulfilled').length;
  }

  return {
    createGameSession,
    readGame,
    executeGameCommand,
    deleteGame,
    deliverLeaderboard,
    reconcilePendingLeaderboards,
  };
}

const service = createGameCommandService();

export const createGameSession = service.createGameSession;
export const readGame = service.readGame;
export const executeGameCommand = service.executeGameCommand;
export const deleteGame = service.deleteGame;
export const reconcilePendingLeaderboards =
  service.reconcilePendingLeaderboards;

let reconciliationInterval: NodeJS.Timeout | null = null;

export function startLeaderboardReconciliation(): void {
  if (reconciliationInterval) return;
  void reconcilePendingLeaderboards().catch((error) => {
    defaultLogger.error({ err: error }, 'Leaderboard reconciliation failed');
  });
  reconciliationInterval = setInterval(() => {
    void reconcilePendingLeaderboards().catch((error) => {
      defaultLogger.error({ err: error }, 'Leaderboard reconciliation failed');
    });
  }, 60_000);
}

export function stopLeaderboardReconciliation(): void {
  if (!reconciliationInterval) return;
  clearInterval(reconciliationInterval);
  reconciliationInterval = null;
}
