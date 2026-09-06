import type { GameCommand, GameEvent } from '@dungeon-crawler/domain/model';
import {
  GAME_WEBSOCKET_BUFFERED_AMOUNT_LIMIT,
  GAME_WEBSOCKET_CLIENT_QUEUE_LIMIT,
  type GameActionRequest,
  GameActionRequestSchema,
  GameCommandSchema,
  type GameDelta,
  type GameErrorResponse,
  GAMEPLAY_PROTOCOL_VERSION,
  GameWebSocketCloseCode,
  type GameWebSocketCommandError,
  GameWebSocketCommandRequestSchema,
  type GameWebSocketCommandSuccess,
  GameWebSocketServerMessageSchema,
  type VisibleGameState,
} from '@dungeon-crawler/protocol/schemas';
import { GameClientModel } from '@/game/GameClientModel';
import {
  type CreateGameInput,
  GameApiError,
  GameNetworkError,
  GameProtocolError,
  GameProtocolMismatchError,
  GameRequestTimeoutError,
  type GameSessionCredential,
  type GameTransport,
  isInvalidSessionError,
} from '@/game/GameHttpClient';
import type { ActiveGameStorage } from '@/game/GameSessionStorage';

const MAX_SOCKET_FAILURES_BEFORE_FALLBACK = 4;
const BASE_RECONNECT_DELAY_MS = 250;
const MAX_RECONNECT_DELAY_MS = 5_000;
const SOCKET_ATTEMPT_TIMEOUT_MS = 10_000;
const SOCKET_STABILITY_WINDOW_MS = 5_000;
const ACKNOWLEDGMENT_WINDOW_SIZE = 100;

export type GameGatewayLifecycle =
  | { readonly kind: 'unbound' }
  | { readonly kind: 'creating' }
  | { readonly kind: 'create-failed'; readonly message: string }
  | { readonly kind: 'loading' }
  | { readonly kind: 'load-failed'; readonly message: string }
  | { readonly kind: 'playing' }
  | { readonly kind: 'action-in-flight'; readonly queued: boolean }
  | {
      readonly kind: 'retry-required';
      readonly message: string;
      readonly retryAt: number | null;
    }
  | { readonly kind: 'conflict-resynchronized'; readonly message: string }
  | { readonly kind: 'command-failed'; readonly message: string }
  | { readonly kind: 'session-invalid'; readonly message: string }
  | { readonly kind: 'protocol-mismatch'; readonly message: string }
  | { readonly kind: 'abandoning' }
  | { readonly kind: 'abandon-failed'; readonly message: string }
  | { readonly kind: 'abandoned' }
  | { readonly kind: 'dead'; readonly revision: number }
  | { readonly kind: 'won'; readonly revision: number };

export type GameTransportState =
  | 'connecting'
  | 'authenticating'
  | 'ready'
  | 'reconnecting'
  | 'degraded-http-fallback'
  | 'terminal-failure';

export interface GameGatewaySnapshot {
  readonly version: number;
  readonly lifecycle: GameGatewayLifecycle;
  readonly transportState: GameTransportState;
}

export interface GameResult {
  readonly model: GameClientModel;
  readonly revision: number;
  readonly events: readonly GameEvent[];
  readonly deltas: readonly GameDelta[];
}

export interface GameGatewayDependencies {
  readonly transport: GameTransport;
  readonly storage: ActiveGameStorage;
  readonly actionId?: () => string;
  readonly now?: () => number;
  readonly random?: () => number;
  readonly credential?: GameSessionCredential;
  readonly maxQueuedCommands?: number;
}

interface DeferredResult {
  readonly promise: Promise<GameResult>;
  readonly resolve: (result: GameResult) => void;
  readonly reject: (error: unknown) => void;
}

type ActionOutcome =
  | { readonly kind: 'success'; readonly message: GameWebSocketCommandSuccess }
  | { readonly kind: 'error'; readonly message: GameWebSocketCommandError };

interface PendingAction extends DeferredResult {
  readonly command: GameCommand;
  request: GameActionRequest;
  serializedHttpBody: string;
  serializedSocketEnvelope: string;
  delivery: 'queued' | 'sent';
  sentAt: number | null;
  outcome: ActionOutcome | null;
}

type SnapshotListener = () => void;
type ResultListener = (result: GameResult) => void;
type TerminalListener = (result: GameResult) => void;

export class GatewayStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GatewayStateError';
  }
}

export class CommandQueueOverflowError extends Error {
  constructor() {
    super('The command queue is full. The newest input was not accepted.');
    this.name = 'CommandQueueOverflowError';
  }
}

export interface GameGatewayMetrics {
  readonly queueDepth: number;
  readonly peakQueueDepth: number;
  readonly inFlightCount: number;
  readonly unacknowledgedActionCount: number;
  readonly rejectedInputCount: number;
  readonly retryCount: number;
  readonly reconnectCount: number;
  readonly ambiguousOutcomeCount: number;
  readonly acknowledgmentMedianMs: number;
  readonly acknowledgmentP95Ms: number;
  readonly acknowledgmentMaximumMs: number;
  readonly lastCloseCode: number | null;
  readonly lastTransportErrorCategory: string | null;
}

export class RetryNotReadyError extends Error {
  constructor(readonly retryAt: number) {
    super('The action cannot be retried yet.');
    this.name = 'RetryNotReadyError';
  }
}

function deferredResult(): DeferredResult {
  let resolve!: (result: GameResult) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<GameResult>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function messageFrom(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function resultFrom(
  model: GameClientModel,
  revision: number,
  events: readonly GameEvent[] = [],
  deltas: readonly GameDelta[] = [],
): GameResult {
  return { model, revision, events, deltas };
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(
    sorted.length - 1,
    Math.ceil(sorted.length * fraction) - 1,
  );
  return sorted[index] ?? 0;
}

function websocketErrorFromApi(
  error: GameApiError,
  now: () => number,
): GameWebSocketCommandError {
  return {
    type: 'command_error',
    ...error.response,
    ...(error.retryAt === null
      ? {}
      : { retryAfterMs: Math.max(0, error.retryAt - now()) }),
  };
}

export class GameGateway implements GameGatewayContract {
  private readonly transport: GameTransport;
  private readonly storage: ActiveGameStorage;
  private readonly generateActionId: () => string;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly maxQueuedCommands: number;
  private credential: GameSessionCredential | null;
  private model: GameClientModel | null = null;
  private readonly actions: PendingAction[] = [];
  private socket: WebSocket | null = null;
  private socketGeneration = 0;
  private socketAuthenticated = false;
  private socketAuthenticatedAt: number | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private socketAttemptTimer: ReturnType<typeof setTimeout> | null = null;
  private bufferFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private socketFailureCount = 0;
  private usingHttpFallback = false;
  private httpRequestInFlight = false;
  private disposed = false;
  private rejectedInputCount = 0;
  private retryCount = 0;
  private reconnectCount = 0;
  private ambiguousOutcomeCount = 0;
  private peakQueueDepth = 0;
  private lastCloseCode: number | null = null;
  private lastTransportErrorCategory: string | null = null;
  private readonly acknowledgmentDurations: number[] = [];
  private terminalRevision: number | null = null;
  private snapshot: GameGatewaySnapshot = {
    version: 0,
    lifecycle: { kind: 'unbound' },
    transportState: 'connecting',
  };
  private readonly listeners = new Set<SnapshotListener>();
  private readonly resultListeners = new Set<ResultListener>();
  private readonly terminalListeners = new Set<TerminalListener>();

  constructor(dependencies: GameGatewayDependencies) {
    this.transport = dependencies.transport;
    this.storage = dependencies.storage;
    this.generateActionId =
      dependencies.actionId ?? (() => crypto.randomUUID());
    this.now = dependencies.now ?? Date.now;
    this.random = dependencies.random ?? Math.random;
    this.maxQueuedCommands =
      dependencies.maxQueuedCommands ?? GAME_WEBSOCKET_CLIENT_QUEUE_LIMIT;
    if (
      !Number.isInteger(this.maxQueuedCommands) ||
      this.maxQueuedCommands < 1
    ) {
      throw new RangeError('maxQueuedCommands must be a positive integer.');
    }
    this.credential = dependencies.credential ?? null;
  }

  readonly getSnapshot = (): GameGatewaySnapshot => this.snapshot;

  readonly subscribe = (listener: SnapshotListener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getMetrics(): GameGatewayMetrics {
    const sorted = [...this.acknowledgmentDurations].sort((a, b) => a - b);
    return {
      queueDepth: this.actions.length,
      peakQueueDepth: this.peakQueueDepth,
      inFlightCount: this.actions.filter((action) => action.delivery === 'sent')
        .length,
      unacknowledgedActionCount: this.actions.length,
      rejectedInputCount: this.rejectedInputCount,
      retryCount: this.retryCount,
      reconnectCount: this.reconnectCount,
      ambiguousOutcomeCount: this.ambiguousOutcomeCount,
      acknowledgmentMedianMs: percentile(sorted, 0.5),
      acknowledgmentP95Ms: percentile(sorted, 0.95),
      acknowledgmentMaximumMs: sorted[sorted.length - 1] ?? 0,
      lastCloseCode: this.lastCloseCode,
      lastTransportErrorCategory: this.lastTransportErrorCategory,
    };
  }

  subscribeResults(listener: ResultListener): () => void {
    this.resultListeners.add(listener);
    return () => this.resultListeners.delete(listener);
  }

  subscribeTerminal(listener: TerminalListener): () => void {
    this.terminalListeners.add(listener);
    return () => this.terminalListeners.delete(listener);
  }

  getModel(): GameClientModel {
    if (!this.model) throw new GatewayStateError('No game is loaded.');
    return this.model;
  }

  async createGame(input: CreateGameInput): Promise<GameResult> {
    if (this.credential || this.model) {
      throw new GatewayStateError('This gateway is already bound to a game.');
    }
    this.setLifecycle({ kind: 'creating' });
    try {
      const response = await this.transport.createGame(input);
      this.assertProjection(response.gameId, response.revision, response.state);
      this.credential = {
        gameId: response.gameId,
        sessionToken: response.sessionToken,
      };
      this.storage.saveActiveGame(this.credential);
      return this.acceptInitial(response.revision, response.state);
    } catch (error) {
      this.handleSetupError(error, 'create-failed');
      throw error;
    }
  }

  async migrateLegacyGame(gameId: string): Promise<GameResult> {
    if (this.credential || this.model) {
      throw new GatewayStateError('This gateway is already bound to a game.');
    }
    this.setLifecycle({ kind: 'loading' });
    try {
      const response = await this.transport.migrateLegacyGame(gameId);
      this.assertProjection(response.gameId, response.revision, response.state);
      this.credential = {
        gameId: response.gameId,
        sessionToken: response.sessionToken,
      };
      if (this.storage.saveActiveGame(this.credential)) {
        this.storage.clearLegacyGame();
      }
      return this.acceptInitial(response.revision, response.state);
    } catch (error) {
      if (isInvalidSessionError(error)) this.storage.clearLegacyGame();
      if (
        error instanceof GameApiError &&
        error.response.code === 'GAME_FINISHED'
      ) {
        this.storage.clearLegacyGame();
        this.setLifecycle({
          kind: 'session-invalid',
          message: 'That saved game has already finished. Start a new game.',
        });
        throw error;
      }
      this.handleSetupError(error, 'load-failed');
      throw error;
    }
  }

  async loadGame(): Promise<GameResult> {
    const credential = this.requireCredential();
    this.setLifecycle({ kind: 'loading' });
    try {
      const response = await this.transport.loadGame(credential);
      this.assertProjection(
        credential.gameId,
        response.revision,
        response.state,
      );
      return this.acceptInitial(response.revision, response.state);
    } catch (error) {
      this.handleSetupError(error, 'load-failed');
      throw error;
    }
  }

  execute(command: GameCommand): Promise<GameResult> {
    const parsedCommand = GameCommandSchema.parse(command) as GameCommand;
    if (this.snapshot.lifecycle.kind === 'retry-required') {
      return Promise.reject(
        new GatewayStateError('Resolve the pending action before continuing.'),
      );
    }
    if (!this.canExecute()) {
      return Promise.reject(
        new GatewayStateError('The game is not accepting commands.'),
      );
    }
    if (this.actions.length >= this.maxQueuedCommands) {
      this.rejectedInputCount += 1;
      const error = new CommandQueueOverflowError();
      this.setLifecycle({ kind: 'command-failed', message: error.message });
      return Promise.reject(error);
    }
    const lastExpectedRevision =
      this.actions[this.actions.length - 1]?.request.expectedRevision;
    const expectedRevision =
      lastExpectedRevision === undefined
        ? this.getModel().getSnapshot().revision
        : lastExpectedRevision + 1;
    const action = this.createAction(parsedCommand, expectedRevision);
    this.actions.push(action);
    this.peakQueueDepth = Math.max(this.peakQueueDepth, this.actions.length);
    this.setLifecycle({
      kind: 'action-in-flight',
      queued: this.actions.length > 1,
    });
    this.flushCommands();
    return action.promise;
  }

  retryPendingAction(): Promise<GameResult> {
    const pending = this.actions[0];
    const lifecycle = this.snapshot.lifecycle;
    if (!pending || lifecycle.kind !== 'retry-required') {
      return Promise.reject(new GatewayStateError('No action can be retried.'));
    }
    if (lifecycle.retryAt !== null && this.now() < lifecycle.retryAt) {
      return Promise.reject(new RetryNotReadyError(lifecycle.retryAt));
    }
    this.retryCount += 1;
    pending.delivery = 'queued';
    pending.outcome = null;
    this.flushCommands();
    return pending.promise;
  }

  async abandonGame(): Promise<void> {
    if (this.actions.length > 0) {
      throw new GatewayStateError(
        'Wait for current action responses before abandoning the game.',
      );
    }
    const credential = this.requireCredential();
    this.setLifecycle({ kind: 'abandoning' });
    try {
      await this.transport.abandonGame(credential);
      this.finishAbandon();
    } catch (error) {
      if (isInvalidSessionError(error)) {
        this.finishAbandon();
        return;
      }
      if (error instanceof GameProtocolMismatchError) {
        this.rejectActions(error);
        this.setLifecycle({
          kind: 'protocol-mismatch',
          message: error.message,
        });
        throw error;
      }
      this.setLifecycle({
        kind: 'abandon-failed',
        message:
          error instanceof GameNetworkError
            ? 'Could not reach the game server. The game was not abandoned.'
            : messageFrom(error, 'The game could not be abandoned. Try again.'),
      });
      throw error;
    }
  }

  retryAbandon(): Promise<void> {
    if (this.snapshot.lifecycle.kind !== 'abandon-failed') {
      return Promise.reject(
        new GatewayStateError('Abandonment is not awaiting a retry.'),
      );
    }
    return this.abandonGame();
  }

  dispose(): void {
    this.disposed = true;
    this.clearReconnectTimer();
    this.clearSocketAttemptTimer();
    this.clearBufferFlushTimer();
    this.closeSocket();
    this.rejectActions(new GatewayStateError('The game gateway was closed.'));
    this.listeners.clear();
    this.resultListeners.clear();
    this.terminalListeners.clear();
  }

  private createAction(
    command: GameCommand,
    expectedRevision: number,
    deferred = deferredResult(),
  ): PendingAction {
    const request = GameActionRequestSchema.parse({
      actionId: this.generateActionId(),
      expectedRevision,
      command,
    });
    return {
      ...deferred,
      command,
      request,
      serializedHttpBody: JSON.stringify(request),
      serializedSocketEnvelope: JSON.stringify(
        GameWebSocketCommandRequestSchema.parse({
          type: 'command',
          ...request,
        }),
      ),
      delivery: 'queued',
      sentAt: null,
      outcome: null,
    };
  }

  private connectSocket(reconnecting: boolean): void {
    if (
      this.disposed ||
      this.usingHttpFallback ||
      !this.credential ||
      !this.transport.openGameSocket
    ) {
      this.enableHttpFallback('websocket_unavailable');
      return;
    }
    this.clearReconnectTimer();
    this.socketAuthenticated = false;
    this.socketAuthenticatedAt = null;
    this.setTransportState(reconnecting ? 'reconnecting' : 'connecting');
    const generation = ++this.socketGeneration;
    let socket: WebSocket;
    try {
      socket = this.transport.openGameSocket(this.credential.gameId);
    } catch {
      this.handleSocketFailure('connection_failed');
      return;
    }
    this.socket = socket;
    this.socketAttemptTimer = setTimeout(() => {
      if (!this.isCurrentSocket(socket, generation)) return;
      this.socketAttemptTimer = null;
      this.socket = null;
      this.socketGeneration += 1;
      socket.close();
      this.handleSocketFailure('connection_timeout');
    }, SOCKET_ATTEMPT_TIMEOUT_MS);
    socket.addEventListener('open', () => {
      if (!this.isCurrentSocket(socket, generation) || !this.credential) return;
      this.setTransportState('authenticating');
      try {
        socket.send(
          JSON.stringify({
            type: 'authenticate',
            protocolVersion: GAMEPLAY_PROTOCOL_VERSION,
            sessionToken: this.credential.sessionToken,
          }),
        );
      } catch {
        this.closeSocket();
        this.handleSocketFailure('authentication_send_failed');
      }
    });
    socket.addEventListener('message', (event) => {
      if (!this.isCurrentSocket(socket, generation)) return;
      this.handleSocketMessage(event.data);
    });
    socket.addEventListener('close', (event) => {
      if (!this.isCurrentSocket(socket, generation)) return;
      this.clearSocketAttemptTimer();
      this.socket = null;
      this.socketAuthenticated = false;
      this.lastCloseCode = event.code;
      this.handleSocketClose(event.code);
    });
    socket.addEventListener('error', () => {
      if (!this.isCurrentSocket(socket, generation)) return;
      this.lastTransportErrorCategory = 'socket_error';
    });
  }

  private handleSocketMessage(raw: unknown): void {
    if (typeof raw !== 'string') {
      this.failProtocol('The server sent a non-text WebSocket message.');
      return;
    }
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      this.failProtocol('The server sent malformed WebSocket JSON.');
      return;
    }
    const parsed = GameWebSocketServerMessageSchema.safeParse(payload);
    if (!parsed.success) {
      this.failProtocol('The server sent an invalid WebSocket message.');
      return;
    }
    const message = parsed.data;
    if (message.type === 'protocol_mismatch') {
      this.handleProtocolMismatch();
      return;
    }
    if (message.type === 'reconnect') {
      this.closeSocket();
      this.handleSocketFailure('server_shutdown');
      return;
    }
    if (message.type === 'authenticated') {
      try {
        const model = this.getModel();
        this.assertProjection(
          model.getSnapshot().id,
          message.revision,
          message.state,
          model.getSnapshot().revision,
        );
        if (message.revision > model.getSnapshot().revision) {
          model.replace(message.state);
        }
      } catch (error) {
        this.failProtocol(messageFrom(error, 'Invalid authentication state.'));
        return;
      }
      this.socketAuthenticated = true;
      this.socketAuthenticatedAt = this.now();
      this.clearSocketAttemptTimer();
      this.setTransportState('ready');
      if (message.state.status !== 'active') {
        this.finishTerminal(
          resultFrom(this.getModel(), message.revision),
          message.state.status,
        );
        return;
      }
      for (const action of this.actions) {
        action.delivery = 'queued';
        action.outcome = null;
      }
      this.flushSocketCommands();
      return;
    }
    if (message.type === 'command_error' && !message.actionId) {
      this.handleConnectionError(message);
      return;
    }
    const action = this.actions.find(
      (candidate) => candidate.request.actionId === message.actionId,
    );
    if (!action) return;
    if (message.type === 'acknowledgment') this.socketFailureCount = 0;
    if (action.sentAt !== null) {
      this.recordAcknowledgment(this.now() - action.sentAt);
    }
    action.outcome =
      message.type === 'acknowledgment'
        ? { kind: 'success', message }
        : { kind: 'error', message };
    this.drainOutcomes();
  }

  private handleConnectionError(message: GameWebSocketCommandError): void {
    if (message.code === 'UNAUTHORIZED' || message.code === 'GAME_NOT_FOUND') {
      this.invalidateSession(
        new GameApiError(401, message as unknown as GameErrorResponse),
      );
      return;
    }
    if (message.code === 'PROTOCOL_MISMATCH') {
      this.handleProtocolMismatch();
      return;
    }
    this.lastTransportErrorCategory = message.code.toLowerCase();
  }

  private drainOutcomes(): void {
    while (true) {
      const action = this.actions[0];
      if (!action?.outcome) break;
      const outcome = action.outcome;
      if (outcome.kind === 'success') {
        if (!this.completeSuccess(action, outcome.message)) return;
        continue;
      }
      if (!this.completeError(action, outcome.message)) return;
    }
    if (this.actions.length === 0) {
      const kind = this.snapshot.lifecycle.kind;
      if (kind === 'dead' || kind === 'won') return;
      this.setLifecycle({ kind: 'playing' });
    } else if (this.actions.length > 0) {
      this.setLifecycle({
        kind: 'action-in-flight',
        queued: this.actions.length > 1,
      });
    }
    this.flushCommands();
  }

  private completeSuccess(
    action: PendingAction,
    message: GameWebSocketCommandSuccess,
  ): boolean {
    const model = this.getModel();
    try {
      this.assertProjection(
        model.getSnapshot().id,
        message.revision,
        message.state,
        model.getSnapshot().revision,
      );
    } catch (error) {
      action.outcome = null;
      this.failProtocol(messageFrom(error, 'Invalid action state.'));
      return false;
    }
    if (message.revision > model.getSnapshot().revision) {
      model.replace(message.state);
    }
    const result = resultFrom(
      model,
      message.revision,
      message.events as GameEvent[],
      message.deltas,
    );
    this.actions.shift();
    action.resolve(result);
    for (const listener of this.resultListeners) listener(result);
    const status = model.getSnapshot().status;
    if (status === 'dead' || status === 'won') {
      this.finishTerminal(result, status);
      return false;
    }
    return true;
  }

  private completeError(
    action: PendingAction,
    message: GameWebSocketCommandError,
  ): boolean {
    const error = new GameApiError(
      message.code === 'INVALID_COMMAND' ? 400 : 409,
      message as unknown as GameErrorResponse,
      message.retryAfterMs === undefined
        ? null
        : this.now() + message.retryAfterMs,
    );
    if (message.code === 'REVISION_CONFLICT') {
      if (!this.applyErrorState(message)) {
        action.outcome = null;
        return false;
      }
      this.actions.shift();
      action.reject(error);
      this.rebaseActions(0);
      this.setLifecycle({
        kind: 'conflict-resynchronized',
        message:
          'This game changed in another tab. The latest server state is now shown.',
      });
      return false;
    }
    if (message.code === 'INVALID_COMMAND') {
      if (!this.applyErrorState(message)) {
        action.outcome = null;
        return false;
      }
      this.actions.shift();
      action.reject(error);
      this.rebaseActions(0);
      return true;
    }
    if (message.code === 'GAME_FINISHED') {
      this.applyErrorState(message);
      this.actions.shift();
      action.reject(error);
      const status = this.getModel().getSnapshot().status;
      if (status === 'dead' || status === 'won') {
        this.finishTerminal(
          resultFrom(this.getModel(), this.getModel().getSnapshot().revision),
          status,
        );
      } else {
        this.rejectActions(error);
        this.setLifecycle({ kind: 'command-failed', message: error.message });
      }
      return false;
    }
    if (message.code === 'UNAUTHORIZED' || message.code === 'GAME_NOT_FOUND') {
      this.invalidateSession(error);
      return false;
    }
    if (message.code === 'PROTOCOL_MISMATCH') {
      this.handleProtocolMismatch();
      return false;
    }
    if (
      message.code === 'SERVICE_UNAVAILABLE' ||
      message.code === 'DATABASE_UNAVAILABLE' ||
      message.code === 'DATABASE_ERROR' ||
      message.code === 'RATE_LIMITED' ||
      message.code === 'TRANSPORT_OVERFLOW'
    ) {
      action.outcome = null;
      action.delivery = 'queued';
      this.ambiguousOutcomeCount += 1;
      if (this.usingHttpFallback) {
        this.setLifecycle({
          kind: 'retry-required',
          message: error.message,
          retryAt: error.retryAt,
        });
      } else {
        this.closeSocket();
        this.handleSocketFailure(message.code.toLowerCase());
      }
      return false;
    }
    this.actions.shift();
    action.reject(error);
    this.rebaseActions(0);
    this.setLifecycle({ kind: 'command-failed', message: error.message });
    return false;
  }

  private applyErrorState(message: GameWebSocketCommandError): boolean {
    if (message.revision === undefined || !message.state) {
      this.failProtocol(
        'The command error omitted its authoritative game state.',
      );
      return false;
    }
    try {
      const model = this.getModel();
      this.assertProjection(
        model.getSnapshot().id,
        message.revision,
        message.state,
        model.getSnapshot().revision,
      );
      if (message.revision > model.getSnapshot().revision) {
        model.replace(message.state);
      }
      return true;
    } catch (error) {
      this.failProtocol(messageFrom(error, 'Invalid command error state.'));
      return false;
    }
  }

  private rebaseActions(startIndex: number): void {
    const revision = this.getModel().getSnapshot().revision;
    for (let index = startIndex; index < this.actions.length; index += 1) {
      const action = this.actions[index];
      if (!action) continue;
      this.actions[index] = this.createAction(
        action.command,
        revision + index - startIndex,
        action,
      );
      this.retryCount += 1;
    }
    this.flushCommands();
  }

  private flushCommands(): void {
    if (this.usingHttpFallback) this.sendHttpHead();
    else this.flushSocketCommands();
  }

  private flushSocketCommands(): void {
    const socket = this.socket;
    if (
      !socket ||
      !this.socketAuthenticated ||
      socket.readyState !== WebSocket.OPEN
    ) {
      return;
    }
    for (const action of this.actions) {
      if (action.delivery !== 'queued') continue;
      if (socket.bufferedAmount >= GAME_WEBSOCKET_BUFFERED_AMOUNT_LIMIT) {
        if (!this.bufferFlushTimer) {
          this.bufferFlushTimer = setTimeout(() => {
            this.bufferFlushTimer = null;
            this.flushSocketCommands();
          }, 10);
        }
        break;
      }
      try {
        socket.send(action.serializedSocketEnvelope);
      } catch {
        this.closeSocket();
        this.handleSocketFailure('command_send_failed');
        break;
      }
      action.delivery = 'sent';
      action.sentAt = this.now();
    }
  }

  private sendHttpHead(): void {
    const action = this.actions[0];
    if (!action || this.httpRequestInFlight || action.delivery === 'sent')
      return;
    this.httpRequestInFlight = true;
    action.delivery = 'sent';
    action.sentAt = this.now();
    void this.transport
      .executeAction(this.requireCredential(), action.serializedHttpBody)
      .then((response) => {
        if (this.actions[0] !== action) return;
        if (response.actionId !== action.request.actionId) {
          throw new GameProtocolError(
            'The action response identity did not match.',
          );
        }
        this.recordAcknowledgment(this.now() - (action.sentAt ?? this.now()));
        action.outcome = {
          kind: 'success',
          message: { type: 'acknowledgment', ...response },
        };
      })
      .catch((error: unknown) => {
        if (this.actions[0] !== action) return;
        if (error instanceof GameProtocolMismatchError) {
          this.handleProtocolMismatch();
          return;
        }
        if (error instanceof GameApiError) {
          action.outcome = {
            kind: 'error',
            message: websocketErrorFromApi(error, this.now),
          };
          return;
        }
        action.delivery = 'queued';
        this.ambiguousOutcomeCount += 1;
        this.setLifecycle({
          kind: 'retry-required',
          message:
            error instanceof GameProtocolError
              ? 'The action result could not be read. Retry Action will resend the same action without applying it twice.'
              : error instanceof GameRequestTimeoutError
                ? 'The action timed out. Retry Action will resend the same action without applying it twice.'
                : 'No response came back for this action. Retry Action will resend the same action without applying it twice.',
          retryAt: null,
        });
      })
      .finally(() => {
        this.httpRequestInFlight = false;
        if (this.actions[0] === action && action.outcome) this.drainOutcomes();
      });
  }

  private handleSocketClose(code: number): void {
    if (this.disposed || this.usingHttpFallback || !this.credential) return;
    if (
      this.socketAuthenticatedAt !== null &&
      this.now() - this.socketAuthenticatedAt >= SOCKET_STABILITY_WINDOW_MS
    ) {
      this.socketFailureCount = 0;
    }
    this.socketAuthenticatedAt = null;
    if (code === GameWebSocketCloseCode.CONNECTION_REPLACED) {
      this.lastTransportErrorCategory = 'connection_replaced';
      this.setTransportState('terminal-failure');
      this.rejectActions(
        new GatewayStateError('This game was opened in another tab.'),
      );
      this.setLifecycle({
        kind: 'command-failed',
        message: 'This game was opened in another tab.',
      });
      return;
    }
    if (code === GameWebSocketCloseCode.AUTHENTICATION_FAILED) {
      this.invalidateSession(
        new GatewayStateError('The WebSocket authentication failed.'),
      );
      return;
    }
    if (code === GameWebSocketCloseCode.PROTOCOL_MISMATCH) {
      this.handleProtocolMismatch();
      return;
    }
    if (
      code === GameWebSocketCloseCode.MALFORMED_MESSAGE ||
      code === GameWebSocketCloseCode.MESSAGE_TOO_LARGE ||
      code === GameWebSocketCloseCode.COMMAND_BEFORE_AUTHENTICATION ||
      code === GameWebSocketCloseCode.REPEATED_AUTHENTICATION
    ) {
      this.failProtocol('The WebSocket protocol failed. Reload the page.');
      return;
    }
    this.handleSocketFailure(
      code === GameWebSocketCloseCode.SERVER_SHUTDOWN
        ? 'server_shutdown'
        : 'connection_closed',
    );
  }

  private handleSocketFailure(category: string): void {
    if (this.disposed || this.usingHttpFallback || !this.credential) return;
    this.lastTransportErrorCategory = category;
    this.socketFailureCount += 1;
    for (const action of this.actions) {
      action.delivery = 'queued';
      action.outcome = null;
    }
    if (this.socketFailureCount >= MAX_SOCKET_FAILURES_BEFORE_FALLBACK) {
      this.enableHttpFallback(category);
      return;
    }
    this.reconnectCount += 1;
    this.setTransportState('reconnecting');
    const exponential = Math.min(
      MAX_RECONNECT_DELAY_MS,
      BASE_RECONNECT_DELAY_MS * 2 ** (this.socketFailureCount - 1),
    );
    const delay = Math.round(exponential * (1 + this.random() * 0.25));
    this.clearReconnectTimer();
    this.clearBufferFlushTimer();
    this.reconnectTimer = setTimeout(() => this.connectSocket(true), delay);
  }

  private enableHttpFallback(category: string): void {
    if (this.usingHttpFallback || this.disposed) return;
    this.usingHttpFallback = true;
    this.lastTransportErrorCategory = category;
    this.clearReconnectTimer();
    this.closeSocket();
    for (const action of this.actions) {
      action.delivery = 'queued';
      action.outcome = null;
    }
    this.setTransportState('degraded-http-fallback');
    this.sendHttpHead();
  }

  private failProtocol(message: string): void {
    const error = new GameProtocolError(message);
    this.lastTransportErrorCategory = 'protocol_error';
    this.closeSocket();
    this.rejectActions(error);
    this.setTransportState('terminal-failure');
    this.setLifecycle({ kind: 'protocol-mismatch', message });
  }

  private handleProtocolMismatch(): void {
    const error = new GameProtocolMismatchError(GAMEPLAY_PROTOCOL_VERSION);
    this.closeSocket();
    this.rejectActions(error);
    this.setTransportState('terminal-failure');
    this.setLifecycle({ kind: 'protocol-mismatch', message: error.message });
  }

  private invalidateSession(error: unknown): void {
    this.lastTransportErrorCategory = 'invalid_session';
    this.storage.clearActiveGame();
    this.credential = null;
    this.closeSocket();
    this.rejectActions(error);
    this.setTransportState('terminal-failure');
    this.setLifecycle({
      kind: 'session-invalid',
      message: 'That saved game is no longer available. Start a new game.',
    });
  }

  private recordAcknowledgment(duration: number): void {
    if (!Number.isFinite(duration) || duration < 0) return;
    this.acknowledgmentDurations.push(duration);
    if (this.acknowledgmentDurations.length > ACKNOWLEDGMENT_WINDOW_SIZE) {
      this.acknowledgmentDurations.shift();
    }
  }

  private requireCredential(): GameSessionCredential {
    if (!this.credential) {
      throw new GatewayStateError('No game credential is available.');
    }
    return this.credential;
  }

  private canExecute(): boolean {
    const kind = this.snapshot.lifecycle.kind;
    return (
      kind === 'playing' ||
      kind === 'action-in-flight' ||
      kind === 'conflict-resynchronized' ||
      kind === 'command-failed'
    );
  }

  private acceptInitial(revision: number, state: VisibleGameState): GameResult {
    this.model = new GameClientModel(state);
    const result = resultFrom(this.model, revision);
    if (state.status === 'dead' || state.status === 'won') {
      this.finishTerminal(result, state.status);
    } else {
      this.setLifecycle({ kind: 'playing' });
      this.connectSocket(false);
    }
    return result;
  }

  private finishTerminal(result: GameResult, status: 'dead' | 'won'): void {
    this.storage.clearActiveGame();
    this.credential = null;
    this.closeSocket();
    this.rejectActions(new GatewayStateError('The game is finished.'));
    const revision = result.model.getSnapshot().revision;
    this.setTransportState('terminal-failure');
    this.setLifecycle({ kind: status, revision });
    if (this.terminalRevision === revision) return;
    this.terminalRevision = revision;
    for (const listener of this.terminalListeners) listener(result);
  }

  private handleSetupError(
    error: unknown,
    fallbackKind: 'create-failed' | 'load-failed',
  ): void {
    if (error instanceof GameProtocolMismatchError) {
      this.setLifecycle({ kind: 'protocol-mismatch', message: error.message });
      return;
    }
    if (isInvalidSessionError(error)) {
      this.storage.clearActiveGame();
      this.credential = null;
      this.setLifecycle({
        kind: 'session-invalid',
        message: 'That saved game is no longer available. Start a new game.',
      });
      return;
    }
    if (error instanceof GameNetworkError) {
      this.setLifecycle({
        kind: fallbackKind,
        message:
          fallbackKind === 'create-failed'
            ? 'Could not reach the game server. Check that it is running, then try again.'
            : 'Could not reach the game server. Your saved game is still available; retry when the server is running.',
      });
      return;
    }
    this.setLifecycle({
      kind: fallbackKind,
      message: messageFrom(error, 'The game could not be loaded.'),
    });
  }

  private assertProjection(
    gameId: string,
    revision: number,
    state: VisibleGameState,
    minimumRevision = 0,
  ): void {
    if (
      state._id !== gameId ||
      state.revision !== revision ||
      revision < minimumRevision
    ) {
      throw new GameProtocolError(
        'The gameplay response contained inconsistent authoritative state.',
      );
    }
  }

  private rejectActions(error: unknown): void {
    for (const action of this.actions.splice(0)) action.reject(error);
  }

  private finishAbandon(): void {
    this.storage.clearActiveGame();
    this.credential = null;
    this.closeSocket();
    this.rejectActions(new GatewayStateError('The game was abandoned.'));
    this.setTransportState('terminal-failure');
    this.setLifecycle({ kind: 'abandoned' });
  }

  private isCurrentSocket(socket: WebSocket, generation: number): boolean {
    return this.socket === socket && this.socketGeneration === generation;
  }

  private closeSocket(): void {
    const socket = this.socket;
    this.socket = null;
    this.socketAuthenticated = false;
    this.socketAuthenticatedAt = null;
    this.socketGeneration += 1;
    this.clearSocketAttemptTimer();
    this.clearBufferFlushTimer();
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
  }

  private clearReconnectTimer(): void {
    if (!this.reconnectTimer) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private clearBufferFlushTimer(): void {
    if (!this.bufferFlushTimer) return;
    clearTimeout(this.bufferFlushTimer);
    this.bufferFlushTimer = null;
  }

  private clearSocketAttemptTimer(): void {
    if (!this.socketAttemptTimer) return;
    clearTimeout(this.socketAttemptTimer);
    this.socketAttemptTimer = null;
  }

  private setLifecycle(lifecycle: GameGatewayLifecycle): void {
    this.snapshot = {
      ...this.snapshot,
      version: this.snapshot.version + 1,
      lifecycle,
    };
    for (const listener of this.listeners) listener();
  }

  private setTransportState(transportState: GameTransportState): void {
    if (this.snapshot.transportState === transportState) return;
    this.snapshot = {
      ...this.snapshot,
      version: this.snapshot.version + 1,
      transportState,
    };
    for (const listener of this.listeners) listener();
  }
}

export interface GameGatewayContract {
  createGame(input: CreateGameInput): Promise<GameResult>;
  migrateLegacyGame(gameId: string): Promise<GameResult>;
  loadGame(): Promise<GameResult>;
  execute(command: GameCommand): Promise<GameResult>;
  retryPendingAction(): Promise<GameResult>;
  abandonGame(): Promise<void>;
}
