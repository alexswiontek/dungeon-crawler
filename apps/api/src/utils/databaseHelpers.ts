import type { FastifyBaseLogger } from 'fastify';
import type {
  Collection,
  Document,
  Filter,
  OptionalUnlessRequiredId,
} from 'mongodb';
import { logAndThrow } from './errorHandler.js';

function handleDatabaseError(
  err: unknown,
  logger: FastifyBaseLogger | Console,
  operation: string,
  context: string,
  metadata?: Record<string, unknown>,
): never {
  return logAndThrow(err, logger, `Database ${operation} failed: ${context}`, {
    context,
    ...metadata,
  });
}

export async function safeInsertOne<T extends Document>(
  collection: Collection<T>,
  document: OptionalUnlessRequiredId<T>,
  logger: FastifyBaseLogger | Console,
  context: string,
): Promise<string> {
  try {
    const result = await collection.insertOne(document);
    return String(result.insertedId);
  } catch (err: unknown) {
    handleDatabaseError(err, logger, 'insertOne', context);
  }
}

export async function safeReplaceOne<T extends Document>(
  collection: Collection<T>,
  filter: Filter<T>,
  document: T,
  logger: FastifyBaseLogger | Console,
  context: string,
): Promise<number> {
  try {
    const result = await collection.replaceOne(filter, document);
    return result.modifiedCount;
  } catch (err: unknown) {
    handleDatabaseError(err, logger, 'replaceOne', context, { filter });
  }
}

export async function safeDeleteOne<T extends Document>(
  collection: Collection<T>,
  filter: Filter<T>,
  logger: FastifyBaseLogger | Console,
  context: string,
): Promise<number> {
  try {
    const result = await collection.deleteOne(filter);
    return result.deletedCount;
  } catch (err: unknown) {
    handleDatabaseError(err, logger, 'deleteOne', context, { filter });
  }
}
