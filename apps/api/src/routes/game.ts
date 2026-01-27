import { randomUUID } from 'node:crypto';
import {
  type CharacterType,
  type ClientMessage,
  type EnemyType,
  type EnemyVariant,
  type GameState,
  type GameStatus,
  isDirection,
  isPlayerDiedEvent,
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

// Profanity filter for player names
const profanityMatcher = new RegExpMatcher({
  ...englishDataset.build(),
  ...englishRecommendedTransformers,
});

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

  if (trimmed.length > 20) {
    return {
      valid: false,
      name: '',
      error: 'Name must be 20 characters or less',
    };
  }

  // Check if name contains profanity
  if (profanityMatcher.hasMatch(trimmed)) {
    return { valid: false, name: '', error: 'Please choose a different name' };
  }

  return { valid: true, name: trimmed };
}

import { getDb } from '@/services/database.js';
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

interface GameDoc extends Omit<GameState, '_id'> {
  _id: string;
}

// Helper to read game status without TypeScript's stale control flow narrowing
// This is needed because TypeScript doesn't track mutations through function calls
function readStatus(game: { status: GameStatus }): GameStatus {
  return game.status;
}

interface LeaderboardDoc {
  _id: string;
  playerName: string;
  score: number;
  floor: number;
  killedBy: string | null;
  killedByType: EnemyType | null;
  killedByVariant: EnemyVariant | null;
  createdAt: Date;
}

export async function gameRoutes(fastify: FastifyInstance) {
  const games = () => getDb().collection<GameDoc>('games');
  const leaderboard = () => getDb().collection<LeaderboardDoc>('leaderboard');

  // Create new game
  fastify.post<{ Body: NewGameRequest }>('/new', async (request, reply) => {
    const { playerName, character } = request.body;

    // Validate and sanitize player name
    const nameResult = sanitizePlayerName(playerName || '');
    if (!nameResult.valid) {
      return reply.status(400).send({ error: nameResult.error });
    }

    // Validate character type
    const validCharacters: CharacterType[] = [
      'dwarf',
      'elf',
      'bandit',
      'wizard',
    ];
    const selectedCharacter: CharacterType = validCharacters.includes(character)
      ? character
      : 'dwarf';

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
  });

  // Get game state
  fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { id } = request.params;

    const game = await games().findOne({ _id: id });
    if (!game) {
      return reply.status(404).send({ error: 'Game not found' });
    }

    return { state: game };
  });

  // Move player
  fastify.post<{ Params: { id: string }; Body: MoveRequest }>(
    '/:id/move',
    async (request, reply) => {
      const { id } = request.params;
      const { direction } = request.body;

      if (!['up', 'down', 'left', 'right'].includes(direction)) {
        return reply.status(400).send({ error: 'Invalid direction' });
      }

      const game = await games().findOne({ _id: id });
      if (!game) {
        return reply.status(404).send({ error: 'Game not found' });
      }

      if (game.status !== 'active') {
        return reply.status(400).send({ error: 'Game is not active' });
      }

      const events = processMove(game, direction);
      const currentStatus = readStatus(game);

      await games().replaceOne({ _id: id }, game);

      // If player died, submit to leaderboard
      if (currentStatus === 'dead') {
        const killedByEvent = events.find(isPlayerDiedEvent);
        if (!killedByEvent) {
          fastify.log.error(
            `CRITICAL: Player died but no player_died event found for game ${id}`,
          );
          throw new Error('Player died without death event - data corruption');
        }
        const { killedBy, killedByType, killedByVariant } = killedByEvent.data;
        await leaderboard().insertOne({
          _id: randomUUID(),
          playerName: game.playerName,
          score: game.score,
          floor: game.floor,
          killedBy,
          killedByType,
          killedByVariant,
          createdAt: new Date(),
        });
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
        return reply.status(404).send({ error: 'Game not found' });
      }

      if (game.status !== 'active') {
        return reply.status(400).send({ error: 'Game is not active' });
      }

      const events = descendStairs(game);

      if (events.length === 0) {
        return reply.status(400).send({ error: 'Not standing on stairs' });
      }

      const currentStatus = readStatus(game);
      await games().replaceOne({ _id: id }, game);

      // If player won, submit to leaderboard
      if (currentStatus === 'won') {
        await leaderboard().insertOne({
          _id: randomUUID(),
          playerName: game.playerName,
          score: game.score,
          floor: game.floor,
          killedBy: null,
          killedByType: null,
          killedByVariant: null,
          createdAt: new Date(),
        });
      }

      return { state: game, events };
    },
  );

  // Delete/abandon game
  fastify.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { id } = request.params;

    const result = await games().deleteOne({ _id: id });
    if (result.deletedCount === 0) {
      return reply.status(404).send({ error: 'Game not found' });
    }

    return { success: true };
  });

  // WebSocket endpoint for real-time game updates
  fastify.get<{ Params: { id: string } }>(
    '/:id/ws',
    { websocket: true },
    async (socket, request) => {
      const { id } = request.params;

      // Load game state
      let game = await games().findOne({ _id: id });
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
      const initMsg: ServerMessage = {
        type: 'init',
        state: getVisibleState(game),
      };
      socket.send(JSON.stringify(initMsg));

      // Register session for real-time enemy movement
      // Load game state into memory cache
      registerSession(id, socket, game);

      // Message processing queue to prevent concurrent handler execution
      let processingMessage = false;
      const messageQueue: (Buffer | string)[] = [];
      const MAX_QUEUE_SIZE = 5; // Limit queue to prevent flooding

      async function processNextMessage() {
        if (processingMessage || messageQueue.length === 0) return;

        // Defensive: if queue grew beyond safe bounds, clear it to prevent memory leak
        if (messageQueue.length > MAX_QUEUE_SIZE * 2) {
          messageQueue.length = 0;
          processingMessage = false;
          fastify.log.warn(
            `Message queue overflow for game ${id}, cleared to prevent memory leak`,
          );
          return;
        }

        processingMessage = true;
        const rawMessage = messageQueue.shift();
        if (!rawMessage) {
          processingMessage = false;
          return;
        }

        const messageStart = performance.now();

        try {
          const message: ClientMessage = JSON.parse(rawMessage.toString());
          // Use info level to ensure it shows in logs
          fastify.log.info(
            `[WS] Processing message type: ${message.type} for game ${id}`,
          );

          // Handle pause/resume for real-time movement
          if (message.type === 'pause') {
            pauseSession(id);
            return;
          }
          if (message.type === 'resume') {
            resumeSession(id);
            return;
          }

          // Update session activity on player actions
          updateSessionActivity(id);

          // Get game state from in-memory cache (no DB read)
          game = getCachedGameState(id);

          if (!game || game.status !== 'active') {
            const errorMsg: ServerMessage = {
              type: 'error',
              message: 'Game is no longer active',
            };
            socket.send(JSON.stringify(errorMsg));
            return;
          }

          if (message.type === 'move') {
            const { direction } = message;
            if (!isDirection(direction)) {
              const errorMsg: ServerMessage = {
                type: 'error',
                message: 'Invalid direction',
              };
              socket.send(JSON.stringify(errorMsg));
              return;
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
            if (moveTime > 50) {
              fastify.log.warn(
                `[PERF] SLOW: processMoveWithDeltas took ${moveTime.toFixed(1)}ms for game ${id}`,
              );
            }

            // Update in-memory cache (no DB write yet)
            updateCachedGameState(id, game);

            const currentStatus = readStatus(game);

            // Save to DB only on checkpoints (level descend, death, win)
            const isCheckpoint =
              currentStatus === 'dead' ||
              currentStatus === 'won' ||
              deltas.some((d) => d.type === 'new_floor');

            if (isCheckpoint) {
              await saveGameStateToDb(id);
            }

            // Handle death/victory leaderboard submission
            if (currentStatus === 'dead') {
              const killedByEvent = events.find(isPlayerDiedEvent);
              if (!killedByEvent) {
                fastify.log.error(
                  `CRITICAL: Player died but no player_died event found for game ${id}`,
                );
                throw new Error(
                  'Player died without death event - data corruption',
                );
              }
              const { killedBy, killedByType, killedByVariant } =
                killedByEvent.data;
              await leaderboard().insertOne({
                _id: randomUUID(),
                playerName: game.playerName,
                score: game.score,
                floor: game.floor,
                killedBy,
                killedByType,
                killedByVariant,
                createdAt: new Date(),
              });
            } else if (currentStatus === 'won') {
              await leaderboard().insertOne({
                _id: randomUUID(),
                playerName: game.playerName,
                score: game.score,
                floor: game.floor,
                killedBy: null,
                killedByType: null,
                killedByVariant: null,
                createdAt: new Date(),
              });
            }

            // Send deltas to client
            const updateMsg: ServerMessage = {
              type: 'update',
              deltas,
            };
            socket.send(JSON.stringify(updateMsg));
          } else if (message.type === 'attack') {
            // Process attack (slash in facing direction) - with performance monitoring
            const attackStart = performance.now();
            const { events, deltas } = processAttackWithDeltas(game);
            const attackTime = performance.now() - attackStart;

            if (attackTime > 50) {
              fastify.log.warn(
                `[PERF] processAttackWithDeltas took ${attackTime.toFixed(1)}ms for game ${id}`,
              );
            }

            // Update in-memory cache (no DB write yet)
            updateCachedGameState(id, game);

            const currentStatus = readStatus(game);

            // Save to DB only on checkpoints (death)
            if (currentStatus === 'dead') {
              await saveGameStateToDb(id);

              // Handle death leaderboard submission
              const killedByEvent = events.find(isPlayerDiedEvent);
              if (!killedByEvent) {
                fastify.log.error(
                  `CRITICAL: Player died but no player_died event found for game ${id}`,
                );
                throw new Error(
                  'Player died without death event - data corruption',
                );
              }
              const { killedBy, killedByType, killedByVariant } =
                killedByEvent.data;
              await leaderboard().insertOne({
                _id: randomUUID(),
                playerName: game.playerName,
                score: game.score,
                floor: game.floor,
                killedBy,
                killedByType,
                killedByVariant,
                createdAt: new Date(),
              });
            }

            // Send deltas to client
            const updateMsg: ServerMessage = {
              type: 'update',
              deltas,
            };
            socket.send(JSON.stringify(updateMsg));
          }
        } catch (err) {
          fastify.log.error({ err }, `WebSocket message error for game ${id}`);
          try {
            const errorMsg: ServerMessage = {
              type: 'error',
              message: 'Invalid message format',
            };
            socket.send(JSON.stringify(errorMsg));
          } catch (sendErr) {
            // Socket closed between catch and send - safe to ignore
            fastify.log.debug(
              { err: sendErr },
              `Failed to send error response for game ${id}`,
            );
          }
        } finally {
          const totalTime = performance.now() - messageStart;
          if (totalTime > 100) {
            fastify.log.warn(
              `[PERF] Total message processing took ${totalTime.toFixed(1)}ms for game ${id}`,
            );
          }

          processingMessage = false;
          // Process next message in queue
          try {
            setImmediate(() => processNextMessage());
          } catch {
            // setImmediate itself won't fail, but defensive for future changes
            processingMessage = false;
          }
        }
      }

      // Handle incoming messages - add to queue and process
      socket.on('message', (rawMessage: Buffer | string) => {
        // Drop messages if queue is full to prevent server overload
        if (messageQueue.length >= MAX_QUEUE_SIZE) {
          return;
        }
        messageQueue.push(rawMessage);
        processNextMessage();
      });

      socket.on('close', () => {
        unregisterSession(id, socket);
        fastify.log.info(`WebSocket closed for game ${id}`);
      });
    },
  );
}
