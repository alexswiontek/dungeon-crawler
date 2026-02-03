import { randomUUID } from 'node:crypto';
import {
  type CharacterType,
  type ClientMessage,
  type GameStatus,
  isDirection,
  type MoveRequest,
  type NewGameRequest,
  type ServerMessage,
} from '@dungeon-crawler/shared';
import type { FastifyInstance } from 'fastify';
import {
  englishDataset,
  englishRecommendedTransformers,
  RegExpMatcher,
} from 'obscenity';
import { z } from 'zod';
import { getDb, isDatabaseHealthy } from '@/services/database.js';
import {
  createNewGame,
  descendStairs,
  getVisibleState,
  processAttackWithDeltas,
  processMove,
  processMoveWithDeltas,
} from '@/services/gameLogic.js';
import {
  getCachedGameState,
  pauseSession,
  registerSession,
  resumeSession,
  saveGameStateToDb,
  unregisterSession,
  updateCachedGameState,
  updateSessionActivity,
} from '@/services/gameSessionManager.js';
import {
  safeSubmitDeathScore,
  safeSubmitVictoryScore,
} from '@/services/leaderboardService.js';
import { createErrorResponse, ErrorCode } from '@/types/apiErrors.js';
import type { GameDoc } from '@/types/database.js';
import {
  MAX_MESSAGE_SIZE,
  MAX_PARSE_ERRORS,
  MAX_PLAYER_NAME_LENGTH,
  PERF_THRESHOLD_ATTACK_MS,
  PERF_THRESHOLD_MESSAGE_MS,
  PERF_THRESHOLD_MOVE_MS,
  WS_MESSAGE_QUEUE_OVERFLOW_SIZE,
  WS_MESSAGE_QUEUE_SIZE,
} from '@/utils/constants.js';

// Profanity filter for player names
const profanityMatcher = new RegExpMatcher({
  ...englishDataset.build(),
  ...englishRecommendedTransformers,
});

// WebSocket message validation schema
const ClientMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('move'),
    direction: z.enum(['up', 'down', 'left', 'right']),
  }),
  z.object({ type: z.literal('attack') }),
  z.object({ type: z.literal('pause') }),
  z.object({ type: z.literal('resume') }),
]);

/**
 * Create a message processor for a WebSocket connection
 * Encapsulates message queue and processing state per connection
 */
function createMessageProcessor(
  gameId: string,
  socket: WebSocket,
  fastify: FastifyInstance,
) {
  let processingMessage = false;
  const messageQueue: (Buffer | string)[] = [];
  let parseErrorCount = 0;

  async function processNextMessage() {
    if (processingMessage) return;
    processingMessage = true;

    try {
      while (messageQueue.length > 0) {
        // Defensive: if queue grew beyond safe bounds, close connection
        if (messageQueue.length > WS_MESSAGE_QUEUE_OVERFLOW_SIZE) {
          fastify.log.warn(
            { gameId, queueSize: messageQueue.length },
            'Message queue overflow, closing connection',
          );
          const errorMsg: ServerMessage = {
            type: 'error',
            message: 'Too many pending actions. Please reconnect.',
          };
          socket.send(JSON.stringify(errorMsg));
          socket.close();
          return;
        }

        const rawMessage = messageQueue.shift();
        if (!rawMessage) break;

        const messageStart = performance.now();

        try {
          // Check message size first
          const rawMessageStr = rawMessage.toString();
          if (rawMessageStr.length > MAX_MESSAGE_SIZE) {
            fastify.log.warn(
              { gameId, messageSize: rawMessageStr.length },
              'Message too large',
            );
            const errorMsg: ServerMessage = {
              type: 'error',
              message: 'Message too large',
            };
            socket.send(JSON.stringify(errorMsg));
            socket.close();
            return;
          }

          // Parse and validate message
          let message: ClientMessage;
          try {
            const parsed = JSON.parse(rawMessageStr);
            message = ClientMessageSchema.parse(parsed);
          } catch (err: unknown) {
            const error = err instanceof Error ? err : new Error(String(err));
            parseErrorCount++;
            fastify.log.error(
              {
                err: error,
                gameId,
                parseErrorCount,
                maxErrors: MAX_PARSE_ERRORS,
              },
              'Invalid message format',
            );

            const errorMsg: ServerMessage = {
              type: 'error',
              message: 'Invalid message format',
            };
            socket.send(JSON.stringify(errorMsg));

            // Rate limit parse errors
            if (parseErrorCount >= MAX_PARSE_ERRORS) {
              fastify.log.warn(
                { gameId, parseErrorCount },
                'Too many parse errors, closing connection',
              );
              socket.close();
            }
            continue; // Skip to next message
          }

          // Use info level to ensure it shows in logs
          fastify.log.info(
            `[WS] Processing message type: ${message.type} for game ${gameId}`,
          );

          // Handle pause/resume for real-time movement
          if (message.type === 'pause') {
            pauseSession(gameId);
            continue;
          }
          if (message.type === 'resume') {
            resumeSession(gameId);
            continue;
          }

          // Update session activity on player actions
          updateSessionActivity(gameId);

          // Get game state from in-memory cache (no DB read)
          const game = getCachedGameState(gameId);

          if (!game || game.status !== 'active') {
            const errorMsg: ServerMessage = {
              type: 'error',
              message: 'Game is no longer active',
            };
            socket.send(JSON.stringify(errorMsg));
            continue;
          }

          if (message.type === 'move') {
            const { direction } = message;
            if (!isDirection(direction)) {
              const errorMsg: ServerMessage = {
                type: 'error',
                message: 'Invalid direction',
              };
              socket.send(JSON.stringify(errorMsg));
              continue;
            }

            // Process move and get deltas - with performance monitoring
            fastify.log.info(
              `[WS] Calling processMoveWithDeltas for ${direction}`,
            );
            const moveStart = performance.now();
            const { events, deltas } = processMoveWithDeltas(game, direction);
            const moveTime = performance.now() - moveStart;

            fastify.log.info(
              `[PERF] processMoveWithDeltas completed in ${moveTime.toFixed(1)}ms`,
            );
            if (moveTime > PERF_THRESHOLD_MOVE_MS) {
              fastify.log.warn(
                `[PERF] SLOW: processMoveWithDeltas took ${moveTime.toFixed(1)}ms for game ${gameId}`,
              );
            }

            // Update in-memory cache (no DB write yet)
            updateCachedGameState(gameId, game);

            const currentStatus = readStatus(game);

            // Save to DB only on checkpoints (level descend, death, win)
            const isCheckpoint =
              currentStatus === 'dead' ||
              currentStatus === 'won' ||
              deltas.some((d) => d.type === 'new_floor');

            if (isCheckpoint) {
              try {
                await saveGameStateToDb(gameId);
              } catch (err: unknown) {
                const error =
                  err instanceof Error ? err : new Error(String(err));
                fastify.log.error(
                  { err: error, gameId },
                  'Failed to save checkpoint, closing connection',
                );
                const errorMsg: ServerMessage = {
                  type: 'error',
                  message: 'Failed to save game progress. Please reconnect.',
                };
                socket.send(JSON.stringify(errorMsg));
                socket.close();
                return;
              }
            }

            // Submit to leaderboard on death/win
            if (currentStatus === 'dead') {
              await safeSubmitDeathScore(
                game.playerName,
                game.score,
                game.floor,
                events,
                fastify.log,
                gameId,
              );
            } else if (currentStatus === 'won') {
              await safeSubmitVictoryScore(
                game.playerName,
                game.score,
                game.floor,
                fastify.log,
                gameId,
              );
            }

            // Send deltas to client
            const updateMsg: ServerMessage = {
              type: 'update',
              deltas,
            };
            socket.send(JSON.stringify(updateMsg));
          } else if (message.type === 'attack') {
            // Process attack and get deltas
            const attackStart = performance.now();
            const { events, deltas } = processAttackWithDeltas(game);
            const attackTime = performance.now() - attackStart;

            if (attackTime > PERF_THRESHOLD_ATTACK_MS) {
              fastify.log.warn(
                `[PERF] SLOW: processAttackWithDeltas took ${attackTime.toFixed(1)}ms for game ${gameId}`,
              );
            }

            // Update in-memory cache
            updateCachedGameState(gameId, game);

            const currentStatus = readStatus(game);

            // Save to DB only on checkpoints
            const isCheckpoint =
              currentStatus === 'dead' || currentStatus === 'won';

            if (isCheckpoint) {
              try {
                await saveGameStateToDb(gameId);
              } catch (err: unknown) {
                const error =
                  err instanceof Error ? err : new Error(String(err));
                fastify.log.error(
                  { err: error, gameId },
                  'Failed to save checkpoint, closing connection',
                );
                const errorMsg: ServerMessage = {
                  type: 'error',
                  message: 'Failed to save game progress. Please reconnect.',
                };
                socket.send(JSON.stringify(errorMsg));
                socket.close();
                return;
              }
            }

            // Submit to leaderboard on death/win
            if (currentStatus === 'dead') {
              await safeSubmitDeathScore(
                game.playerName,
                game.score,
                game.floor,
                events,
                fastify.log,
                gameId,
              );
            } else if (currentStatus === 'won') {
              await safeSubmitVictoryScore(
                game.playerName,
                game.score,
                game.floor,
                fastify.log,
                gameId,
              );
            }

            // Send deltas to client
            const updateMsg: ServerMessage = {
              type: 'update',
              deltas,
            };
            socket.send(JSON.stringify(updateMsg));
          }
        } catch (err: unknown) {
          const error = err instanceof Error ? err : new Error(String(err));
          fastify.log.error(
            { err: error },
            `WebSocket message error for game ${gameId}`,
          );
          try {
            const errorMsg: ServerMessage = {
              type: 'error',
              message: 'Invalid message format',
            };
            socket.send(JSON.stringify(errorMsg));
          } catch (sendErr: unknown) {
            const sendError =
              sendErr instanceof Error ? sendErr : new Error(String(sendErr));
            // Socket closed or broken - close connection and stop processing
            fastify.log.debug(
              { err: sendError, gameId },
              'Failed to send error response, closing connection',
            );
            socket.close();
            return; // Stop processing queue
          }
        } finally {
          const totalTime = performance.now() - messageStart;
          if (totalTime > PERF_THRESHOLD_MESSAGE_MS) {
            fastify.log.warn(
              `[PERF] Total message processing took ${totalTime.toFixed(1)}ms for game ${gameId}`,
            );
          }
        }
      }
    } finally {
      processingMessage = false;
    }
  }

  function enqueueMessage(rawMessage: Buffer | string) {
    // Drop messages if queue is full to prevent server overload
    if (messageQueue.length >= WS_MESSAGE_QUEUE_SIZE) {
      try {
        const errorMsg: ServerMessage = {
          type: 'error',
          message: 'Command buffer full. Please wait.',
        };
        socket.send(JSON.stringify(errorMsg));
      } catch {
        // Socket error, safe to ignore
      }
      return;
    }
    messageQueue.push(rawMessage);
    // Use setImmediate to process messages asynchronously
    setImmediate(() => processNextMessage());
  }

  return { enqueueMessage };
}

/**
 * Sanitize player name - clean profanity and validate
 */
function sanitizePlayerName(name: string): {
  valid: boolean;
  name: string;
  error?: string;
} {
  const trimmed = name.trim();

  if (trimmed.length === 0) {
    return { valid: false, name: '', error: 'Name is required' };
  }

  if (trimmed.length > MAX_PLAYER_NAME_LENGTH) {
    return {
      valid: false,
      name: '',
      error: `Name must be ${MAX_PLAYER_NAME_LENGTH} characters or less`,
    };
  }

  // Check if name contains profanity
  if (profanityMatcher.hasMatch(trimmed)) {
    return { valid: false, name: '', error: 'Please choose a different name' };
  }

  return { valid: true, name: trimmed };
}

// Helper to read game status without TypeScript's stale control flow narrowing
// This is needed because TypeScript doesn't track mutations through function calls
function readStatus(game: { status: GameStatus }): GameStatus {
  return game.status;
}

export async function gameRoutes(fastify: FastifyInstance) {
  const games = () => getDb().collection<GameDoc>('games');

  // Create new game
  fastify.post<{ Body: NewGameRequest }>(
    '/new',
    {
      schema: {
        body: z.object({
          playerName: z.string().min(1, 'Name is required'),
          character: z.enum(['dwarf', 'elf', 'bandit', 'wizard'], {
            message:
              'Invalid character. Must be one of: dwarf, elf, bandit, wizard',
          }),
        }),
      },
    },
    async (request, reply) => {
      const { playerName, character } = request.body;

      // Check DB health before creating game
      if (!(await isDatabaseHealthy())) {
        return reply
          .status(503)
          .send(
            createErrorResponse(
              'Database unavailable. Please try again later.',
              ErrorCode.DATABASE_ERROR,
            ),
          );
      }

      // Validate and sanitize player name (zod validates presence, we validate content)
      const nameResult = sanitizePlayerName(playerName);
      if (!nameResult.valid) {
        return reply
          .status(400)
          .send(
            createErrorResponse(
              nameResult.error || 'Invalid player name',
              ErrorCode.INVALID_PLAYER_NAME,
            ),
          );
      }

      const selectedCharacter: CharacterType = character;

      const playerId = randomUUID();
      const gameState = createNewGame(
        nameResult.name,
        playerId,
        selectedCharacter,
      );

      await games().insertOne(gameState);

      return {
        gameId: gameState._id,
        state: gameState,
      };
    },
  );

  // Get game state
  fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { id } = request.params;

    const game = await games().findOne({ _id: id });
    if (!game) {
      return reply
        .status(404)
        .send(createErrorResponse('Game not found', ErrorCode.GAME_NOT_FOUND));
    }

    return { state: game };
  });

  // Move player
  fastify.post<{ Params: { id: string }; Body: MoveRequest }>(
    '/:id/move',
    {
      schema: {
        body: z.object({
          direction: z.enum(['up', 'down', 'left', 'right'], {
            message: 'Invalid direction. Must be one of: up, down, left, right',
          }),
        }),
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const { direction } = request.body;

      // Check game existence first
      const game = await games().findOne({ _id: id });
      if (!game) {
        return reply
          .status(404)
          .send(
            createErrorResponse('Game not found', ErrorCode.GAME_NOT_FOUND),
          );
      }

      if (game.status !== 'active') {
        return reply
          .status(400)
          .send(
            createErrorResponse(
              'Game is not active',
              ErrorCode.GAME_NOT_ACTIVE,
            ),
          );
      }

      const events = processMove(game, direction);
      const currentStatus = readStatus(game);

      await games().replaceOne({ _id: id }, game);

      // If player died, submit to leaderboard
      if (currentStatus === 'dead') {
        // Use the safe submit function to handle error logging and prevent crashes
        await safeSubmitDeathScore(
          game.playerName,
          game.score,
          game.floor,
          events,
          fastify.log,
          id,
        );
      }

      return { state: game, events };
    },
  );

  // Descend stairs
  fastify.post<{ Params: { id: string } }>(
    '/:id/descend',
    async (request, reply) => {
      const { id } = request.params;

      const game = await games().findOne({ _id: id });
      if (!game) {
        return reply
          .status(404)
          .send(
            createErrorResponse('Game not found', ErrorCode.GAME_NOT_FOUND),
          );
      }

      if (game.status !== 'active') {
        return reply
          .status(400)
          .send(
            createErrorResponse(
              'Game is not active',
              ErrorCode.GAME_NOT_ACTIVE,
            ),
          );
      }

      const events = descendStairs(game);

      if (events.length === 0) {
        return reply
          .status(400)
          .send(
            createErrorResponse(
              'Not standing on stairs',
              ErrorCode.NOT_ON_STAIRS,
            ),
          );
      }

      const currentStatus = readStatus(game);
      await games().replaceOne({ _id: id }, game);

      // If player won, submit to leaderboard
      if (currentStatus === 'won') {
        // Use the safe submit function to handle error logging and prevent crashes
        await safeSubmitVictoryScore(
          game.playerName,
          game.score,
          game.floor,
          fastify.log,
          id,
        );
      }

      return { state: game, events };
    },
  );

  // Delete/abandon game
  fastify.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { id } = request.params;

    const result = await games().deleteOne({ _id: id });
    if (result.deletedCount === 0) {
      return reply
        .status(404)
        .send(createErrorResponse('Game not found', ErrorCode.GAME_NOT_FOUND));
    }

    return { success: true };
  });

  // WebSocket endpoint for real-time game updates
  fastify.get<{ Params: { id: string } }>(
    '/:id/ws',
    { websocket: true },
    async (socket, request) => {
      const { id } = request.params;

      // Check DB health before processing WebSocket connection
      if (!(await isDatabaseHealthy())) {
        fastify.log.error(
          { gameId: id },
          'Database unhealthy, rejecting WebSocket connection',
        );
        const errorMsg: ServerMessage = {
          type: 'error',
          message: 'Database unavailable. Please try again later.',
        };
        socket.send(JSON.stringify(errorMsg));
        socket.close();
        return;
      }

      // Load game state
      const game = await games().findOne({ _id: id });
      if (!game) {
        const errorMsg: ServerMessage = {
          type: 'error',
          message: 'Game not found',
        };
        socket.send(JSON.stringify(errorMsg));
        socket.close();
        return;
      }

      if (game.status !== 'active') {
        const errorMsg: ServerMessage = {
          type: 'error',
          message: 'Game is not active',
        };
        socket.send(JSON.stringify(errorMsg));
        socket.close();
        return;
      }

      // Send initial visible state (anti-cheat: only visible data)
      try {
        const initMsg: ServerMessage = {
          type: 'init',
          state: getVisibleState(game),
        };
        socket.send(JSON.stringify(initMsg));
      } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err));
        fastify.log.error(
          { err: error },
          `Failed to send initial state for game ${id}`,
        );
        socket.close();
        return;
      }

      // Register session for real-time enemy movement
      // Load game state into memory cache
      registerSession(id, socket, game);

      // Create message processor with isolated state for this connection
      const messageProcessor = createMessageProcessor(id, socket, fastify);

      // Handle incoming messages
      socket.on('message', (rawMessage: Buffer | string) => {
        messageProcessor.enqueueMessage(rawMessage);
      });

      socket.on('close', () => {
        unregisterSession(id, socket);
        fastify.log.info(`WebSocket closed for game ${id}`);
      });
    },
  );
}
