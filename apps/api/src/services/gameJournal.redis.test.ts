import { randomUUID } from 'node:crypto';
import { GAMEPLAY_PROTOCOL_VERSION } from '@dungeon-crawler/protocol';
import { createClient, type RedisClientType } from 'redis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  GAME_REDUCER_VERSION,
  type GameJournalEntry,
  RedisGameJournal,
} from './gameJournal.js';

const integration = describe.runIf(process.env.RUN_REDIS_INTEGRATION === '1');

integration('Redis game journal integration', () => {
  let client: RedisClientType;
  let journal: RedisGameJournal;
  const prefix = `dungeon-crawler:test:${randomUUID()}:`;

  beforeAll(async () => {
    client = createClient({
      url: process.env.REDIS_TEST_URL ?? 'redis://127.0.0.1:6379',
    }) as RedisClientType;
    await client.connect();
    journal = new RedisGameJournal(client, prefix, 60, 4);
  });

  afterAll(async () => {
    if (client?.isReady) {
      const keys = await client.keys(`${prefix}*`);
      if (keys.length > 0) await client.del(keys);
      await client.quit();
    } else if (client?.isOpen) {
      client.destroy();
    }
  });

  function entry(actionId: string, expectedRevision: number): GameJournalEntry {
    const revision = expectedRevision + 1;
    return {
      schemaVersion: 1,
      reducerVersion: GAME_REDUCER_VERSION,
      protocolVersion: GAMEPLAY_PROTOCOL_VERSION,
      revision,
      expectedRevision,
      command: { type: 'attack' },
      occurredAt: '2026-09-02T12:00:00.000Z',
      randomState: { state: revision, idSequence: revision },
      stateHash: `state-${revision}`,
      leaderboard: { status: 'none' },
      receipt: {
        actionId,
        requestFingerprint: `${expectedRevision}:attack`,
        revision,
        events: [],
        deltas: [],
        recordedAt: new Date('2026-09-02T12:00:00.000Z'),
      },
    };
  }

  it('atomically accepts one command per revision and returns exact retries', async () => {
    const gameId = 'atomic-game';
    await journal.initialize(gameId, 0);

    const results = await Promise.all([
      journal.commit(gameId, entry('action-a', 0)),
      journal.commit(gameId, entry('action-b', 0)),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual([
      'committed',
      'revision_conflict',
    ]);
    const acceptedAction =
      results[0]?.status === 'committed' ? 'action-a' : 'action-b';
    const retry = await journal.commit(gameId, entry(acceptedAction, 0));
    expect(retry.status).toBe('exact_retry');
    expect((await journal.load(gameId))?.revision).toBe(1);
  });

  it('trims journal commands only after checkpoint confirmation', async () => {
    const gameId = 'checkpoint-game';
    await journal.initialize(gameId, 0);
    await journal.commit(gameId, entry('action-1', 0));
    await journal.commit(gameId, entry('action-2', 1));

    expect((await journal.load(gameId))?.entries).toHaveLength(2);
    await journal.confirmCheckpoint(gameId, 1);
    const loaded = await journal.load(gameId);
    expect(loaded?.entries.map((candidate) => candidate.revision)).toEqual([2]);
    expect(loaded?.receipts).toHaveLength(2);
  });
});
