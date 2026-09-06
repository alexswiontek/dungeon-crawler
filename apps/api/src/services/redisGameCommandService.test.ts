import type { Db } from 'mongodb';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { type GameJournal, MemoryGameJournal } from '@/services/gameJournal.js';
import type {
  LeaderboardDoc,
  LegacyGameDocument,
  StoredGameDocument,
} from '@/types/database.js';
import { createRedisGameCommandService } from './redisGameCommandService.js';

class FakeDatabase {
  readonly games = new Map<string, StoredGameDocument>();
  readonly legacyGames = new Map<string, LegacyGameDocument>();
  readonly leaderboard = new Map<string, LeaderboardDoc>();
  readonly checkpointRevisions: number[] = [];
  readonly gameReads: string[] = [];
  checkpointGate: Promise<void> | null = null;

  collection<_T>(name: string) {
    if (name === 'games') return this.gameCollection() as never;
    if (name === 'leaderboard') return this.leaderboardCollection() as never;
    throw new Error(`Unexpected collection ${name}`);
  }

  private gameCollection() {
    return {
      findOne: async (filter: Record<string, unknown>) => {
        if (typeof filter._id !== 'string') return null;
        if (filter.sessionTokenHash && filter.game) {
          return structuredClone(this.legacyGames.get(filter._id) ?? null);
        }
        this.gameReads.push(filter._id);
        return structuredClone(this.games.get(filter._id) ?? null);
      },
      insertOne: async (document: StoredGameDocument) => {
        this.games.set(document._id, structuredClone(document));
        return { acknowledged: true, insertedId: document._id };
      },
      replaceOne: async (
        filter: { _id: string; revision?: number },
        document: StoredGameDocument,
      ) => {
        if (filter.revision === undefined) {
          if (!this.legacyGames.has(filter._id)) return { matchedCount: 0 };
          this.legacyGames.delete(filter._id);
          this.games.set(document._id, structuredClone(document));
          return { matchedCount: 1 };
        }
        if (this.checkpointGate) await this.checkpointGate;
        const current = this.games.get(filter._id);
        if (!current || current.revision !== filter.revision)
          return { matchedCount: 0 };
        this.games.set(document._id, structuredClone(document));
        this.checkpointRevisions.push(document.revision);
        return { matchedCount: 1 };
      },
      deleteOne: async (filter: { _id: string; sessionTokenHash: string }) => {
        const current = this.games.get(filter._id);
        if (!current || current.sessionTokenHash !== filter.sessionTokenHash) {
          return { deletedCount: 0 };
        }
        this.games.delete(filter._id);
        return { deletedCount: 1 };
      },
      updateOne: async () => ({ matchedCount: 1 }),
      find: () => {
        const cursor = {
          limit: () => cursor,
          toArray: async () => [],
        };
        return cursor;
      },
    };
  }

  private leaderboardCollection() {
    return {
      updateOne: async () => ({ matchedCount: 1 }),
    };
  }
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

interface HydrationLog {
  gameId: string;
  hydrationDurationMs: number;
}

function isHydrationLog(fields: object): fields is HydrationLog {
  return (
    'gameId' in fields &&
    typeof fields.gameId === 'string' &&
    'hydrationDurationMs' in fields &&
    typeof fields.hydrationDurationMs === 'number'
  );
}

describe('Redis-backed game command service', () => {
  let database: FakeDatabase;
  let journal: MemoryGameJournal;
  let logger: {
    info: Mock<(fields: object, message?: string) => void>;
    warn: Mock<(fields: object, message?: string) => void>;
    error: Mock<(fields: object, message?: string) => void>;
  };
  let id = 0;

  beforeEach(() => {
    database = new FakeDatabase();
    journal = new MemoryGameJournal();
    logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    id = 0;
  });

  function hydrationsOf(gameId: string): number {
    return logger.info.mock.calls.filter(
      ([fields]) => isHydrationLog(fields) && fields.gameId === gameId,
    ).length;
  }

  function service(
    gameJournal: GameJournal = journal,
    overrides: Partial<
      Parameters<typeof createRedisGameCommandService>[0]
    > = {},
  ) {
    return createRedisGameCommandService({
      getDatabase: () => database as unknown as Db,
      getJournal: () => gameJournal,
      now: () => new Date('2026-09-02T12:00:00.000Z'),
      monotonicNow: (() => {
        let now = 0;
        return () => ++now;
      })(),
      createId: () => `id-${++id}`,
      createToken: () => 'test-session-token',
      createSeed: () => 'test-seed',
      logger,
      scheduleRetry: vi.fn(),
      checkpointCommandInterval: 1,
      ...overrides,
    });
  }

  async function create(commandService = service()) {
    const created = await commandService.createGameSession({
      playerName: 'Ada',
      character: 'wizard',
    });
    return { commandService, created };
  }

  it('acknowledges Redis before a blocked MongoDB checkpoint finishes', async () => {
    const { commandService, created } = await create();
    const gate = deferred();
    database.checkpointGate = gate.promise;

    const result = await commandService.executeGameCommand({
      gameId: created.gameId,
      sessionToken: created.sessionToken,
      actionId: 'action-1',
      expectedRevision: 0,
      command: { type: 'attack' },
    });

    expect(result.revision).toBe(1);
    expect(database.games.get(created.gameId)?.revision).toBe(0);
    expect((await journal.load(created.gameId))?.revision).toBe(1);
    gate.resolve();
    await commandService.flushCheckpoints();
    expect(database.games.get(created.gameId)?.revision).toBe(1);
    expect((await journal.load(created.gameId))?.entries).toHaveLength(0);
  });

  it('returns exact retries without advancing the revision twice', async () => {
    const { commandService, created } = await create();
    const request = {
      gameId: created.gameId,
      sessionToken: created.sessionToken,
      actionId: 'retry-action',
      expectedRevision: 0,
      command: { type: 'attack' as const },
    };

    const first = await commandService.executeGameCommand(request);
    const retry = await commandService.executeGameCommand(request);

    expect(retry).toEqual(first);
    expect((await journal.load(created.gameId))?.revision).toBe(1);
  });

  it('serializes concurrent commands so only one can commit a revision', async () => {
    const { commandService, created } = await create();
    const results = await Promise.allSettled([
      commandService.executeGameCommand({
        gameId: created.gameId,
        sessionToken: created.sessionToken,
        actionId: 'concurrent-a',
        expectedRevision: 0,
        command: { type: 'attack' },
      }),
      commandService.executeGameCommand({
        gameId: created.gameId,
        sessionToken: created.sessionToken,
        actionId: 'concurrent-b',
        expectedRevision: 0,
        command: { type: 'attack' },
      }),
    ]);

    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    expect((await journal.load(created.gameId))?.revision).toBe(1);
  });

  it('keeps checkpoint writes ordered and coalesces obsolete pending snapshots', async () => {
    const { commandService, created } = await create();
    const gate = deferred();
    database.checkpointGate = gate.promise;
    for (let revision = 0; revision < 3; revision++) {
      await commandService.executeGameCommand({
        gameId: created.gameId,
        sessionToken: created.sessionToken,
        actionId: `checkpoint-${revision + 1}`,
        expectedRevision: revision,
        command: { type: 'attack' },
      });
    }

    gate.resolve();
    await commandService.flushCheckpoints();

    expect(database.checkpointRevisions).toEqual([1, 3]);
    expect(database.games.get(created.gameId)?.revision).toBe(3);
    expect((await journal.load(created.gameId))?.entries).toHaveLength(0);
  });

  it('recovers acknowledged commands after an API restart', async () => {
    const firstService = service();
    const { created } = await create(firstService);
    const gate = deferred();
    database.checkpointGate = gate.promise;
    await firstService.executeGameCommand({
      gameId: created.gameId,
      sessionToken: created.sessionToken,
      actionId: 'action-1',
      expectedRevision: 0,
      command: { type: 'attack' },
    });
    const second = await firstService.executeGameCommand({
      gameId: created.gameId,
      sessionToken: created.sessionToken,
      actionId: 'action-2',
      expectedRevision: 1,
      command: { type: 'attack' },
    });

    const restarted = service();
    const recovered = await restarted.readGame(
      created.gameId,
      created.sessionToken,
    );

    expect(recovered.revision).toBe(2);
    expect(recovered.state).toEqual(second.state);
    gate.resolve();
    await firstService.flushCheckpoints();
  });

  it('recovers an ambiguous Redis acknowledgment on retry with the same action', async () => {
    const ambiguousJournal: GameJournal = {
      initialize: (...arguments_) => journal.initialize(...arguments_),
      load: (...arguments_) => journal.load(...arguments_),
      confirmCheckpoint: (...arguments_) =>
        journal.confirmCheckpoint(...arguments_),
      delete: (...arguments_) => journal.delete(...arguments_),
      commit: vi.fn(async (gameId, entry) => {
        const result = await journal.commit(gameId, entry);
        if (vi.mocked(ambiguousJournal.commit).mock.calls.length === 1) {
          throw new Error('simulated lost Redis response');
        }
        return result;
      }),
    };
    const { commandService, created } = await create(service(ambiguousJournal));
    const request = {
      gameId: created.gameId,
      sessionToken: created.sessionToken,
      actionId: 'ambiguous-action',
      expectedRevision: 0,
      command: { type: 'attack' as const },
    };

    await expect(
      commandService.executeGameCommand(request),
    ).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
    });
    const retry = await commandService.executeGameCommand(request);

    expect(retry).toMatchObject({ actionId: 'ambiguous-action', revision: 1 });
    expect((await journal.load(created.gameId))?.revision).toBe(1);
  });

  it('does not fall back to MongoDB when Redis is unavailable', async () => {
    const unavailable: GameJournal = {
      initialize: () => Promise.reject(new Error('Redis unavailable')),
      load: () => Promise.reject(new Error('Redis unavailable')),
      commit: () => Promise.reject(new Error('Redis unavailable')),
      confirmCheckpoint: () => Promise.reject(new Error('Redis unavailable')),
      delete: () => Promise.reject(new Error('Redis unavailable')),
    };

    await expect(
      service(unavailable).createGameSession({
        playerName: 'Ada',
        character: 'wizard',
      }),
    ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    expect([...database.games.values()]).toHaveLength(1);
    expect([...database.games.values()][0]?.revision).toBe(0);
  });

  it('returns service unavailable for a failed command commit without changing MongoDB', async () => {
    const unavailableCommit: GameJournal = {
      initialize: (...arguments_) => journal.initialize(...arguments_),
      load: (...arguments_) => journal.load(...arguments_),
      confirmCheckpoint: (...arguments_) =>
        journal.confirmCheckpoint(...arguments_),
      delete: (...arguments_) => journal.delete(...arguments_),
      commit: () => Promise.reject(new Error('Redis unavailable')),
    };
    const { commandService, created } = await create(
      service(unavailableCommit),
    );

    await expect(
      commandService.executeGameCommand({
        gameId: created.gameId,
        sessionToken: created.sessionToken,
        actionId: 'failed-commit',
        expectedRevision: 0,
        command: { type: 'attack' },
      }),
    ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });

    expect(database.games.get(created.gameId)?.revision).toBe(0);
    expect((await journal.load(created.gameId))?.revision).toBe(0);
  });

  it('rejects a recovery journal with a revision gap', async () => {
    const firstService = service();
    const { created } = await create(firstService);
    const gate = deferred();
    database.checkpointGate = gate.promise;
    await firstService.executeGameCommand({
      gameId: created.gameId,
      sessionToken: created.sessionToken,
      actionId: 'gap-source',
      expectedRevision: 0,
      command: { type: 'attack' },
    });
    const corruptJournal: GameJournal = {
      initialize: (...arguments_) => journal.initialize(...arguments_),
      load: async (...arguments_) => {
        const loaded = await journal.load(...arguments_);
        if (loaded?.entries[0]) loaded.entries[0].revision = 2;
        return loaded;
      },
      commit: (...arguments_) => journal.commit(...arguments_),
      confirmCheckpoint: (...arguments_) =>
        journal.confirmCheckpoint(...arguments_),
      delete: (...arguments_) => journal.delete(...arguments_),
    };

    await expect(
      service(corruptJournal).readGame(created.gameId, created.sessionToken),
    ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    gate.resolve();
    await firstService.flushCheckpoints();
  });

  it('drops a finished game from the warm cache after its checkpoint', async () => {
    const finishing = service(journal, {
      applyTransition: (state) => {
        state.status = 'won';
        return { state, events: [], accepted: true };
      },
    });
    const { created } = await create(finishing);

    await finishing.executeGameCommand({
      gameId: created.gameId,
      sessionToken: created.sessionToken,
      actionId: 'action-1',
      expectedRevision: 0,
      command: { type: 'descend' },
    });
    await finishing.flushCheckpoints();
    await finishing.readGame(created.gameId, created.sessionToken);

    expect(hydrationsOf(created.gameId)).toBe(1);
  });

  it('keeps an unfinished game warm after its checkpoint', async () => {
    const { commandService, created } = await create();

    await commandService.executeGameCommand({
      gameId: created.gameId,
      sessionToken: created.sessionToken,
      actionId: 'action-1',
      expectedRevision: 0,
      command: { type: 'attack' },
    });
    await commandService.flushCheckpoints();
    await commandService.readGame(created.gameId, created.sessionToken);

    expect(hydrationsOf(created.gameId)).toBe(0);
  });

  it('evicts the least recently used game once the cache limit is passed', async () => {
    const bounded = service(journal, { warmGameCacheLimit: 2 });
    const first = await create(bounded);
    const second = await create(bounded);

    // Touching the first leaves the second as the least recently used entry.
    await bounded.readGame(first.created.gameId, first.created.sessionToken);
    const third = await create(bounded);

    await bounded.readGame(first.created.gameId, first.created.sessionToken);
    await bounded.readGame(third.created.gameId, third.created.sessionToken);
    await bounded.readGame(second.created.gameId, second.created.sessionToken);

    expect(hydrationsOf(first.created.gameId)).toBe(0);
    expect(hydrationsOf(third.created.gameId)).toBe(0);
    expect(hydrationsOf(second.created.gameId)).toBe(1);
  });
});
