import { type Db, MongoClient, type MongoClientOptions } from 'mongodb';
import { GAME_TTL_SECONDS } from '@/utils/constants.js';
import { logger } from '@/utils/logger.js';

const MONGODB_URI = process.env.MONGODB_URI;

const mongoOptions: MongoClientOptions = {
  maxPoolSize: 10,
  minPoolSize: 2,
  ignoreUndefined: true,
  retryWrites: true,
  retryReads: true,
  connectTimeoutMS: 5000,
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 5000,
};

let client: MongoClient | null = null;
let db: Db | null = null;

export async function connectToDatabase(): Promise<Db> {
  if (db) return db;

  if (!MONGODB_URI) {
    throw new Error('Please define the MONGODB_URI environment variable');
  }

  const newClient = new MongoClient(MONGODB_URI, mongoOptions);
  try {
    await newClient.connect();
    db = newClient.db();
    client = newClient;

    await db
      .collection('games')
      .createIndex(
        { updatedAt: 1 },
        { expireAfterSeconds: GAME_TTL_SECONDS, background: true },
      );
    // Receipt IDs are unique only within the command service's bounded retry window.
    await db
      .collection('games')
      .createIndex(
        { 'actionReceipts.actionId': 1 },
        { unique: true, sparse: true, background: true },
      );

    logger.info('Creating database indexes...');
    await db
      .collection('leaderboard')
      .createIndex({ score: -1 }, { background: true });

    await db
      .collection('leaderboard')
      .createIndex({ createdAt: -1 }, { background: true });

    logger.info(
      { database: db.databaseName },
      'Connected to MongoDB successfully',
    );
    return db;
  } catch (error) {
    await newClient.close();
    throw error;
  }
}

export function getDb(): Db {
  if (!db) {
    throw new Error('Database not connected. Call connectToDatabase first.');
  }
  return db;
}

export async function closeDatabase(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
    logger.info('Disconnected from MongoDB');
  }
}

export async function isDatabaseHealthy(): Promise<boolean> {
  try {
    if (!db) return false;
    await db.command({ ping: 1 });
    return true;
  } catch {
    return false;
  }
}
