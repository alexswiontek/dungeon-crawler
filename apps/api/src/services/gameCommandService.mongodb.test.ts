import { randomUUID } from 'node:crypto';
import type { GameTransition } from '@dungeon-crawler/domain';
import { BSON, type Db, MongoClient } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { LeaderboardDoc, StoredGameDocument } from '@/types/database.js';
import { createGameCommandService } from './gameCommandService.js';

const runIntegration = process.env.RUN_MONGODB_INTEGRATION === '1';
const integration = describe.runIf(runIntegration);

integration('MongoDB game command integration', () => {
  let client: MongoClient;
  let database: Db;

  beforeAll(async () => {
    const uri =
      process.env.MONGODB_TEST_URI ??
      'mongodb://127.0.0.1:27017/?directConnection=true';
    client = new MongoClient(uri, {
      serverSelectionTimeoutMS: 5_000,
      connectTimeoutMS: 5_000,
    });
    await client.connect();
    database = client.db(`dc_phase3_test_${randomUUID()}`);
    await database
      .collection('games')
      .createIndex(
        { 'actionReceipts.actionId': 1 },
        { unique: true, sparse: true },
      );
  });

  afterAll(async () => {
    if (database) await database.dropDatabase();
    if (client) await client.close();
  });

  function service(overrides = {}) {
    return createGameCommandService({
      getDatabase: () => database,
      now: () => new Date('2026-08-19T12:00:00.000Z'),
      createId: randomUUID,
      createToken: () => `token-${randomUUID()}`,
      createSeed: randomUUID,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      ...overrides,
    });
  }

  it('stores only a token hash and atomically permits one command per revision', async () => {
    const commandService = service();
    const created = await commandService.createGameSession({
      playerName: 'Mongo Ada',
      character: 'wizard',
    });
    const stored = await database
      .collection<StoredGameDocument>('games')
      .findOne({ _id: created.gameId });
    expect(stored?.sessionTokenHash).not.toBe(created.sessionToken);
    expect(JSON.stringify(stored)).not.toContain(created.sessionToken);

    const results = await Promise.allSettled([
      commandService.executeGameCommand({
        gameId: created.gameId,
        sessionToken: created.sessionToken,
        actionId: 'mongo-concurrent-a',
        expectedRevision: 0,
        command: { type: 'attack' },
      }),
      commandService.executeGameCommand({
        gameId: created.gameId,
        sessionToken: created.sessionToken,
        actionId: 'mongo-concurrent-b',
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
    expect(
      await database
        .collection<StoredGameDocument>('games')
        .findOne({ _id: created.gameId }),
    ).toMatchObject({ revision: 1 });
  });

  it('returns a durable receipt for an exact retry without advancing state', async () => {
    const commandService = service();
    const created = await commandService.createGameSession({
      playerName: 'Retry Ada',
      character: 'elf',
    });
    const request = {
      gameId: created.gameId,
      sessionToken: created.sessionToken,
      actionId: 'mongo-retry',
      expectedRevision: 0,
      command: { type: 'attack' as const },
    };
    const first = await commandService.executeGameCommand(request);

    // Constructing a new service simulates a process restart and forces the
    // retry to use only MongoDB state.
    const retry = await service().executeGameCommand(request);
    expect(retry).toEqual(first);
    const stored = await database
      .collection<StoredGameDocument>('games')
      .findOne({ _id: created.gameId });
    if (!stored) throw new Error('Expected a stored game document');
    const storedBsonBytes = BSON.calculateObjectSize(stored);
    console.info(`Stored game BSON size: ${storedBsonBytes} bytes`);
    expect(storedBsonBytes).toBeLessThan(16 * 1024 * 1024);
    expect(stored?.revision).toBe(1);
    expect(stored?.actionReceipts).toHaveLength(1);
  });

  it('enforces retained action identity across games with a real unique multikey index', async () => {
    const commandService = service();
    const [first, second] = await Promise.all([
      commandService.createGameSession({
        playerName: 'First',
        character: 'dwarf',
      }),
      commandService.createGameSession({
        playerName: 'Second',
        character: 'bandit',
      }),
    ]);
    const results = await Promise.allSettled([
      commandService.executeGameCommand({
        gameId: first.gameId,
        sessionToken: first.sessionToken,
        actionId: 'shared-mongo-action',
        expectedRevision: 0,
        command: { type: 'attack' },
      }),
      commandService.executeGameCommand({
        gameId: second.gameId,
        sessionToken: second.sessionToken,
        actionId: 'shared-mongo-action',
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
    expect(
      await database.collection<StoredGameDocument>('games').countDocuments({
        'actionReceipts.actionId': 'shared-mongo-action',
      }),
    ).toBe(1);
  });

  it('creates at most one leaderboard row under concurrent terminal delivery', async () => {
    const terminalTransition = (
      state: StoredGameDocument['game'],
    ): GameTransition => {
      state.status = 'won';
      state.score = 1_234;
      return {
        state,
        accepted: true,
        events: [{ id: 'win-event', type: 'game_won', message: 'Won' }],
      };
    };
    const commandService = service({ applyTransition: terminalTransition });
    const created = await commandService.createGameSession({
      playerName: 'Winner',
      character: 'wizard',
    });
    await commandService.executeGameCommand({
      gameId: created.gameId,
      sessionToken: created.sessionToken,
      actionId: 'terminal-mongo-action',
      expectedRevision: 0,
      command: { type: 'attack' },
    });
    await Promise.all([
      commandService.deliverLeaderboard(created.gameId),
      commandService.deliverLeaderboard(created.gameId),
      commandService.deliverLeaderboard(created.gameId),
    ]);
    expect(
      await database
        .collection<LeaderboardDoc>('leaderboard')
        .countDocuments({ _id: created.gameId }),
    ).toBe(1);
  });
});
