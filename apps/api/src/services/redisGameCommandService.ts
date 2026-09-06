import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import {
  type GameEvent,
  type GameState,
  isPlayerDiedEvent,
} from '@dungeon-crawler/domain/model';
import { createSeededRandom } from '@dungeon-crawler/domain/random';
import { createGame, reduceGame } from '@dungeon-crawler/domain/transition';
import {
  diffClientProjections,
  projectGameState,
} from '@dungeon-crawler/protocol/client-projection';
import {
  type ExecuteGameCommandRequest,
  type GameCommandResult,
  GameCommandSchema,
  GAMEPLAY_PROTOCOL_VERSION,
  type GameStateResponse,
  type NewGameRequest,
  type NewGameResponse,
} from '@dungeon-crawler/protocol/schemas';
import type { Db } from 'mongodb';
import { getDb } from '@/services/database.js';
import {
  GAME_REDUCER_VERSION,
  type GameJournal,
  type GameJournalEntry,
  type JournalCommitResult,
  type LoadedGameJournal,
  RedisGameJournal,
} from '@/services/gameJournal.js';
import { getRedis } from '@/services/redis.js';
import {
  createSessionToken,
  hashSessionToken,
  sessionTokenMatches,
} from '@/services/sessionToken.js';
import type {
  GameActionReceipt,
  LeaderboardDelivery,
  LeaderboardDoc,
  LegacyGameDocument,
  StoredGameDocument,
} from '@/types/database.js';
import { GameServiceError } from '@/types/gameServiceErrors.js';
import { WARM_GAME_CACHE_LIMIT } from '@/utils/constants.js';
import { logger as defaultLogger } from '@/utils/logger.js';

const ACTION_RECEIPT_LIMIT = 16;
const CHECKPOINT_RETRY_DELAY_MS = 1_000;
const CHECKPOINT_FLUSH_TIMEOUT_MS = 5_000;
const DEFAULT_CHECKPOINT_COMMAND_INTERVAL = 20;
const DEFAULT_CHECKPOINT_TIME_INTERVAL_MS = 30_000;
const DURABLE_WRITE_CONCERN = { w: 'majority' as const, j: true };

interface ServiceLogger {
  info(object: object, message?: string): void;
  warn(object: object, message?: string): void;
  error(object: object, message?: string): void;
}

interface WarmGame {
  document: StoredGameDocument;
  checkpointRevision: number;
}

interface PendingCheckpoint {
  document: StoredGameDocument;
  enqueuedAt: number;
}

export interface RedisGameCommandServiceDependencies {
  getDatabase: () => Db;
  getJournal: () => GameJournal;
  now: () => Date;
  monotonicNow: () => number;
  createId: () => string;
  createToken: () => string;
  createSeed: () => string;
  logger: ServiceLogger;
  applyTransition: typeof reduceGame;
  scheduleRetry: (callback: () => void, delayMs: number) => void;
  checkpointCommandInterval: number;
  checkpointTimeIntervalMs: number;
  warmGameCacheLimit: number;
}

function positiveIntegerEnvironment(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

const defaultDependencies: RedisGameCommandServiceDependencies = {
  getDatabase: getDb,
  getJournal: () => new RedisGameJournal(getRedis()),
  now: () => new Date(),
  monotonicNow: () => performance.now(),
  createId: randomUUID,
  createToken: createSessionToken,
  createSeed: () => randomBytes(32).toString('base64url'),
  logger: defaultLogger,
  applyTransition: reduceGame,
  scheduleRetry: (callback, delayMs) => {
    const timer = setTimeout(callback, delayMs);
    timer.unref();
  },
  checkpointCommandInterval: positiveIntegerEnvironment(
    'CHECKPOINT_COMMAND_INTERVAL',
    DEFAULT_CHECKPOINT_COMMAND_INTERVAL,
  ),
  checkpointTimeIntervalMs: positiveIntegerEnvironment(
    'CHECKPOINT_TIME_INTERVAL_MS',
    DEFAULT_CHECKPOINT_TIME_INTERVAL_MS,
  ),
  warmGameCacheLimit: WARM_GAME_CACHE_LIMIT,
};

function cloneDocument(document: StoredGameDocument): StoredGameDocument {
  return structuredClone(document);
}

function requestFingerprint(request: ExecuteGameCommandRequest): string {
  switch (request.command.type) {
    case 'move':
      return `${request.expectedRevision}:move:${request.command.direction}`;
    case 'attack':
      return `${request.expectedRevision}:attack`;
    case 'descend':
      return `${request.expectedRevision}:descend`;
  }
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
  if (receipt.requestFingerprint !== requestFingerprint(request)) {
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

function serviceUnavailable(
  message = 'Game commands are temporarily unavailable',
): GameServiceError {
  return new GameServiceError('SERVICE_UNAVAILABLE', message);
}

function databaseFailure(
  message = 'Game progress could not be loaded. Please try again.',
): GameServiceError {
  return new GameServiceError('DATABASE_ERROR', message);
}

function errorMetadata(error: unknown): {
  errorName: string;
  errorCode?: string | number;
} {
  const errorName = error instanceof Error ? error.name : 'UnknownError';
  if (typeof error !== 'object' || error === null || !('code' in error))
    return { errorName };
  const code = error.code;
  return typeof code === 'string' || typeof code === 'number'
    ? { errorName, errorCode: code }
    : { errorName };
}

function elapsed(startedAt: number, finishedAt: number): number {
  const duration = finishedAt - startedAt;
  return Number.isFinite(duration) && duration >= 0 ? duration : 0;
}

function sameRandomState(
  left: StoredGameDocument['random']['state'],
  right: StoredGameDocument['random']['state'],
): boolean {
  return left.state === right.state && left.idSequence === right.idSequence;
}

function gameStateHash(game: GameState): string {
  return createHash('sha256').update(JSON.stringify(game)).digest('base64url');
}

function mergeReceipts(
  checkpointReceipts: GameActionReceipt[],
  journalReceipts: GameActionReceipt[],
): GameActionReceipt[] {
  const receipts = new Map<string, GameActionReceipt>();
  for (const receipt of [...checkpointReceipts, ...journalReceipts]) {
    receipts.set(receipt.actionId, receipt);
  }
  return [...receipts.values()]
    .sort((left, right) => left.revision - right.revision)
    .slice(-ACTION_RECEIPT_LIMIT);
}

function validReceipt(receipt: unknown, maximumRevision: number): boolean {
  if (typeof receipt !== 'object' || receipt === null) return false;
  const candidate = receipt as Partial<GameActionReceipt>;
  return (
    typeof candidate.actionId === 'string' &&
    candidate.actionId.length > 0 &&
    typeof candidate.requestFingerprint === 'string' &&
    Number.isInteger(candidate.revision) &&
    (candidate.revision ?? -1) >= 0 &&
    (candidate.revision ?? Number.POSITIVE_INFINITY) <= maximumRevision &&
    candidate.recordedAt instanceof Date &&
    Number.isFinite(candidate.recordedAt.getTime())
  );
}

export function createRedisGameCommandService(
  overrides: Partial<RedisGameCommandServiceDependencies> = {},
) {
  const dependencies = { ...defaultDependencies, ...overrides };
  const cache = new Map<string, WarmGame>();
  const hydration = new Map<string, Promise<WarmGame>>();
  // Eviction only costs a rehydration: hydrateUncached rebuilds any game from
  // its MongoDB checkpoint plus the Redis journal.
  function remember(gameId: string, warm: WarmGame): WarmGame {
    cache.delete(gameId);
    cache.set(gameId, warm);
    while (cache.size > dependencies.warmGameCacheLimit) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
    return warm;
  }
  const serialization = new Map<string, Promise<void>>();
  const pendingCheckpoints = new Map<string, PendingCheckpoint>();
  const checkpointTimers = new Map<string, NodeJS.Timeout>();
  let checkpointRun: Promise<void> | null = null;
  let checkpointRetryScheduled = false;
  let reconciliationInFlight: Promise<number> | null = null;
  let redisErrorCount = 0;
  let mongoErrorCount = 0;

  const games = () =>
    dependencies.getDatabase().collection<StoredGameDocument>('games');

  function logRedisError(
    error: unknown,
    context: object,
    message: string,
  ): void {
    redisErrorCount += 1;
    dependencies.logger.error(
      { ...errorMetadata(error), ...context, redisErrorCount },
      message,
    );
  }

  function logMongoError(
    error: unknown,
    context: object,
    message: string,
  ): void {
    mongoErrorCount += 1;
    dependencies.logger.error(
      { ...errorMetadata(error), ...context, mongoErrorCount },
      message,
    );
  }

  async function serialized<T>(
    gameId: string,
    work: () => Promise<T>,
  ): Promise<T> {
    const previous = serialization.get(gameId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.then(() => current);
    serialization.set(gameId, queued);
    await previous;
    try {
      return await work();
    } finally {
      release();
      if (serialization.get(gameId) === queued) serialization.delete(gameId);
    }
  }

  async function loadCheckpoint(gameId: string): Promise<StoredGameDocument> {
    try {
      const document = await games().findOne({ _id: gameId });
      if (!document)
        throw new GameServiceError('GAME_NOT_FOUND', 'Game not found');
      return document;
    } catch (error) {
      if (error instanceof GameServiceError) throw error;
      logMongoError(error, { gameId }, 'Game checkpoint read failed');
      throw databaseFailure();
    }
  }

  async function hydrateUncached(gameId: string): Promise<WarmGame> {
    const startedAt = dependencies.monotonicNow();
    const checkpoint = await loadCheckpoint(gameId);
    const checkpointRevision = checkpoint.revision;
    let storedJournal: LoadedGameJournal | null;
    try {
      const journal = dependencies.getJournal();
      await journal.initialize(gameId, checkpointRevision);
      storedJournal = await journal.load(gameId);
    } catch (error) {
      logRedisError(error, { gameId }, 'Game journal hydration failed');
      throw serviceUnavailable();
    }
    if (!storedJournal)
      throw serviceUnavailable('Game recovery data is unavailable');
    if (
      !Number.isInteger(storedJournal.revision) ||
      !Number.isInteger(storedJournal.checkpointRevision) ||
      storedJournal.reducerVersion !== GAME_REDUCER_VERSION ||
      storedJournal.protocolVersion !== GAMEPLAY_PROTOCOL_VERSION ||
      storedJournal.revision < checkpointRevision ||
      storedJournal.checkpointRevision > checkpointRevision
    ) {
      dependencies.logger.error(
        {
          gameId,
          checkpointRevision,
          journalRevision: storedJournal.revision,
          journalCheckpointRevision: storedJournal.checkpointRevision,
          reducerVersion: storedJournal.reducerVersion,
          protocolVersion: storedJournal.protocolVersion,
        },
        'Game recovery metadata is incompatible',
      );
      throw serviceUnavailable('Game recovery data is incompatible');
    }

    let recovered = cloneDocument(checkpoint);
    const entries = storedJournal.entries.filter(
      (entry) => entry.revision > checkpointRevision,
    );
    for (const entry of entries) {
      const command = GameCommandSchema.safeParse(entry.command);
      const occurredAt = new Date(entry.occurredAt);
      if (
        !command.success ||
        !Number.isFinite(occurredAt.getTime()) ||
        !validReceipt(entry.receipt, entry.revision) ||
        entry.revision !== recovered.revision + 1 ||
        entry.expectedRevision !== recovered.revision ||
        entry.reducerVersion !== GAME_REDUCER_VERSION ||
        entry.protocolVersion !== GAMEPLAY_PROTOCOL_VERSION
      ) {
        dependencies.logger.error(
          {
            gameId,
            checkpointRevision,
            recoveredRevision: recovered.revision,
            entryRevision: entry.revision,
          },
          'Game journal contains a gap or incompatible entry',
        );
        throw serviceUnavailable('Game recovery journal is invalid');
      }
      const nextGame = structuredClone(recovered.game);
      const random = createSeededRandom(
        recovered.random.seed,
        recovered.random.state,
      );
      const transition = dependencies.applyTransition(nextGame, command.data, {
        clock: { now: () => new Date(occurredAt) },
        random,
      });
      if (
        !transition.accepted ||
        entry.receipt.revision !== entry.revision ||
        entry.receipt.requestFingerprint !==
          requestFingerprint({
            gameId,
            sessionToken: '',
            actionId: entry.receipt.actionId,
            expectedRevision: entry.expectedRevision,
            command: command.data,
          }) ||
        !sameRandomState(random.snapshot(), entry.randomState) ||
        gameStateHash(transition.state) !== entry.stateHash
      ) {
        dependencies.logger.error(
          { gameId, entryRevision: entry.revision },
          'Game journal replay did not reproduce the committed boundary',
        );
        throw serviceUnavailable(
          'Game recovery journal could not be reproduced',
        );
      }
      recovered = {
        ...recovered,
        revision: entry.revision,
        random: { seed: recovered.random.seed, state: entry.randomState },
        game: transition.state,
        actionReceipts: mergeReceipts(recovered.actionReceipts, [
          entry.receipt,
        ]),
        leaderboard: entry.leaderboard,
        updatedAt: transition.state.updatedAt,
      };
    }
    if (
      storedJournal.receipts.some(
        (receipt) => !validReceipt(receipt, storedJournal.revision),
      )
    ) {
      dependencies.logger.error(
        { gameId, journalRevision: storedJournal.revision },
        'Game journal contains an invalid action receipt',
      );
      throw serviceUnavailable('Game recovery receipts are invalid');
    }
    if (recovered.revision !== storedJournal.revision) {
      dependencies.logger.error(
        {
          gameId,
          recoveredRevision: recovered.revision,
          journalRevision: storedJournal.revision,
        },
        'Game recovery journal ended at an unexpected revision',
      );
      throw serviceUnavailable('Game recovery journal is incomplete');
    }
    recovered.actionReceipts = mergeReceipts(
      recovered.actionReceipts,
      storedJournal.receipts,
    );
    const warm = remember(gameId, { document: recovered, checkpointRevision });
    dependencies.logger.info(
      {
        gameId,
        checkpointRevision,
        revision: recovered.revision,
        replayedCommandCount: entries.length,
        hydrationDurationMs: elapsed(startedAt, dependencies.monotonicNow()),
      },
      'Game session hydrated',
    );
    return warm;
  }

  async function hydrate(gameId: string): Promise<WarmGame> {
    const cached = cache.get(gameId);
    if (cached) return remember(gameId, cached);
    const existing = hydration.get(gameId);
    if (existing) return existing;
    const pending = hydrateUncached(gameId);
    hydration.set(gameId, pending);
    try {
      return await pending;
    } finally {
      hydration.delete(gameId);
    }
  }

  function enqueueCheckpoint(document: StoredGameDocument): void {
    const existing = pendingCheckpoints.get(document._id);
    if (!existing || existing.document.revision < document.revision) {
      pendingCheckpoints.set(document._id, {
        document: cloneDocument(document),
        enqueuedAt: dependencies.monotonicNow(),
      });
    }
    void runCheckpoints();
  }

  function requestCheckpoint(
    warm: WarmGame,
    document: StoredGameDocument,
    immediate: boolean,
  ): void {
    const lag = document.revision - warm.checkpointRevision;
    if (immediate || lag >= dependencies.checkpointCommandInterval) {
      const timer = checkpointTimers.get(document._id);
      if (timer) clearTimeout(timer);
      checkpointTimers.delete(document._id);
      enqueueCheckpoint(document);
      return;
    }
    if (checkpointTimers.has(document._id)) return;
    const timer = setTimeout(() => {
      checkpointTimers.delete(document._id);
      const latest = cache.get(document._id);
      if (latest && latest.document.revision > latest.checkpointRevision) {
        enqueueCheckpoint(latest.document);
      }
    }, dependencies.checkpointTimeIntervalMs);
    timer.unref();
    checkpointTimers.set(document._id, timer);
  }

  async function writeCheckpoint(pending: PendingCheckpoint): Promise<void> {
    const { document } = pending;
    const writeStartedAt = dependencies.monotonicNow();
    try {
      const current = await games().findOne({ _id: document._id });
      if (!current) return;
      if (current.revision < document.revision) {
        await games().replaceOne(
          { _id: document._id, revision: current.revision },
          document,
          { writeConcern: DURABLE_WRITE_CONCERN },
        );
      }
    } catch (error) {
      logMongoError(
        error,
        { gameId: document._id, revision: document.revision },
        'Game checkpoint MongoDB write failed',
      );
      throw error;
    }
    try {
      await dependencies
        .getJournal()
        .confirmCheckpoint(document._id, document.revision);
    } catch (error) {
      logRedisError(
        error,
        { gameId: document._id, revision: document.revision },
        'Game checkpoint journal trim failed',
      );
      throw error;
    }
    const warm = cache.get(document._id);
    if (warm)
      warm.checkpointRevision = Math.max(
        warm.checkpointRevision,
        document.revision,
      );
    dependencies.logger.info(
      {
        gameId: document._id,
        revision: document.revision,
        queueDelayMs: elapsed(pending.enqueuedAt, writeStartedAt),
        queueDepth: pendingCheckpoints.size,
        writeDurationMs: elapsed(writeStartedAt, dependencies.monotonicNow()),
        checkpointLagRevisions: Math.max(
          0,
          (warm?.document.revision ?? document.revision) - document.revision,
        ),
      },
      'Game checkpoint persisted',
    );
    if (document.leaderboard.status === 'pending')
      void tryDeliverLeaderboard(document._id);
    // A finished game accepts no further commands, so keeping it warm only
    // grows the cache until the process restarts.
    if (
      warm &&
      warm.document.game.status !== 'active' &&
      warm.document.revision <= document.revision
    ) {
      cache.delete(document._id);
    }
  }

  function scheduleCheckpointRetry(): void {
    if (checkpointRetryScheduled) return;
    checkpointRetryScheduled = true;
    dependencies.scheduleRetry(() => {
      checkpointRetryScheduled = false;
      void runCheckpoints();
    }, CHECKPOINT_RETRY_DELAY_MS);
  }

  function runCheckpoints(): Promise<void> {
    if (checkpointRun) return checkpointRun;
    const run = (async () => {
      while (pendingCheckpoints.size > 0) {
        const first = pendingCheckpoints.entries().next().value as
          | [string, PendingCheckpoint]
          | undefined;
        if (!first) break;
        const [gameId, pending] = first;
        pendingCheckpoints.delete(gameId);
        try {
          await writeCheckpoint(pending);
        } catch (error) {
          const newer = pendingCheckpoints.get(gameId);
          if (!newer || newer.document.revision < pending.document.revision) {
            pendingCheckpoints.set(gameId, pending);
          }
          dependencies.logger.error(
            {
              ...errorMetadata(error),
              gameId,
              revision: pending.document.revision,
              queueDepth: pendingCheckpoints.size,
            },
            'Game checkpoint write deferred',
          );
          scheduleCheckpointRetry();
          break;
        }
      }
    })();
    checkpointRun = run;
    void run.finally(() => {
      if (checkpointRun === run) checkpointRun = null;
    });
    return run;
  }

  async function flushCheckpoints(
    timeoutMs = CHECKPOINT_FLUSH_TIMEOUT_MS,
  ): Promise<void> {
    for (const timer of checkpointTimers.values()) clearTimeout(timer);
    checkpointTimers.clear();
    for (const warm of cache.values()) enqueueCheckpoint(warm.document);
    await Promise.race([
      (async () => {
        while (checkpointRun || pendingCheckpoints.size > 0) {
          await runCheckpoints();
          if (pendingCheckpoints.size > 0)
            await new Promise<void>((resolve) => setTimeout(resolve, 10));
        }
      })(),
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
    if (pendingCheckpoints.size > 0) {
      dependencies.logger.warn(
        { queueDepth: pendingCheckpoints.size, timeoutMs },
        'Game checkpoint flush ended with pending work',
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
      logMongoError(error, { gameId }, 'Game creation failed');
      throw databaseFailure('Game could not be created. Please try again.');
    }
    try {
      await dependencies.getJournal().initialize(gameId, 0);
    } catch (error) {
      logRedisError(error, { gameId }, 'Game journal initialization failed');
      throw serviceUnavailable();
    }
    remember(gameId, {
      document: cloneDocument(document),
      checkpointRevision: 0,
    });
    return {
      gameId,
      sessionToken,
      revision: 0,
      state: projectGameState(game, 0),
    };
  }

  async function migrateLegacyGame(gameId: string): Promise<NewGameResponse> {
    const sessionToken = dependencies.createToken();
    const seed = dependencies.createSeed();
    const random = createSeededRandom(seed);
    let legacy: LegacyGameDocument | null;
    try {
      legacy = await dependencies
        .getDatabase()
        .collection<LegacyGameDocument>('games')
        .findOne({
          _id: gameId,
          sessionTokenHash: { $exists: false },
          game: { $exists: false },
        } as never);
    } catch (error) {
      logMongoError(error, { gameId }, 'Legacy game read failed');
      throw databaseFailure(
        'Legacy game could not be loaded. Please try again.',
      );
    }
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
      game: structuredClone(legacy),
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
      logMongoError(error, { gameId }, 'Legacy game migration failed');
      throw databaseFailure(
        'Legacy game could not be migrated. Please try again.',
      );
    }
    if (migrated.matchedCount === 0) {
      throw new GameServiceError(
        'GAME_NOT_FOUND',
        'Legacy game not found or already migrated',
      );
    }
    try {
      await dependencies.getJournal().initialize(gameId, 0);
    } catch (error) {
      logRedisError(
        error,
        { gameId },
        'Migrated game journal initialization failed',
      );
      throw serviceUnavailable();
    }
    remember(gameId, {
      document: cloneDocument(document),
      checkpointRevision: 0,
    });
    return {
      gameId,
      sessionToken,
      revision: 0,
      state: projectGameState(document.game, 0),
    };
  }

  async function readGame(
    gameId: string,
    sessionToken: string,
  ): Promise<GameStateResponse> {
    return serialized(gameId, async () => {
      const warm = await hydrate(gameId);
      authenticate(warm.document, sessionToken);
      try {
        await dependencies
          .getJournal()
          .initialize(gameId, warm.checkpointRevision);
      } catch (error) {
        logRedisError(
          error,
          { gameId },
          'Game journal expiration refresh failed',
        );
        throw serviceUnavailable();
      }
      void tryDeliverLeaderboard(gameId);
      return {
        revision: warm.document.revision,
        state: projectGameState(warm.document.game, warm.document.revision),
      };
    });
  }

  async function executeGameCommand(
    request: ExecuteGameCommandRequest,
  ): Promise<GameCommandResult> {
    const receivedAt = dependencies.monotonicNow();
    return serialized(request.gameId, async () => {
      const warm = await hydrate(request.gameId);
      const document = warm.document;
      authenticate(document, request.sessionToken);
      const cached = receiptResult(document, request);
      if (cached) {
        try {
          await dependencies
            .getJournal()
            .initialize(request.gameId, warm.checkpointRevision);
        } catch (error) {
          logRedisError(
            error,
            { gameId: request.gameId },
            'Game journal expiration refresh failed',
          );
          throw serviceUnavailable();
        }
        return cached;
      }
      if (document.game.status !== 'active') {
        throw new GameServiceError(
          'GAME_FINISHED',
          'Game is already finished',
          {
            actionId: request.actionId,
            revision: document.revision,
            state: projectGameState(document.game, document.revision),
          },
        );
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

      const transitionStartedAt = dependencies.monotonicNow();
      const nextGame = structuredClone(document.game);
      const random = createSeededRandom(
        document.random.seed,
        document.random.state,
      );
      const occurredAt = dependencies.now();
      const before = projectGameState(document.game, document.revision);
      const transition = dependencies.applyTransition(
        nextGame,
        request.command,
        {
          clock: { now: () => new Date(occurredAt) },
          random,
        },
      );
      const transitionDurationMs = elapsed(
        transitionStartedAt,
        dependencies.monotonicNow(),
      );
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
        requestFingerprint: requestFingerprint(request),
        revision,
        events: result.events,
        deltas: result.deltas,
        recordedAt: occurredAt,
      };
      const nextDocument: StoredGameDocument = {
        ...document,
        revision,
        random: { seed: document.random.seed, state: random.snapshot() },
        game: transition.state,
        actionReceipts: mergeReceipts(document.actionReceipts, [receipt]),
        leaderboard:
          document.leaderboard.status === 'none'
            ? leaderboardDelivery(
                transition.state,
                transition.events,
                occurredAt,
              )
            : document.leaderboard,
        updatedAt: transition.state.updatedAt,
      };
      const entry: GameJournalEntry = {
        schemaVersion: 1,
        reducerVersion: GAME_REDUCER_VERSION,
        protocolVersion: GAMEPLAY_PROTOCOL_VERSION,
        revision,
        expectedRevision: request.expectedRevision,
        command: request.command,
        occurredAt: occurredAt.toISOString(),
        randomState: random.snapshot(),
        stateHash: gameStateHash(transition.state),
        leaderboard: nextDocument.leaderboard,
        receipt,
      };
      const redisStartedAt = dependencies.monotonicNow();
      let commit: JournalCommitResult;
      try {
        commit = await dependencies.getJournal().commit(request.gameId, entry);
      } catch (error) {
        logRedisError(
          error,
          { gameId: request.gameId, actionId: request.actionId },
          'Redis command commit failed',
        );
        throw serviceUnavailable();
      }
      const redisCommitDurationMs = elapsed(
        redisStartedAt,
        dependencies.monotonicNow(),
      );
      if (commit.status === 'action_id_reused') {
        throw new GameServiceError(
          'ACTION_ID_REUSED',
          'This action ID was already used for a different request',
          {
            actionId: request.actionId,
          },
        );
      }
      if (commit.status === 'revision_conflict') {
        cache.delete(request.gameId);
        const current = await hydrate(request.gameId);
        throw new GameServiceError(
          'REVISION_CONFLICT',
          'Game state changed; synchronize and try a new action',
          {
            actionId: request.actionId,
            revision: current.document.revision,
            state: projectGameState(
              current.document.game,
              current.document.revision,
            ),
          },
        );
      }
      if (commit.status === 'exact_retry') {
        cache.delete(request.gameId);
        const current = await hydrate(request.gameId);
        const retried = receiptResult(current.document, request);
        if (!retried)
          throw serviceUnavailable(
            'The committed action could not be recovered',
          );
        enqueueCheckpoint(current.document);
        return retried;
      }

      remember(request.gameId, {
        document: nextDocument,
        checkpointRevision: warm.checkpointRevision,
      });
      requestCheckpoint(
        warm,
        nextDocument,
        nextDocument.game.status !== 'active' ||
          nextDocument.game.floor !== document.game.floor,
      );
      dependencies.logger.info(
        {
          gameId: request.gameId,
          actionId: request.actionId,
          expectedRevision: request.expectedRevision,
          revision,
          commandType: request.command.type,
          transitionDurationMs,
          redisCommitDurationMs,
          commandDurationMs: elapsed(receivedAt, dependencies.monotonicNow()),
          journalByteSize: commit.byteSize,
          checkpointLagRevisions: revision - warm.checkpointRevision,
        },
        'Game command committed',
      );
      return result;
    });
  }

  async function deleteGame(
    gameId: string,
    sessionToken: string,
  ): Promise<void> {
    await serialized(gameId, async () => {
      const warm = await hydrate(gameId);
      authenticate(warm.document, sessionToken);
      if (warm.document.game.status !== 'active') {
        throw new GameServiceError(
          'GAME_FINISHED',
          'Game is already finished',
          {
            revision: warm.document.revision,
            state: projectGameState(warm.document.game, warm.document.revision),
          },
        );
      }
      let deleted: { deletedCount: number };
      try {
        deleted = await games().deleteOne(
          {
            _id: gameId,
            sessionTokenHash: warm.document.sessionTokenHash,
            'game.status': 'active',
          },
          { writeConcern: DURABLE_WRITE_CONCERN },
        );
      } catch (error) {
        logMongoError(error, { gameId }, 'Game deletion failed');
        throw databaseFailure('Game could not be abandoned. Please try again.');
      }
      if (deleted.deletedCount === 0) {
        cache.delete(gameId);
        throw new GameServiceError(
          'REVISION_CONFLICT',
          'Game state changed; synchronize before abandoning',
        );
      }
      try {
        await dependencies.getJournal().delete(gameId);
      } finally {
        cache.delete(gameId);
        pendingCheckpoints.delete(gameId);
        const timer = checkpointTimers.get(gameId);
        if (timer) clearTimeout(timer);
        checkpointTimers.delete(gameId);
      }
    });
  }

  async function deliverLeaderboard(gameId: string): Promise<void> {
    const document = await games().findOne({ _id: gameId });
    if (document?.leaderboard.status !== 'pending') return;
    const outcome = document.leaderboard.outcome;
    await dependencies
      .getDatabase()
      .collection<LeaderboardDoc>('leaderboard')
      .updateOne(
        { _id: gameId },
        {
          $setOnInsert: {
            playerName: outcome.playerName,
            score: outcome.score,
            floor: outcome.floor,
            killedBy: outcome.killedBy,
            killedByType: outcome.killedByType,
            killedByVariant: outcome.killedByVariant,
            createdAt: outcome.finishedAt,
          },
        },
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
      logMongoError(error, { gameId }, 'Leaderboard delivery deferred');
    }
  }

  function reconcilePendingLeaderboards(): Promise<number> {
    if (reconciliationInFlight) return reconciliationInFlight;
    const run = (async () => {
      const pending = await games()
        .find({ 'leaderboard.status': 'pending' }, { projection: { _id: 1 } })
        .limit(100)
        .toArray();
      let delivered = 0;
      for (const document of pending) {
        try {
          await deliverLeaderboard(document._id);
          delivered += 1;
        } catch {
          // Pending delivery remains durable in the MongoDB checkpoint.
        }
      }
      return delivered;
    })();
    reconciliationInFlight = run;
    void run.finally(() => {
      if (reconciliationInFlight === run) reconciliationInFlight = null;
    });
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
    flushCheckpoints,
    invalidateCache: (gameId?: string) => {
      if (gameId) cache.delete(gameId);
      else cache.clear();
    },
  };
}
