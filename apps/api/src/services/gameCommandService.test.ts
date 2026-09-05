import { reduceGame } from '@dungeon-crawler/domain';
import type { Db } from 'mongodb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  LeaderboardDoc,
  LegacyGameDocument,
  StoredGameDocument,
} from '@/types/database.js';
import type { GameServiceError } from '@/types/gameServiceErrors.js';
import {
  ACTION_RECEIPT_LIMIT,
  createGameCommandService,
  LEADERBOARD_RECONCILIATION_BATCH_SIZE,
  LEADERBOARD_RECONCILIATION_CONCURRENCY,
} from './gameCommandService.js';
import { hashSessionToken } from './sessionToken.js';

class FakeDatabase {
  readonly gameDocuments = new Map<string, StoredGameDocument>();
  readonly legacyGameDocuments = new Map<string, LegacyGameDocument>();
  readonly leaderboardDocuments = new Map<string, LeaderboardDoc>();
  failNextReplace = false;
  rejectNextReplace = false;
  failLeaderboardWrites = false;
  beforeDelete: (() => void) | null = null;
  leaderboardWriteGate: Promise<void> | null = null;
  activeLeaderboardWrites = 0;
  maxActiveLeaderboardWrites = 0;

  collection<_T>(name: string) {
    if (name === 'games') return this.gamesCollection() as never;
    if (name === 'leaderboard') return this.leaderboardCollection() as never;
    throw new Error(`Unexpected collection ${name}`);
  }

  private gamesCollection() {
    return {
      findOne: async (filter: Record<string, unknown>) => {
        if (typeof filter._id === 'string') {
          if (filter.sessionTokenHash && filter.game) {
            return structuredClone(
              this.legacyGameDocuments.get(filter._id) ?? null,
            );
          }
          return structuredClone(this.gameDocuments.get(filter._id) ?? null);
        }
        const differentGame = (filter._id as { $ne?: string } | undefined)?.$ne;
        const actionId = filter['actionReceipts.actionId'];
        for (const document of this.gameDocuments.values()) {
          if (
            document._id !== differentGame &&
            document.actionReceipts.some(
              (receipt) => receipt.actionId === actionId,
            )
          ) {
            return structuredClone(document);
          }
        }
        return null;
      },
      insertOne: async (document: StoredGameDocument) => {
        this.gameDocuments.set(document._id, structuredClone(document));
        return { acknowledged: true, insertedId: document._id };
      },
      replaceOne: async (
        filter: { _id: string; revision?: number },
        document: StoredGameDocument,
      ) => {
        if (this.failNextReplace) {
          this.failNextReplace = false;
          throw new Error('simulated database write failure');
        }
        if (this.rejectNextReplace) {
          this.rejectNextReplace = false;
          return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
        }
        if (filter.revision === undefined) {
          if (!this.legacyGameDocuments.has(filter._id)) {
            return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
          }
          this.legacyGameDocuments.delete(filter._id);
          this.gameDocuments.set(document._id, structuredClone(document));
          return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
        }
        const current = this.gameDocuments.get(filter._id);
        if (!current || current.revision !== filter.revision) {
          return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
        }
        const actionIds = new Set(
          document.actionReceipts.map((receipt) => receipt.actionId),
        );
        for (const candidate of this.gameDocuments.values()) {
          if (candidate._id === document._id) continue;
          if (
            candidate.actionReceipts.some((receipt) =>
              actionIds.has(receipt.actionId),
            )
          ) {
            throw Object.assign(new Error('duplicate action ID'), {
              code: 11000,
            });
          }
        }
        this.gameDocuments.set(document._id, structuredClone(document));
        return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
      },
      updateOne: async (
        filter: { _id: string; 'leaderboard.status'?: string },
        update: { $set: { 'leaderboard.status': string } },
      ) => {
        if (this.failLeaderboardWrites) {
          throw new Error('simulated leaderboard failure');
        }
        const document = this.gameDocuments.get(filter._id);
        if (
          !document ||
          (filter['leaderboard.status'] &&
            document.leaderboard.status !== filter['leaderboard.status'])
        ) {
          return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
        }
        if (document.leaderboard.status !== 'none') {
          document.leaderboard.status = update.$set['leaderboard.status'] as
            | 'pending'
            | 'submitted';
        }
        return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
      },
      deleteOne: async (filter: {
        _id: string;
        sessionTokenHash: string;
        revision: number;
        'game.status': string;
        'leaderboard.status': string;
      }) => {
        this.beforeDelete?.();
        this.beforeDelete = null;
        const document = this.gameDocuments.get(filter._id);
        if (
          !document ||
          document.sessionTokenHash !== filter.sessionTokenHash ||
          document.revision !== filter.revision ||
          document.game.status !== filter['game.status'] ||
          document.leaderboard.status !== filter['leaderboard.status']
        ) {
          return { acknowledged: true, deletedCount: 0 };
        }
        this.gameDocuments.delete(filter._id);
        return { acknowledged: true, deletedCount: 1 };
      },
      find: (filter: { 'leaderboard.status': string }) => {
        let limit = Number.POSITIVE_INFINITY;
        const cursor = {
          limit: (value: number) => {
            limit = value;
            return cursor;
          },
          toArray: async () =>
            [...this.gameDocuments.values()]
              .filter(
                (document) =>
                  document.leaderboard.status === filter['leaderboard.status'],
              )
              .slice(0, limit),
        };
        return cursor;
      },
    };
  }

  private leaderboardCollection() {
    return {
      updateOne: async (
        filter: { _id: string },
        update: { $setOnInsert: Omit<LeaderboardDoc, '_id'> },
      ) => {
        this.activeLeaderboardWrites += 1;
        this.maxActiveLeaderboardWrites = Math.max(
          this.maxActiveLeaderboardWrites,
          this.activeLeaderboardWrites,
        );
        try {
          if (this.leaderboardWriteGate) await this.leaderboardWriteGate;
          if (!this.leaderboardDocuments.has(filter._id)) {
            this.leaderboardDocuments.set(filter._id, {
              _id: filter._id,
              ...structuredClone(update.$setOnInsert),
            });
          }
          return { acknowledged: true, matchedCount: 1, modifiedCount: 0 };
        } finally {
          this.activeLeaderboardWrites -= 1;
        }
      },
    };
  }
}

const TOKEN = 'test-session-token-with-256-bits-of-fixture-entropy';
const NOW = new Date('2026-08-19T12:00:00.000Z');

function expectCode(code: GameServiceError['code']) {
  return expect.objectContaining({ code });
}

function testLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function commandOutcomeRecords(logger: ReturnType<typeof testLogger>) {
  return [...logger.info.mock.calls, ...logger.error.mock.calls]
    .filter(([, message]) => message === 'Game command outcome')
    .map(([record]) => record as Record<string, unknown>);
}

describe('game command service', () => {
  let database: FakeDatabase;
  let idSequence: number;
  let applyTransition: ReturnType<typeof vi.fn<typeof reduceGame>>;

  beforeEach(() => {
    database = new FakeDatabase();
    idSequence = 0;
    applyTransition = vi.fn(reduceGame);
  });

  function service(overrides = {}) {
    return createGameCommandService({
      getDatabase: () => database as unknown as Db,
      now: () => new Date(NOW),
      createId: () => `id-${++idSequence}`,
      createToken: () => TOKEN,
      createSeed: () => 'deterministic-seed',
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      applyTransition,
      ...overrides,
    });
  }

  async function createdGame() {
    const commandService = service();
    const created = await commandService.createGameSession({
      playerName: 'Ada',
      character: 'wizard',
    });
    return { commandService, created };
  }

  it('returns the raw token once, stores only its hash, and projects no persistence metadata', async () => {
    const { commandService, created } = await createdGame();
    const stored = database.gameDocuments.get(created.gameId);

    expect(created.sessionToken).toBe(TOKEN);
    expect(stored?.sessionTokenHash).toBe(hashSessionToken(TOKEN));
    expect(JSON.stringify(stored)).not.toContain(TOKEN);
    expect(JSON.stringify(created.state)).not.toContain('sessionTokenHash');
    expect(created.state).not.toHaveProperty('map');
    expect(created.state).not.toHaveProperty('actionReceipts');
    expect(created.state).not.toHaveProperty('random');

    const resumed = await commandService.readGame(created.gameId, TOKEN);
    expect(resumed).not.toHaveProperty('sessionToken');
    expect(JSON.stringify(resumed)).not.toContain(TOKEN);
  });

  it('atomically wraps an exact legacy game document and returns new credentials once', async () => {
    const { created } = await createdGame();
    const current = database.gameDocuments.get(created.gameId);
    if (!current) throw new Error('Expected a stored game');
    database.gameDocuments.delete(created.gameId);
    database.legacyGameDocuments.set(
      created.gameId,
      structuredClone(current.game),
    );
    const commandService = service();

    const migrated = await commandService.migrateLegacyGame(created.gameId);

    expect(migrated).toMatchObject({
      gameId: created.gameId,
      sessionToken: TOKEN,
      revision: 0,
      state: { _id: created.gameId, revision: 0, status: 'active' },
    });
    expect(database.legacyGameDocuments.has(created.gameId)).toBe(false);
    expect(database.gameDocuments.get(created.gameId)).toMatchObject({
      schemaVersion: 1,
      revision: 0,
      sessionTokenHash: hashSessionToken(TOKEN),
      actionReceipts: [],
      leaderboard: { status: 'none' },
    });
    await expect(
      commandService.migrateLegacyGame(created.gameId),
    ).rejects.toEqual(expectCode('GAME_NOT_FOUND'));
  });

  it('requires valid credentials for reads, commands, and deletion', async () => {
    const { commandService, created } = await createdGame();

    await expect(
      commandService.readGame(created.gameId, 'wrong'),
    ).rejects.toEqual(expectCode('UNAUTHORIZED'));
    await expect(
      commandService.executeGameCommand({
        gameId: created.gameId,
        sessionToken: 'wrong',
        actionId: 'unauthorized-action',
        expectedRevision: 0,
        command: { type: 'attack' },
      }),
    ).rejects.toEqual(expectCode('UNAUTHORIZED'));
    await expect(
      commandService.deleteGame(created.gameId, 'wrong'),
    ).rejects.toEqual(expectCode('UNAUTHORIZED'));
  });

  it('does not delete a game that becomes terminal after the abandon read', async () => {
    const { commandService, created } = await createdGame();
    database.failLeaderboardWrites = true;
    database.beforeDelete = () => {
      const document = database.gameDocuments.get(created.gameId);
      if (!document) throw new Error('Expected a stored game');
      document.revision += 1;
      document.game.status = 'won';
      document.leaderboard = {
        status: 'pending',
        outcome: {
          playerName: document.game.playerName,
          score: document.game.score,
          floor: document.game.floor,
          killedBy: null,
          killedByType: null,
          killedByVariant: null,
          finishedAt: NOW,
        },
      };
    };

    await expect(
      commandService.deleteGame(created.gameId, TOKEN),
    ).rejects.toEqual(expectCode('GAME_FINISHED'));
    expect(database.gameDocuments.get(created.gameId)).toMatchObject({
      revision: 1,
      game: { status: 'won' },
      leaderboard: { status: 'pending' },
    });
  });

  it('increments revisions, rejects stale actions, and lets one concurrent action win', async () => {
    const { commandService, created } = await createdGame();
    const first = await commandService.executeGameCommand({
      gameId: created.gameId,
      sessionToken: TOKEN,
      actionId: 'first-action',
      expectedRevision: 0,
      command: { type: 'attack' },
    });
    expect(first.revision).toBe(1);
    expect(first.state.revision).toBe(1);

    await expect(
      commandService.executeGameCommand({
        gameId: created.gameId,
        sessionToken: TOKEN,
        actionId: 'stale-action',
        expectedRevision: 0,
        command: { type: 'attack' },
      }),
    ).rejects.toMatchObject({
      code: 'REVISION_CONFLICT',
      safeContext: { revision: 1, state: { revision: 1 } },
    });

    const concurrent = await Promise.allSettled([
      commandService.executeGameCommand({
        gameId: created.gameId,
        sessionToken: TOKEN,
        actionId: 'concurrent-a',
        expectedRevision: 1,
        command: { type: 'attack' },
      }),
      commandService.executeGameCommand({
        gameId: created.gameId,
        sessionToken: TOKEN,
        actionId: 'concurrent-b',
        expectedRevision: 1,
        command: { type: 'attack' },
      }),
    ]);
    expect(
      concurrent.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      concurrent.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    expect(database.gameDocuments.get(created.gameId)?.revision).toBe(2);
  });

  it('returns an exact cached result for a duplicate action and rejects mismatched reuse', async () => {
    const { commandService, created } = await createdGame();
    const request = {
      gameId: created.gameId,
      sessionToken: TOKEN,
      actionId: 'retry-action',
      expectedRevision: 0,
      command: { type: 'attack' as const },
    };
    const first = await commandService.executeGameCommand(request);
    const callsAfterFirst = applyTransition.mock.calls.length;
    const retry = await commandService.executeGameCommand(request);

    expect(retry).toEqual(first);
    expect(database.gameDocuments.get(created.gameId)?.revision).toBe(1);
    expect(applyTransition).toHaveBeenCalledTimes(callsAfterFirst);
    await expect(
      commandService.executeGameCommand({
        ...request,
        command: { type: 'move', direction: 'left' },
      }),
    ).rejects.toEqual(expectCode('ACTION_ID_REUSED'));
  });

  it('returns current authoritative state when an old receipt is retried', async () => {
    const { commandService, created } = await createdGame();
    const firstRequest = {
      gameId: created.gameId,
      sessionToken: TOKEN,
      actionId: 'retry-a',
      expectedRevision: 0,
      command: { type: 'attack' as const },
    };
    await commandService.executeGameCommand(firstRequest);
    await commandService.executeGameCommand({
      ...firstRequest,
      actionId: 'action-b',
      expectedRevision: 1,
    });

    const retry = await commandService.executeGameCommand(firstRequest);

    expect(retry).toMatchObject({
      actionId: 'retry-a',
      revision: 2,
      state: { revision: 2 },
      deltas: [],
    });
    const receipt = database.gameDocuments
      .get(created.gameId)
      ?.actionReceipts.find((candidate) => candidate.actionId === 'retry-a');
    expect(receipt).not.toHaveProperty('result');
    expect(receipt).not.toHaveProperty('state');
  });

  it('rejects retained action ID reuse for another authenticated game', async () => {
    const commandService = service();
    const first = await commandService.createGameSession({
      playerName: 'First',
      character: 'dwarf',
    });
    const second = await commandService.createGameSession({
      playerName: 'Second',
      character: 'elf',
    });
    await commandService.executeGameCommand({
      gameId: first.gameId,
      sessionToken: first.sessionToken,
      actionId: 'cross-game-action',
      expectedRevision: 0,
      command: { type: 'attack' },
    });
    await expect(
      commandService.executeGameCommand({
        gameId: second.gameId,
        sessionToken: second.sessionToken,
        actionId: 'cross-game-action',
        expectedRevision: 0,
        command: { type: 'attack' },
      }),
    ).rejects.toEqual(expectCode('ACTION_ID_REUSED'));
    expect(database.gameDocuments.get(second.gameId)?.revision).toBe(0);
  });

  it('does not acknowledge or consume authoritative RNG after a failed write', async () => {
    const logger = testLogger();
    const commandService = service({ logger });
    const created = await commandService.createGameSession({
      playerName: 'Ada',
      character: 'wizard',
    });
    const before = structuredClone(database.gameDocuments.get(created.gameId));
    database.failNextReplace = true;

    const failure = commandService.executeGameCommand({
      gameId: created.gameId,
      sessionToken: TOKEN,
      actionId: 'failed-write',
      expectedRevision: 0,
      command: { type: 'attack' },
    });
    await expect(failure).rejects.toEqual(expectCode('DATABASE_ERROR'));

    const after = database.gameDocuments.get(created.gameId);
    expect(after?.revision).toBe(0);
    expect(after?.random).toEqual(before?.random);
    expect(after?.game).toEqual(before?.game);
    expect(after?.actionReceipts).toEqual(before?.actionReceipts);
    expect(after?.leaderboard).toEqual(before?.leaderboard);
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(TOKEN);
    await failure.catch((error) => {
      expect(JSON.stringify(error)).not.toContain(TOKEN);
    });
  });

  it('leaves the durable envelope unchanged when compare-and-set rejects a candidate', async () => {
    const logger = testLogger();
    const commandService = service({ logger });
    const created = await commandService.createGameSession({
      playerName: 'Ada',
      character: 'wizard',
    });
    const before = structuredClone(database.gameDocuments.get(created.gameId));
    database.rejectNextReplace = true;

    await expect(
      commandService.executeGameCommand({
        gameId: created.gameId,
        sessionToken: TOKEN,
        actionId: 'rejected-compare-and-set',
        expectedRevision: 0,
        command: { type: 'attack' },
      }),
    ).rejects.toEqual(expectCode('REVISION_CONFLICT'));

    expect(database.gameDocuments.get(created.gameId)).toEqual(before);
    expect(commandOutcomeRecords(logger)).toEqual([
      expect.objectContaining({
        gameId: created.gameId,
        actionId: 'rejected-compare-and-set',
        outcome: 'revision_conflict',
        errorCode: 'REVISION_CONFLICT',
        revision: 0,
      }),
    ]);
  });

  it('logs committed and exact-retry outcomes once with deterministic duration', async () => {
    const logger = testLogger();
    const times = [10, 22.5, 30, 34];
    const commandService = service({
      logger,
      monotonicNow: () => times.shift() ?? 34,
    });
    const created = await commandService.createGameSession({
      playerName: 'Ada',
      character: 'wizard',
    });
    const request = {
      gameId: created.gameId,
      sessionToken: TOKEN,
      actionId: 'timed-action',
      expectedRevision: 0,
      command: { type: 'attack' as const },
    };

    await commandService.executeGameCommand(request);
    await commandService.executeGameCommand(request);

    expect(commandOutcomeRecords(logger)).toEqual([
      {
        gameId: created.gameId,
        actionId: 'timed-action',
        expectedRevision: 0,
        commandType: 'attack',
        durationMs: 12.5,
        outcome: 'committed',
        revision: 1,
      },
      {
        gameId: created.gameId,
        actionId: 'timed-action',
        expectedRevision: 0,
        commandType: 'attack',
        durationMs: 4,
        outcome: 'exact_retry',
        revision: 1,
      },
    ]);
  });

  it('logs one safe typed outcome for every observable command rejection', async () => {
    const logger = testLogger();
    let monotonicTime = 0;
    const commandService = service({
      logger,
      monotonicNow: () => {
        monotonicTime += 2;
        return monotonicTime;
      },
    });
    const created = await commandService.createGameSession({
      playerName: 'Private Player Name',
      character: 'wizard',
    });
    const stored = database.gameDocuments.get(created.gameId);
    if (!stored) throw new Error('Expected a stored game');
    const { x, y } = stored.game.player;
    stored.game.map[y - 1][x] = { type: 'wall', x, y: y - 1 };

    await expect(
      commandService.executeGameCommand({
        gameId: created.gameId,
        sessionToken: 'private-wrong-token',
        actionId: 'unauthorized-action',
        expectedRevision: 0,
        command: { type: 'attack' },
      }),
    ).rejects.toEqual(expectCode('UNAUTHORIZED'));
    await expect(
      commandService.executeGameCommand({
        gameId: 'missing-game',
        sessionToken: TOKEN,
        actionId: 'missing-action',
        expectedRevision: 0,
        command: { type: 'attack' },
      }),
    ).rejects.toEqual(expectCode('GAME_NOT_FOUND'));
    await expect(
      commandService.executeGameCommand({
        gameId: created.gameId,
        sessionToken: TOKEN,
        actionId: 'invalid-action',
        expectedRevision: 0,
        command: { type: 'move', direction: 'up' },
      }),
    ).rejects.toEqual(expectCode('INVALID_COMMAND'));
    await expect(
      commandService.executeGameCommand({
        gameId: created.gameId,
        sessionToken: TOKEN,
        actionId: 'conflict-action',
        expectedRevision: 9,
        command: { type: 'attack' },
      }),
    ).rejects.toEqual(expectCode('REVISION_CONFLICT'));
    await commandService.executeGameCommand({
      gameId: created.gameId,
      sessionToken: TOKEN,
      actionId: 'reused-action',
      expectedRevision: 0,
      command: { type: 'attack' },
    });
    await expect(
      commandService.executeGameCommand({
        gameId: created.gameId,
        sessionToken: TOKEN,
        actionId: 'reused-action',
        expectedRevision: 0,
        command: { type: 'move', direction: 'left' },
      }),
    ).rejects.toEqual(expectCode('ACTION_ID_REUSED'));
    const committedStored = database.gameDocuments.get(created.gameId);
    if (!committedStored) throw new Error('Expected a committed game');
    committedStored.game.status = 'won';
    await expect(
      commandService.executeGameCommand({
        gameId: created.gameId,
        sessionToken: TOKEN,
        actionId: 'finished-action',
        expectedRevision: 1,
        command: { type: 'attack' },
      }),
    ).rejects.toEqual(expectCode('GAME_FINISHED'));
    committedStored.game.status = 'active';
    database.failNextReplace = true;
    await expect(
      commandService.executeGameCommand({
        gameId: created.gameId,
        sessionToken: TOKEN,
        actionId: 'database-action',
        expectedRevision: 1,
        command: { type: 'attack' },
      }),
    ).rejects.toEqual(expectCode('DATABASE_ERROR'));

    const records = commandOutcomeRecords(logger);
    expect(records).toHaveLength(8);
    expect(records.map((record) => record.outcome)).toEqual([
      'unauthorized',
      'game_not_found',
      'invalid_command',
      'revision_conflict',
      'committed',
      'action_id_reused',
      'game_finished',
      'database_failure',
    ]);
    expect(records.map((record) => record.errorCode).filter(Boolean)).toEqual([
      'UNAUTHORIZED',
      'GAME_NOT_FOUND',
      'INVALID_COMMAND',
      'REVISION_CONFLICT',
      'ACTION_ID_REUSED',
      'GAME_FINISHED',
      'DATABASE_ERROR',
    ]);
    for (const record of records) {
      expect(record.durationMs).toBe(2);
      expect(Number.isFinite(record.durationMs)).toBe(true);
      for (const privateField of [
        'sessionToken',
        'sessionTokenHash',
        'authorization',
        'command',
        'state',
        'projection',
        'receipt',
        'random',
        'seed',
        'storedDocument',
      ]) {
        expect(record).not.toHaveProperty(privateField);
      }
    }
    const serialized = JSON.stringify(records);
    expect(serialized).not.toContain(TOKEN);
    expect(serialized).not.toContain('private-wrong-token');
    expect(serialized).not.toContain(hashSessionToken(TOKEN));
    expect(serialized).not.toContain('Private Player Name');
    expect(serialized).not.toContain('deterministic-seed');
  });

  it('continues deterministic RNG from the persisted cursor after restart', async () => {
    const { commandService, created } = await createdGame();
    await commandService.executeGameCommand({
      gameId: created.gameId,
      sessionToken: TOKEN,
      actionId: 'first',
      expectedRevision: 0,
      command: { type: 'attack' },
    });

    const snapshot = structuredClone(
      database.gameDocuments.get(created.gameId) as StoredGameDocument,
    );
    const restartedDatabase = new FakeDatabase();
    restartedDatabase.gameDocuments.set(
      created.gameId,
      structuredClone(snapshot),
    );
    const restarted = createGameCommandService({
      getDatabase: () => restartedDatabase as unknown as Db,
      now: () => new Date(NOW),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });
    const request = {
      gameId: created.gameId,
      sessionToken: TOKEN,
      actionId: 'after-restart',
      expectedRevision: 1,
      command: { type: 'attack' as const },
    };

    const uninterrupted = await commandService.executeGameCommand(request);
    const afterRestart = await restarted.executeGameCommand(request);
    expect(afterRestart).toEqual(uninterrupted);
    expect(restartedDatabase.gameDocuments.get(created.gameId)?.random).toEqual(
      database.gameDocuments.get(created.gameId)?.random,
    );
  });

  it('reproduces floor generation from persisted RNG state after service reconstruction', async () => {
    const { commandService, created } = await createdGame();
    const stored = database.gameDocuments.get(created.gameId);
    if (!stored) throw new Error('Expected a stored game');
    const stairs = stored.game.map
      .flat()
      .find((tile) => tile.type === 'stairs');
    if (!stairs) throw new Error('Expected stairs');
    stored.game.player.x = stairs.x;
    stored.game.player.y = stairs.y;
    const snapshot = structuredClone(stored);
    const restartedDatabase = new FakeDatabase();
    restartedDatabase.gameDocuments.set(created.gameId, snapshot);
    const restarted = createGameCommandService({
      getDatabase: () => restartedDatabase as unknown as Db,
      now: () => new Date(NOW),
      logger: testLogger(),
    });
    const request = {
      gameId: created.gameId,
      sessionToken: TOKEN,
      actionId: 'descend-after-restart',
      expectedRevision: 0,
      command: { type: 'descend' as const },
    };

    const uninterrupted = await commandService.executeGameCommand(request);
    const afterRestart = await restarted.executeGameCommand(request);

    expect(afterRestart).toEqual(uninterrupted);
    expect(restartedDatabase.gameDocuments.get(created.gameId)?.game).toEqual(
      database.gameDocuments.get(created.gameId)?.game,
    );
    expect(restartedDatabase.gameDocuments.get(created.gameId)?.random).toEqual(
      database.gameDocuments.get(created.gameId)?.random,
    );
  });

  it('retains bounded receipts and documents the retry window', async () => {
    const { commandService, created } = await createdGame();
    for (let revision = 0; revision < ACTION_RECEIPT_LIMIT + 2; revision++) {
      await commandService.executeGameCommand({
        gameId: created.gameId,
        sessionToken: TOKEN,
        actionId: `bounded-${revision}`,
        expectedRevision: revision,
        command: { type: 'attack' },
      });
    }
    const receipts = database.gameDocuments.get(created.gameId)?.actionReceipts;
    expect(receipts).toHaveLength(ACTION_RECEIPT_LIMIT);
    expect(receipts?.[0]?.actionId).toBe('bounded-2');
  });

  it('persists terminal state first, retries terminal actions, rejects new actions, and submits one score', async () => {
    applyTransition = vi.fn((state, _command, context) => {
      state.status = 'won';
      state.score = 999;
      state.updatedAt = context.clock.now();
      return {
        state,
        accepted: true,
        events: [
          { id: context.random.id('event'), type: 'game_won', message: 'Won' },
        ],
      };
    });
    const { commandService, created } = await createdGame();
    const request = {
      gameId: created.gameId,
      sessionToken: TOKEN,
      actionId: 'terminal',
      expectedRevision: 0,
      command: { type: 'attack' as const },
    };
    const result = await commandService.executeGameCommand(request);
    expect(database.gameDocuments.get(created.gameId)?.game.status).toBe('won');
    expect(await commandService.executeGameCommand(request)).toEqual(result);
    await expect(
      commandService.executeGameCommand({
        ...request,
        actionId: 'after-finish',
        expectedRevision: 1,
      }),
    ).rejects.toEqual(expectCode('GAME_FINISHED'));

    await Promise.all([
      commandService.deliverLeaderboard(created.gameId),
      commandService.deliverLeaderboard(created.gameId),
    ]);
    expect(database.leaderboardDocuments).toHaveLength(1);
    expect(database.leaderboardDocuments.get(created.gameId)?.score).toBe(999);
  });

  it('isolates leaderboard failure and later reconciles the durable outbox exactly once', async () => {
    applyTransition = vi.fn((state, _command, context) => {
      state.status = 'won';
      state.updatedAt = context.clock.now();
      return {
        state,
        accepted: true,
        events: [
          { id: context.random.id('event'), type: 'game_won', message: 'Won' },
        ],
      };
    });
    const commandService = service();
    const created = await commandService.createGameSession({
      playerName: 'Deferred Winner',
      character: 'bandit',
    });
    database.failLeaderboardWrites = true;

    await expect(
      commandService.executeGameCommand({
        gameId: created.gameId,
        sessionToken: TOKEN,
        actionId: 'deferred-terminal',
        expectedRevision: 0,
        command: { type: 'attack' },
      }),
    ).resolves.toMatchObject({ revision: 1, state: { status: 'won' } });
    await vi.waitFor(() => {
      expect(
        database.gameDocuments.get(created.gameId)?.leaderboard.status,
      ).toBe('pending');
    });

    database.failLeaderboardWrites = false;
    expect(await commandService.reconcilePendingLeaderboards()).toBe(1);
    expect(database.leaderboardDocuments).toHaveLength(1);
    expect(database.gameDocuments.get(created.gameId)?.leaderboard.status).toBe(
      'submitted',
    );
    expect(await commandService.reconcilePendingLeaderboards()).toBe(0);
    expect(database.leaderboardDocuments).toHaveLength(1);
  });

  it('serializes reconciliation and caps each pass and its write concurrency', async () => {
    const commandService = service();
    for (
      let index = 0;
      index < LEADERBOARD_RECONCILIATION_BATCH_SIZE + 5;
      index++
    ) {
      const created = await commandService.createGameSession({
        playerName: `Pending ${index}`,
        character: 'wizard',
      });
      const document = database.gameDocuments.get(created.gameId);
      if (!document) throw new Error('Expected a stored game');
      document.game.status = 'won';
      document.leaderboard = {
        status: 'pending',
        outcome: {
          playerName: document.game.playerName,
          score: index,
          floor: 1,
          killedBy: null,
          killedByType: null,
          killedByVariant: null,
          finishedAt: NOW,
        },
      };
    }
    let releaseWrites!: () => void;
    database.leaderboardWriteGate = new Promise<void>((resolve) => {
      releaseWrites = resolve;
    });

    const first = commandService.reconcilePendingLeaderboards();
    const overlapping = commandService.reconcilePendingLeaderboards();
    expect(overlapping).toBe(first);
    releaseWrites();

    await expect(first).resolves.toBe(LEADERBOARD_RECONCILIATION_BATCH_SIZE);
    expect(database.maxActiveLeaderboardWrites).toBeLessThanOrEqual(
      LEADERBOARD_RECONCILIATION_CONCURRENCY,
    );
    expect(
      [...database.gameDocuments.values()].filter(
        (document) => document.leaderboard.status === 'pending',
      ),
    ).toHaveLength(5);
  });
});
