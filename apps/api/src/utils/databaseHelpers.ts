/**
 * Database operation wrappers with comprehensive error handling
 * These helpers log errors comprehensively and propagate exceptions after logging
 * to allow callers to handle failures appropriately
 */

import type { FastifyBaseLogger } from 'fastify';
import type {
  Collection,
  Document,
  Filter,
  OptionalUnlessRequiredId,
} from 'mongodb';
import { logAndThrow } from './errorHandler.js';

/**
 * Centralized error handler for database operations
 * Logs the error with context and re-throws it for caller handling
 */
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

/**
 * Safely insert a document into a collection with error handling
 * Logs errors comprehensively but throws after logging to allow callers to handle failures
 *
 * @param collection - MongoDB collection to insert into
 * @param document - Document to insert
 * @param logger - Optional logger for error reporting
 * @param context - Context description for error messages (e.g., "creating new game")
 * @returns The inserted document ID
 * @throws Error if the insert operation fails
 */
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

/**
 * Safely replace a document in a collection with error handling
 * Logs errors comprehensively but throws after logging to allow callers to handle failures
 *
 * @param collection - MongoDB collection to replace in
 * @param filter - Filter to find document to replace
 * @param document - Replacement document
 * @param logger - Optional logger for error reporting
 * @param context - Context description for error messages (e.g., "saving game state")
 * @returns Number of documents modified
 * @throws Error if the replace operation fails
 */
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

/**
 * Safely delete a document from a collection with error handling
 * Logs errors comprehensively but throws after logging to allow callers to handle failures
 *
 * @param collection - MongoDB collection to delete from
 * @param filter - Filter to find document to delete
 * @param logger - Optional logger for error reporting
 * @param context - Context description for error messages (e.g., "removing old game")
 * @returns Number of documents deleted
 * @throws Error if the delete operation fails
 */
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
