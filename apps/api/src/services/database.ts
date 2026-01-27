import { type Db, MongoClient, type MongoClientOptions } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;

// TTL for inactive games: 7 days in seconds
const GAME_TTL_SECONDS = 7 * 24 * 60 * 60;

// Connection pool configuration
const mongoOptions: MongoClientOptions = {
  maxPoolSize: 10,
  minPoolSize: 2,
  retryWrites: true,
  retryReads: true,
  connectTimeoutMS: 10000,
  serverSelectionTimeoutMS: 10000,
};

let client: MongoClient | null = null;
let db: Db | null = null;

export async function connectToDatabase(): Promise<Db> {
  if (db) return db;

  if (!MONGODB_URI) {
    throw new Error('Please define the MONGODB_URI environment variable');
  }

  client = new MongoClient(MONGODB_URI, mongoOptions);
  await client.connect();
  db = client.db();

  // Create TTL index to auto-delete inactive games after 7 days
  await db
    .collection('games')
    .createIndex(
      { updatedAt: 1 },
      { expireAfterSeconds: GAME_TTL_SECONDS, background: true },
    );

  console.log('Connected to MongoDB');
  return db;
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
    console.log('Disconnected from MongoDB');
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
