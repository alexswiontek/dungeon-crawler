import { performance } from 'node:perf_hooks';
import {
  GAME_WEBSOCKET_MESSAGE_SIZE_LIMIT,
  GAME_WEBSOCKET_SERVER_QUEUE_LIMIT,
  GAMEPLAY_PROTOCOL_VERSION,
  GameWebSocketAuthenticatedSchema,
  GameWebSocketClientMessageSchema,
  GameWebSocketCloseCode,
  GameWebSocketCloseReason,
  GameWebSocketCommandErrorSchema,
  type GameWebSocketCommandRequest,
  GameWebSocketCommandSuccessSchema,
  GameWebSocketProtocolMismatchSchema,
  GameWebSocketReconnectSchema,
} from '@dungeon-crawler/protocol';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { RawData, WebSocket } from 'ws';
import { executeGameCommand, readGame } from '@/services/gameCommandService.js';
import { isGameServiceError } from '@/types/gameServiceErrors.js';

const AUTHENTICATION_TIMEOUT_MS = 5_000;
const SHUTDOWN_DRAIN_TIMEOUT_MS = 2_500;

interface GameWebSocketService {
  readGame: typeof readGame;
  executeGameCommand: typeof executeGameCommand;
}

interface GameWebSocketHubOptions {
  readonly authenticationTimeoutMs?: number;
  readonly serverQueueLimit?: number;
  readonly shutdownDrainTimeoutMs?: number;
}

interface QueuedCommand {
  readonly message: GameWebSocketCommandRequest;
  readonly receivedAt: number;
}

interface Connection {
  readonly socket: WebSocket;
  readonly gameId: string;
  readonly connectedAt: number;
  readonly queue: QueuedCommand[];
  readonly authenticationTimer: NodeJS.Timeout;
  authenticated: boolean;
  authenticating: boolean;
  sessionToken: string | null;
  processing: Promise<void> | null;
  peakQueueDepth: number;
  shuttingDown: boolean;
}

function elapsed(startedAt: number): number {
  return Math.max(0, performance.now() - startedAt);
}

function safeServiceError(error: unknown, actionId?: string) {
  if (isGameServiceError(error)) {
    return GameWebSocketCommandErrorSchema.parse({
      type: 'command_error',
      error: error.message,
      code: error.code,
      ...(error.safeContext?.actionId || actionId
        ? { actionId: error.safeContext?.actionId ?? actionId }
        : {}),
      ...(error.safeContext?.revision !== undefined
        ? { revision: error.safeContext.revision }
        : {}),
      ...(error.safeContext?.state ? { state: error.safeContext.state } : {}),
    });
  }
  return GameWebSocketCommandErrorSchema.parse({
    type: 'command_error',
    error: 'The game service is temporarily unavailable',
    code: 'SERVICE_UNAVAILABLE',
    ...(actionId ? { actionId } : {}),
  });
}

function messageBytes(data: RawData): number {
  if (Array.isArray(data)) {
    return data.reduce((total, chunk) => total + chunk.byteLength, 0);
  }
  return data.byteLength;
}

export class GameWebSocketHub {
  private readonly owners = new Map<string, Connection>();
  private readonly connections = new Set<Connection>();
  private accepting = true;
  private readonly authenticationTimeoutMs: number;
  private readonly serverQueueLimit: number;
  private readonly shutdownDrainTimeoutMs: number;

  constructor(
    private readonly fastify: FastifyInstance,
    private readonly service: GameWebSocketService = {
      readGame,
      executeGameCommand,
    },
    options: GameWebSocketHubOptions = {},
  ) {
    this.authenticationTimeoutMs =
      options.authenticationTimeoutMs ?? AUTHENTICATION_TIMEOUT_MS;
    this.serverQueueLimit =
      options.serverQueueLimit ?? GAME_WEBSOCKET_SERVER_QUEUE_LIMIT;
    this.shutdownDrainTimeoutMs =
      options.shutdownDrainTimeoutMs ?? SHUTDOWN_DRAIN_TIMEOUT_MS;
  }

  accept(
    socket: WebSocket,
    request: FastifyRequest<{ Params: { gameId: string } }>,
  ): void {
    if (!this.accepting) {
      this.send(
        socket,
        GameWebSocketReconnectSchema.parse({
          type: 'reconnect',
          reason: 'server_shutdown',
        }),
      );
      socket.close(
        GameWebSocketCloseCode.SERVER_SHUTDOWN,
        GameWebSocketCloseReason.SERVER_SHUTDOWN,
      );
      return;
    }

    const connection = {} as Connection;
    const authenticationTimer = setTimeout(() => {
      if (connection.authenticated || socket.readyState > 1) return;
      socket.close(
        GameWebSocketCloseCode.AUTHENTICATION_TIMEOUT,
        GameWebSocketCloseReason.AUTHENTICATION_TIMEOUT,
      );
    }, this.authenticationTimeoutMs);
    authenticationTimer.unref();
    Object.assign(connection, {
      socket,
      gameId: request.params.gameId,
      connectedAt: performance.now(),
      queue: [],
      authenticationTimer,
      authenticated: false,
      authenticating: false,
      sessionToken: null,
      processing: null,
      peakQueueDepth: 0,
      shuttingDown: false,
    });
    this.connections.add(connection);
    this.fastify.log.info(
      { gameId: connection.gameId },
      'Gameplay socket connected',
    );

    socket.on('message', (data, isBinary) => {
      this.handleMessage(connection, data, isBinary);
    });
    socket.on('close', (code) => this.handleClose(connection, code));
    socket.on('error', () => {
      this.fastify.log.warn(
        { gameId: connection.gameId },
        'Gameplay socket transport error',
      );
    });
  }

  async shutdown(): Promise<void> {
    this.accepting = false;
    const processing: Promise<void>[] = [];
    for (const connection of this.connections) {
      connection.shuttingDown = true;
      this.rejectQueuedForShutdown(connection);
      if (connection.processing) processing.push(connection.processing);
    }
    let drainTimer: ReturnType<typeof setTimeout> | null = null;
    try {
      await Promise.race([
        Promise.allSettled(processing),
        new Promise<void>((resolve) => {
          drainTimer = setTimeout(resolve, this.shutdownDrainTimeoutMs);
        }),
      ]);
    } finally {
      if (drainTimer) clearTimeout(drainTimer);
    }
    for (const connection of this.connections) {
      this.send(
        connection.socket,
        GameWebSocketReconnectSchema.parse({
          type: 'reconnect',
          reason: 'server_shutdown',
        }),
      );
      connection.socket.close(
        GameWebSocketCloseCode.SERVER_SHUTDOWN,
        GameWebSocketCloseReason.SERVER_SHUTDOWN,
      );
    }
  }

  private handleMessage(
    connection: Connection,
    data: RawData,
    isBinary: boolean,
  ): void {
    if (connection.shuttingDown) return;
    if (isBinary || messageBytes(data) > GAME_WEBSOCKET_MESSAGE_SIZE_LIMIT) {
      this.send(
        connection.socket,
        GameWebSocketCommandErrorSchema.parse({
          type: 'command_error',
          error: isBinary
            ? 'Binary messages are not supported'
            : 'Message too large',
          code: 'MALFORMED_MESSAGE',
        }),
      );
      connection.socket.close(
        isBinary
          ? GameWebSocketCloseCode.MALFORMED_MESSAGE
          : GameWebSocketCloseCode.MESSAGE_TOO_LARGE,
        isBinary
          ? GameWebSocketCloseReason.MALFORMED_MESSAGE
          : GameWebSocketCloseReason.MESSAGE_TOO_LARGE,
      );
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(data.toString());
    } catch {
      this.closeMalformed(connection);
      return;
    }
    if (
      typeof payload === 'object' &&
      payload !== null &&
      'type' in payload &&
      payload.type === 'authenticate' &&
      'protocolVersion' in payload &&
      payload.protocolVersion !== GAMEPLAY_PROTOCOL_VERSION
    ) {
      this.send(
        connection.socket,
        GameWebSocketProtocolMismatchSchema.parse({
          type: 'protocol_mismatch',
          protocolVersion: GAMEPLAY_PROTOCOL_VERSION,
          error: 'This client is incompatible with the game server',
        }),
      );
      connection.socket.close(
        GameWebSocketCloseCode.PROTOCOL_MISMATCH,
        GameWebSocketCloseReason.PROTOCOL_MISMATCH,
      );
      return;
    }
    const parsed = GameWebSocketClientMessageSchema.safeParse(payload);
    if (!parsed.success) {
      this.closeMalformed(connection);
      return;
    }

    if (parsed.data.type === 'authenticate') {
      if (connection.authenticated || connection.authenticating) {
        this.send(
          connection.socket,
          GameWebSocketCommandErrorSchema.parse({
            type: 'command_error',
            error: 'Authentication has already been attempted',
            code: 'MALFORMED_MESSAGE',
          }),
        );
        connection.socket.close(
          GameWebSocketCloseCode.REPEATED_AUTHENTICATION,
          GameWebSocketCloseReason.REPEATED_AUTHENTICATION,
        );
        return;
      }
      connection.authenticating = true;
      void this.authenticate(connection, parsed.data.sessionToken);
      return;
    }
    if (!connection.authenticated) {
      this.send(
        connection.socket,
        GameWebSocketCommandErrorSchema.parse({
          type: 'command_error',
          error: 'Authenticate before sending commands',
          code: 'UNAUTHORIZED',
          actionId: parsed.data.actionId,
        }),
      );
      connection.socket.close(
        GameWebSocketCloseCode.COMMAND_BEFORE_AUTHENTICATION,
        GameWebSocketCloseReason.COMMAND_BEFORE_AUTHENTICATION,
      );
      return;
    }
    const depth = connection.queue.length + (connection.processing ? 1 : 0);
    if (depth >= this.serverQueueLimit) {
      this.send(
        connection.socket,
        GameWebSocketCommandErrorSchema.parse({
          type: 'command_error',
          error: 'The socket command queue is full',
          code: 'TRANSPORT_OVERFLOW',
          actionId: parsed.data.actionId,
        }),
      );
      connection.socket.close(
        GameWebSocketCloseCode.QUEUE_OVERFLOW,
        GameWebSocketCloseReason.QUEUE_OVERFLOW,
      );
      return;
    }
    connection.queue.push({
      message: parsed.data,
      receivedAt: performance.now(),
    });
    connection.peakQueueDepth = Math.max(connection.peakQueueDepth, depth + 1);
    this.fastify.log.info(
      { gameId: connection.gameId, queueDepth: depth + 1 },
      'Gameplay socket command queued',
    );
    this.processQueue(connection);
  }

  private async authenticate(
    connection: Connection,
    sessionToken: string,
  ): Promise<void> {
    const startedAt = performance.now();
    try {
      const response = await this.service.readGame(
        connection.gameId,
        sessionToken,
      );
      if (connection.socket.readyState !== 1 || connection.shuttingDown) return;
      connection.sessionToken = sessionToken;
      connection.authenticated = true;
      clearTimeout(connection.authenticationTimer);
      const previous = this.owners.get(connection.gameId);
      this.owners.set(connection.gameId, connection);
      this.send(
        connection.socket,
        GameWebSocketAuthenticatedSchema.parse({
          type: 'authenticated',
          protocolVersion: GAMEPLAY_PROTOCOL_VERSION,
          revision: response.revision,
          state: response.state,
        }),
      );
      if (previous && previous !== connection) {
        previous.socket.close(
          GameWebSocketCloseCode.CONNECTION_REPLACED,
          GameWebSocketCloseReason.CONNECTION_REPLACED,
        );
      }
      this.fastify.log.info(
        {
          gameId: connection.gameId,
          revision: response.revision,
          authenticationDurationMs: elapsed(startedAt),
          replacedOwner: Boolean(previous && previous !== connection),
        },
        'Gameplay socket authenticated',
      );
    } catch (error) {
      const response = safeServiceError(error);
      this.send(connection.socket, response);
      connection.socket.close(
        response.code === 'UNAUTHORIZED' || response.code === 'GAME_NOT_FOUND'
          ? GameWebSocketCloseCode.AUTHENTICATION_FAILED
          : 1013,
        response.code === 'UNAUTHORIZED' || response.code === 'GAME_NOT_FOUND'
          ? GameWebSocketCloseReason.AUTHENTICATION_FAILED
          : 'Service temporarily unavailable',
      );
    } finally {
      connection.authenticating = false;
    }
  }

  private processQueue(connection: Connection): void {
    if (connection.processing || connection.shuttingDown) return;
    const run = (async () => {
      while (!connection.shuttingDown) {
        const queued = connection.queue.shift();
        if (!queued) break;
        const handlingStartedAt = performance.now();
        try {
          const result = await this.service.executeGameCommand({
            gameId: connection.gameId,
            sessionToken: connection.sessionToken ?? '',
            actionId: queued.message.actionId,
            expectedRevision: queued.message.expectedRevision,
            command: queued.message.command,
          });
          const sentAt = performance.now();
          this.send(
            connection.socket,
            GameWebSocketCommandSuccessSchema.parse({
              type: 'acknowledgment',
              ...result,
              serverQueueDepth: connection.queue.length,
              serverPeakQueueDepth: connection.peakQueueDepth,
            }),
          );
          this.fastify.log.info(
            {
              gameId: connection.gameId,
              actionId: queued.message.actionId,
              revision: result.revision,
              queueDelayMs: Math.max(0, handlingStartedAt - queued.receivedAt),
              commandDurationMs: Math.max(0, sentAt - handlingStartedAt),
              acknowledgmentSendDurationMs: elapsed(sentAt),
              queueDepth: connection.queue.length,
            },
            'Gameplay socket command acknowledged',
          );
        } catch (error) {
          this.send(
            connection.socket,
            safeServiceError(error, queued.message.actionId),
          );
        }
      }
    })();
    connection.processing = run;
    void run.finally(() => {
      if (connection.processing === run) connection.processing = null;
      if (connection.shuttingDown) this.rejectQueuedForShutdown(connection);
      else if (connection.queue.length > 0) this.processQueue(connection);
    });
  }

  private rejectQueuedForShutdown(connection: Connection): void {
    for (const queued of connection.queue.splice(0)) {
      this.send(
        connection.socket,
        GameWebSocketCommandErrorSchema.parse({
          type: 'command_error',
          error: 'The server is restarting; reconnect and retry this action',
          code: 'SERVICE_UNAVAILABLE',
          actionId: queued.message.actionId,
        }),
      );
    }
  }

  private closeMalformed(connection: Connection): void {
    this.send(
      connection.socket,
      GameWebSocketCommandErrorSchema.parse({
        type: 'command_error',
        error: 'Malformed WebSocket message',
        code: 'MALFORMED_MESSAGE',
      }),
    );
    connection.socket.close(
      GameWebSocketCloseCode.MALFORMED_MESSAGE,
      GameWebSocketCloseReason.MALFORMED_MESSAGE,
    );
  }

  private handleClose(connection: Connection, code: number): void {
    clearTimeout(connection.authenticationTimer);
    this.connections.delete(connection);
    if (this.owners.get(connection.gameId) === connection) {
      this.owners.delete(connection.gameId);
    }
    this.fastify.log.info(
      {
        gameId: connection.gameId,
        closeCode: code,
        authenticated: connection.authenticated,
        connectionDurationMs: elapsed(connection.connectedAt),
        queueDepth: connection.queue.length,
      },
      'Gameplay socket closed',
    );
  }

  private send(socket: WebSocket, message: unknown): void {
    if (socket.readyState === 1) socket.send(JSON.stringify(message));
  }
}

export function registerGameWebSocketRoute(
  fastify: FastifyInstance,
  hub: GameWebSocketHub,
): void {
  fastify.get<{ Params: { gameId: string } }>(
    '/games/:gameId/stream',
    { websocket: true },
    (socket, request) => hub.accept(socket, request),
  );
}
