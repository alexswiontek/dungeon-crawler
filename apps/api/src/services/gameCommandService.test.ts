import { reduceGame } from '@dungeon-crawler/domain';
import type { Db } from 'mongodb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LeaderboardDoc, StoredGameDocument } from '@/types/database.js';
import type { GameServiceError } from '@/types/gameServiceErrors.js';
import {
  ACTION_RECEIPT_LIMIT,
  createGameCommandService,
} from './gameCommandService.js';
import { hashSessionToken } from './sessionToken.js';

class FakeDatabase {
  readonly gameDocuments = new Map<string, StoredGameDocument>();
  readonly leaderboardDocuments = new Map<string, LeaderboardDoc>();
  failNextReplace = false;
  failLeaderboardWrites = false;

  collection<_T>(name: string) {
    if (name === 'games') return this.gamesCollection() as never;
    if (name === 'leaderboard') return this.leaderboardCollection() as never;
    throw new Error(`Unexpected collection ${name}`);
  }

  private gamesCollection() {
    return {
      findOne: async (filter: Record<string, unknown>) => {
        if (typeof filter._id === 'string') {
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
        filter: { _id: string; revision: number },
        document: StoredGameDocument,
      ) => {
        if (this.failNextReplace) {
          this.failNextReplace = false;
          throw new Error('simulated database write failure');
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
      deleteOne: async (filter: { _id: string; sessionTokenHash: string }) => {
        const document = this.gameDocuments.get(filter._id);
        if (
          !document ||
          document.sessionTokenHash !== filter.sessionTokenHash
        ) {
          return { acknowledged: true, deletedCount: 0 };
        }
        this.gameDocuments.delete(filter._id);
        return { acknowledged: true, deletedCount: 1 };
      },
      find: (filter: { 'leaderboard.status': string }) => ({
        toArray: async () =>
          [...this.gameDocuments.values()].filter(
            (document) =>
              document.leaderboard.status === filter['leaderboard.status'],
          ),
      }),
    };
  }

  private leaderboardCollection() {
    return {
      updateOne: async (
        filter: { _id: string },
        update: { $setOnInsert: Omit<LeaderboardDoc, '_id'> },
      ) => {
        if (!this.leaderboardDocuments.has(filter._id)) {
          this.leaderboardDocuments.set(filter._id, {
            _id: filter._id,
            ...structuredClone(update.$setOnInsert),
          });
        }
        return { acknowledged: true, matchedCount: 1, modifiedCount: 0 };
      },
    };
  }
}

const TOKEN = 'test-session-token-with-256-bits-of-fixture-entropy';
const NOW = new Date('2026-08-19T12:00:00.000Z');

function expectCode(code: GameServiceError['code']) {
  return expect.objectContaining({ code });
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
    const testLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const commandService = service({ logger: testLogger });
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
    expect(JSON.stringify(testLogger.error.mock.calls)).not.toContain(TOKEN);
    await failure.catch((error) => {
      expect(JSON.stringify(error)).not.toContain(TOKEN);
    });
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
});
