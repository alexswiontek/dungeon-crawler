import type { GameCommand, SeededRandomState } from '@dungeon-crawler/domain';
import { GAMEPLAY_PROTOCOL_VERSION } from '@dungeon-crawler/protocol';
import type { RedisClientType } from 'redis';
import type {
  GameActionReceipt,
  LeaderboardDelivery,
} from '@/types/database.js';
import { GAME_TTL_SECONDS } from '@/utils/constants.js';

export const GAME_REDUCER_VERSION = '1';

export interface GameJournalEntry {
  schemaVersion: 1;
  reducerVersion: typeof GAME_REDUCER_VERSION;
  protocolVersion: typeof GAMEPLAY_PROTOCOL_VERSION;
  revision: number;
  expectedRevision: number;
  command: GameCommand;
  occurredAt: string;
  randomState: SeededRandomState;
  stateHash: string;
  leaderboard: LeaderboardDelivery;
  receipt: GameActionReceipt;
}

export interface LoadedGameJournal {
  revision: number;
  checkpointRevision: number;
  reducerVersion: string;
  protocolVersion: string;
  entries: GameJournalEntry[];
  receipts: GameActionReceipt[];
}

export type JournalCommitResult =
  | { status: 'committed'; byteSize: number }
  | { status: 'exact_retry'; receipt: GameActionReceipt; byteSize: number }
  | { status: 'revision_conflict'; revision: number }
  | { status: 'action_id_reused' };

export interface GameJournal {
  initialize(gameId: string, checkpointRevision: number): Promise<void>;
  load(gameId: string): Promise<LoadedGameJournal | null>;
  commit(gameId: string, entry: GameJournalEntry): Promise<JournalCommitResult>;
  confirmCheckpoint(gameId: string, revision: number): Promise<void>;
  delete(gameId: string): Promise<void>;
}

const INITIALIZE_SCRIPT = `
local key = KEYS[1]
local checkpoint = tonumber(ARGV[1])
local current = tonumber(redis.call('HGET', key, 'revision') or -1)
if current < checkpoint then
  redis.call('DEL', key)
end
if redis.call('EXISTS', key) == 0 then
  redis.call('HSET', key,
    'revision', checkpoint,
    'checkpointRevision', checkpoint,
    'reducerVersion', ARGV[2],
    'protocolVersion', ARGV[3],
    'receiptOrder', '[]')
end
redis.call('EXPIRE', key, tonumber(ARGV[4]))
return redis.call('HGET', key, 'revision')
`;

const COMMIT_SCRIPT = `
local key = KEYS[1]
local expected = tonumber(ARGV[1])
local nextRevision = tonumber(ARGV[2])
local actionId = ARGV[3]
local fingerprint = ARGV[4]
local entryJson = ARGV[5]
local receiptJson = ARGV[6]
local receiptLimit = tonumber(ARGV[7])
local ttl = tonumber(ARGV[8])
local receiptField = 'receipt:' .. actionId
local existing = redis.call('HGET', key, receiptField)
if existing then
  local decoded = cjson.decode(existing)
  redis.call('EXPIRE', key, ttl)
  if decoded.requestFingerprint == fingerprint then
    return { 'exact_retry', existing }
  end
  return { 'action_id_reused' }
end
local current = tonumber(redis.call('HGET', key, 'revision'))
if not current or current ~= expected then
  return { 'revision_conflict', tostring(current or -1) }
end
local order = cjson.decode(redis.call('HGET', key, 'receiptOrder') or '[]')
table.insert(order, actionId)
while #order > receiptLimit do
  local removed = table.remove(order, 1)
  redis.call('HDEL', key, 'receipt:' .. removed)
end
redis.call('HSET', key,
  'revision', nextRevision,
  'journal:' .. nextRevision, entryJson,
  receiptField, receiptJson,
  'receiptOrder', cjson.encode(order))
redis.call('EXPIRE', key, ttl)
return { 'committed' }
`;

const CHECKPOINT_SCRIPT = `
local key = KEYS[1]
local revision = tonumber(ARGV[1])
local previous = tonumber(redis.call('HGET', key, 'checkpointRevision') or -1)
local current = tonumber(redis.call('HGET', key, 'revision') or -1)
if revision > current then return { err = 'checkpoint_ahead_of_journal' } end
if revision > previous then
  for value = previous + 1, revision do
    redis.call('HDEL', key, 'journal:' .. value)
  end
  redis.call('HSET', key, 'checkpointRevision', revision)
end
redis.call('EXPIRE', key, tonumber(ARGV[2]))
return 'ok'
`;

function reviveReceipt(receipt: GameActionReceipt): GameActionReceipt {
  return { ...receipt, recordedAt: new Date(receipt.recordedAt) };
}

function reviveLeaderboard(delivery: LeaderboardDelivery): LeaderboardDelivery {
  if (delivery.status === 'none') return delivery;
  return {
    ...delivery,
    outcome: {
      ...delivery.outcome,
      finishedAt: new Date(delivery.outcome.finishedAt),
    },
  };
}

function parseEntry(value: string): GameJournalEntry {
  const entry = JSON.parse(value) as GameJournalEntry;
  return {
    ...entry,
    leaderboard: reviveLeaderboard(entry.leaderboard),
    receipt: reviveReceipt(entry.receipt),
  };
}

function parseEvalArray(value: unknown): string[] {
  if (!Array.isArray(value))
    throw new Error('Redis returned an invalid journal result');
  return value.map(String);
}

export class RedisGameJournal implements GameJournal {
  constructor(
    private readonly client: RedisClientType,
    private readonly keyPrefix = 'dungeon-crawler:game:',
    private readonly ttlSeconds = GAME_TTL_SECONDS,
    private readonly receiptLimit = 16,
  ) {}

  async initialize(gameId: string, checkpointRevision: number): Promise<void> {
    await this.client.eval(INITIALIZE_SCRIPT, {
      keys: [this.key(gameId)],
      arguments: [
        String(checkpointRevision),
        GAME_REDUCER_VERSION,
        GAMEPLAY_PROTOCOL_VERSION,
        String(this.ttlSeconds),
      ],
    });
  }

  async load(gameId: string): Promise<LoadedGameJournal | null> {
    const values = await this.client.hGetAll(this.key(gameId));
    if (Object.keys(values).length === 0) return null;
    const entries = Object.entries(values)
      .filter(([field]) => field.startsWith('journal:'))
      .map(([, value]) => parseEntry(value))
      .sort((left, right) => left.revision - right.revision);
    const order = JSON.parse(values.receiptOrder ?? '[]') as string[];
    const receipts = order.flatMap((actionId) => {
      const value = values[`receipt:${actionId}`];
      return value
        ? [reviveReceipt(JSON.parse(value) as GameActionReceipt)]
        : [];
    });
    return {
      revision: Number(values.revision),
      checkpointRevision: Number(values.checkpointRevision),
      reducerVersion: values.reducerVersion ?? '',
      protocolVersion: values.protocolVersion ?? '',
      entries,
      receipts,
    };
  }

  async commit(
    gameId: string,
    entry: GameJournalEntry,
  ): Promise<JournalCommitResult> {
    const entryJson = JSON.stringify(entry);
    const receiptJson = JSON.stringify(entry.receipt);
    const response = parseEvalArray(
      await this.client.eval(COMMIT_SCRIPT, {
        keys: [this.key(gameId)],
        arguments: [
          String(entry.expectedRevision),
          String(entry.revision),
          entry.receipt.actionId,
          entry.receipt.requestFingerprint,
          entryJson,
          receiptJson,
          String(this.receiptLimit),
          String(this.ttlSeconds),
        ],
      }),
    );
    const byteSize =
      Buffer.byteLength(entryJson) + Buffer.byteLength(receiptJson);
    switch (response[0]) {
      case 'committed':
        return { status: 'committed', byteSize };
      case 'exact_retry':
        return {
          status: 'exact_retry',
          receipt: reviveReceipt(
            JSON.parse(response[1] ?? '') as GameActionReceipt,
          ),
          byteSize: Buffer.byteLength(response[1] ?? ''),
        };
      case 'revision_conflict':
        return { status: 'revision_conflict', revision: Number(response[1]) };
      default:
        return { status: 'action_id_reused' };
    }
  }

  async confirmCheckpoint(gameId: string, revision: number): Promise<void> {
    await this.client.eval(CHECKPOINT_SCRIPT, {
      keys: [this.key(gameId)],
      arguments: [String(revision), String(this.ttlSeconds)],
    });
  }

  async delete(gameId: string): Promise<void> {
    await this.client.del(this.key(gameId));
  }

  private key(gameId: string): string {
    return `${this.keyPrefix}${gameId}`;
  }
}

export class MemoryGameJournal implements GameJournal {
  private readonly games = new Map<string, LoadedGameJournal>();

  async initialize(gameId: string, checkpointRevision: number): Promise<void> {
    if (this.games.has(gameId)) return;
    this.games.set(gameId, {
      revision: checkpointRevision,
      checkpointRevision,
      reducerVersion: GAME_REDUCER_VERSION,
      protocolVersion: GAMEPLAY_PROTOCOL_VERSION,
      entries: [],
      receipts: [],
    });
  }

  async load(gameId: string): Promise<LoadedGameJournal | null> {
    const stored = this.games.get(gameId);
    return stored ? structuredClone(stored) : null;
  }

  async commit(
    gameId: string,
    entry: GameJournalEntry,
  ): Promise<JournalCommitResult> {
    const stored = this.games.get(gameId);
    if (!stored) throw new Error('Game journal is not initialized');
    const existing = stored.receipts.find(
      (receipt) => receipt.actionId === entry.receipt.actionId,
    );
    const byteSize =
      Buffer.byteLength(JSON.stringify(entry)) +
      Buffer.byteLength(JSON.stringify(entry.receipt));
    if (existing) {
      return existing.requestFingerprint === entry.receipt.requestFingerprint
        ? {
            status: 'exact_retry',
            receipt: structuredClone(existing),
            byteSize,
          }
        : { status: 'action_id_reused' };
    }
    if (stored.revision !== entry.expectedRevision) {
      return { status: 'revision_conflict', revision: stored.revision };
    }
    stored.revision = entry.revision;
    stored.entries.push(structuredClone(entry));
    stored.receipts.push(structuredClone(entry.receipt));
    stored.receipts = stored.receipts.slice(-this.receiptLimit);
    return { status: 'committed', byteSize };
  }

  constructor(private readonly receiptLimit = 16) {}

  async confirmCheckpoint(gameId: string, revision: number): Promise<void> {
    const stored = this.games.get(gameId);
    if (!stored) return;
    stored.checkpointRevision = Math.max(stored.checkpointRevision, revision);
    stored.entries = stored.entries.filter(
      (entry) => entry.revision > revision,
    );
  }

  async delete(gameId: string): Promise<void> {
    this.games.delete(gameId);
  }
}
