import type { GameCommand, GameEvent } from '@dungeon-crawler/domain';
import {
  type GameActionRequest,
  GameActionRequestSchema,
  GameCommandSchema,
  type GameDelta,
  type VisibleGameState,
} from '@dungeon-crawler/protocol';
import { GameClientModel } from '@/game/GameClientModel';
import {
  type CreateGameInput,
  GameApiError,
  GameNetworkError,
  GameProtocolError,
  GameProtocolMismatchError,
  type GameSessionCredential,
  type GameTransport,
  isInvalidSessionError,
} from '@/game/GameHttpClient';
import type { ActiveGameStorage } from '@/game/GameSessionStorage';

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

export interface GameGatewaySnapshot {
  readonly version: number;
  readonly lifecycle: GameGatewayLifecycle;
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
  readonly credential?: GameSessionCredential;
}

interface DeferredResult {
  readonly promise: Promise<GameResult>;
  readonly resolve: (result: GameResult) => void;
  readonly reject: (error: unknown) => void;
}

interface PendingAction extends DeferredResult {
  readonly request: GameActionRequest;
  readonly serializedBody: string;
  inFlight: boolean;
}

interface QueuedIntent extends DeferredResult {
  readonly command: GameCommand;
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

export class CommandSupersededError extends Error {
  constructor() {
    super('A newer command replaced this queued input.');
    this.name = 'CommandSupersededError';
  }
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

export class GameGateway implements GameGatewayContract {
  private readonly transport: GameTransport;
  private readonly storage: ActiveGameStorage;
  private readonly generateActionId: () => string;
  private readonly now: () => number;
  private credential: GameSessionCredential | null;
  private model: GameClientModel | null = null;
  private pending: PendingAction | null = null;
  private queued: QueuedIntent | null = null;
  private terminalRevision: number | null = null;
  private snapshot: GameGatewaySnapshot = {
    version: 0,
    lifecycle: { kind: 'unbound' },
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
    this.credential = dependencies.credential ?? null;
  }

  readonly getSnapshot = (): GameGatewaySnapshot => this.snapshot;

  readonly subscribe = (listener: SnapshotListener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

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
    if (this.pending) {
      if (!this.pending.inFlight) {
        return Promise.reject(
          new GatewayStateError(
            'Resolve the pending action before continuing.',
          ),
        );
      }
      const deferred = deferredResult();
      this.queued?.reject(new CommandSupersededError());
      this.queued = { command: parsedCommand, ...deferred };
      this.setLifecycle({ kind: 'action-in-flight', queued: true });
      return deferred.promise;
    }
    if (!this.canExecute()) {
      return Promise.reject(
        new GatewayStateError('The game is not accepting commands.'),
      );
    }
    return this.beginAction(parsedCommand).promise;
  }

  retryPendingAction(): Promise<GameResult> {
    const pending = this.pending;
    const lifecycle = this.snapshot.lifecycle;
    if (!pending || lifecycle.kind !== 'retry-required' || pending.inFlight) {
      return Promise.reject(new GatewayStateError('No action can be retried.'));
    }
    if (lifecycle.retryAt !== null && this.now() < lifecycle.retryAt) {
      return Promise.reject(new RetryNotReadyError(lifecycle.retryAt));
    }
    void this.sendPending(pending);
    return pending.promise;
  }

  async abandonGame(): Promise<void> {
    if (this.pending?.inFlight) {
      throw new GatewayStateError(
        'Wait for the current action response before abandoning the game.',
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
        this.clearCommands(error);
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
      kind === 'conflict-resynchronized' ||
      kind === 'command-failed'
    );
  }

  private beginAction(
    command: GameCommand,
    deferred = deferredResult(),
  ): PendingAction {
    const model = this.getModel();
    const request = GameActionRequestSchema.parse({
      actionId: this.generateActionId(),
      expectedRevision: model.getSnapshot().revision,
      command,
    });
    const pending: PendingAction = {
      ...deferred,
      request: Object.freeze(request),
      serializedBody: JSON.stringify(request),
      inFlight: false,
    };
    this.pending = pending;
    void this.sendPending(pending);
    return pending;
  }

  private async sendPending(pending: PendingAction): Promise<void> {
    if (this.pending !== pending || pending.inFlight) return;
    pending.inFlight = true;
    this.setLifecycle({
      kind: 'action-in-flight',
      queued: this.queued !== null,
    });
    try {
      const response = await this.transport.executeAction(
        this.requireCredential(),
        pending.serializedBody,
      );
      if (this.pending !== pending) return;
      if (response.actionId !== pending.request.actionId) {
        throw new GameProtocolError(
          'The action response identity did not match.',
        );
      }
      const model = this.getModel();
      this.assertProjection(
        model.getSnapshot().id,
        response.revision,
        response.state,
      );
      model.replace(response.state);
      const result = resultFrom(
        model,
        response.revision,
        response.events as GameEvent[],
        response.deltas,
      );
      for (const listener of this.resultListeners) listener(result);
      this.completePending(pending, result);
    } catch (error) {
      if (this.pending !== pending) return;
      pending.inFlight = false;
      this.handleActionError(pending, error);
    }
  }

  private completePending(pending: PendingAction, result: GameResult): void {
    this.pending = null;
    pending.resolve(result);
    const status = result.model.getSnapshot().status;
    if (status === 'dead' || status === 'won') {
      this.rejectQueued(new GatewayStateError('The game is finished.'));
      this.finishTerminal(result, status);
      return;
    }

    const queued = this.queued;
    this.queued = null;
    if (queued) {
      this.beginAction(queued.command, queued);
    } else {
      this.setLifecycle({ kind: 'playing' });
    }
  }

  private handleActionError(pending: PendingAction, error: unknown): void {
    if (error instanceof GameProtocolMismatchError) {
      this.clearCommands(error);
      this.setLifecycle({ kind: 'protocol-mismatch', message: error.message });
      return;
    }

    if (isInvalidSessionError(error)) {
      this.storage.clearActiveGame();
      this.credential = null;
      this.clearCommands(error);
      this.setLifecycle({
        kind: 'session-invalid',
        message: 'That saved game is no longer available. Start a new game.',
      });
      return;
    }

    if (error instanceof GameApiError) {
      if (
        error.response.actionId !== undefined &&
        error.response.actionId !== pending.request.actionId
      ) {
        this.setLifecycle({
          kind: 'retry-required',
          message:
            'The action error identity did not match. Retry the same action.',
          retryAt: null,
        });
        return;
      }
      if (error.response.code === 'REVISION_CONFLICT') {
        this.handleConflict(pending, error);
        return;
      }
      if (error.response.code === 'GAME_FINISHED') {
        this.handleFinished(pending, error);
        return;
      }
      if (error.response.code === 'INVALID_COMMAND') {
        this.handleInvalidCommand(pending, error);
        return;
      }
      if (
        error.response.code === 'RATE_LIMITED' ||
        error.response.code === 'DATABASE_UNAVAILABLE' ||
        error.response.code === 'DATABASE_ERROR'
      ) {
        this.setLifecycle({
          kind: 'retry-required',
          message: error.message,
          retryAt:
            error.response.code === 'RATE_LIMITED' ? error.retryAt : null,
        });
        return;
      }
    }

    if (error instanceof GameNetworkError) {
      this.setLifecycle({
        kind: 'retry-required',
        message:
          'No response came back for this action. Retry Action will resend the same action without applying it twice.',
        retryAt: null,
      });
      return;
    }

    if (error instanceof GameProtocolError) {
      this.setLifecycle({
        kind: 'retry-required',
        message:
          'The action result could not be read. Retry Action will resend the same action without applying it twice.',
        retryAt: null,
      });
      return;
    }

    this.pending = null;
    pending.reject(error);
    this.rejectQueued(error);
    this.setLifecycle({
      kind: 'command-failed',
      message: messageFrom(error, 'The command was rejected.'),
    });
  }

  private handleInvalidCommand(
    pending: PendingAction,
    error: GameApiError,
  ): void {
    const response = error.response;
    if (
      response.actionId !== pending.request.actionId ||
      response.revision === undefined ||
      !response.state
    ) {
      this.pending = null;
      pending.reject(error);
      this.rejectQueued(error);
      this.setLifecycle({ kind: 'command-failed', message: error.message });
      return;
    }
    try {
      const model = this.getModel();
      this.assertProjection(
        model.getSnapshot().id,
        response.revision,
        response.state,
      );
      model.replace(response.state);
    } catch (protocolError) {
      this.setLifecycle({
        kind: 'retry-required',
        message: messageFrom(
          protocolError,
          'The rejected-command response was invalid. Retry the same action.',
        ),
        retryAt: null,
      });
      return;
    }

    this.pending = null;
    pending.reject(error);
    const queued = this.queued;
    this.queued = null;
    if (queued) {
      this.beginAction(queued.command, queued);
    } else {
      this.setLifecycle({ kind: 'playing' });
    }
  }

  private handleConflict(pending: PendingAction, error: GameApiError): void {
    const response = error.response;
    if (
      response.actionId !== pending.request.actionId ||
      response.revision === undefined ||
      !response.state
    ) {
      this.setLifecycle({
        kind: 'retry-required',
        message: 'The conflict response was incomplete. Retry the same action.',
        retryAt: null,
      });
      return;
    }
    try {
      const model = this.getModel();
      this.assertProjection(
        model.getSnapshot().id,
        response.revision,
        response.state,
      );
      model.replace(response.state);
    } catch (protocolError) {
      this.setLifecycle({
        kind: 'retry-required',
        message: messageFrom(
          protocolError,
          'The conflict response was invalid. Retry the same action.',
        ),
        retryAt: null,
      });
      return;
    }
    this.pending = null;
    pending.reject(error);
    this.rejectQueued(error);
    this.setLifecycle({
      kind: 'conflict-resynchronized',
      message:
        'This game changed in another tab. The latest server state is now shown.',
    });
  }

  private handleFinished(pending: PendingAction, error: GameApiError): void {
    const response = error.response;
    if (response.revision === undefined || !response.state) {
      this.pending = null;
      pending.reject(error);
      this.rejectQueued(error);
      this.setLifecycle({ kind: 'command-failed', message: error.message });
      return;
    }
    try {
      const model = this.getModel();
      this.assertProjection(
        model.getSnapshot().id,
        response.revision,
        response.state,
      );
      model.replace(response.state);
      const result = resultFrom(model, response.revision);
      this.pending = null;
      pending.reject(error);
      this.rejectQueued(error);
      if (response.state.status === 'dead' || response.state.status === 'won') {
        this.finishTerminal(result, response.state.status);
      } else {
        this.setLifecycle({ kind: 'command-failed', message: error.message });
      }
    } catch (protocolError) {
      this.setLifecycle({
        kind: 'retry-required',
        message: messageFrom(
          protocolError,
          'The finished-game response was invalid. Retry the same action.',
        ),
        retryAt: null,
      });
    }
  }

  private acceptInitial(revision: number, state: VisibleGameState): GameResult {
    this.model = new GameClientModel(state);
    const result = resultFrom(this.model, revision);
    if (state.status === 'dead' || state.status === 'won') {
      this.finishTerminal(result, state.status);
    } else {
      this.setLifecycle({ kind: 'playing' });
    }
    return result;
  }

  private finishTerminal(result: GameResult, status: 'dead' | 'won'): void {
    this.storage.clearActiveGame();
    this.credential = null;
    const revision = result.revision;
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
  ): void {
    if (state._id !== gameId || state.revision !== revision) {
      throw new GameProtocolError(
        'The gameplay response contained inconsistent authoritative state.',
      );
    }
  }

  private clearCommands(error: unknown): void {
    const pending = this.pending;
    this.pending = null;
    pending?.reject(error);
    this.rejectQueued(error);
  }

  private rejectQueued(error: unknown): void {
    const queued = this.queued;
    this.queued = null;
    queued?.reject(error);
  }

  private finishAbandon(): void {
    this.storage.clearActiveGame();
    this.credential = null;
    this.clearCommands(new GatewayStateError('The game was abandoned.'));
    this.setLifecycle({ kind: 'abandoned' });
  }

  private setLifecycle(lifecycle: GameGatewayLifecycle): void {
    this.snapshot = {
      version: this.snapshot.version + 1,
      lifecycle,
    };
    for (const listener of this.listeners) listener();
  }
}

export interface GameGatewayContract {
  createGame(input: CreateGameInput): Promise<GameResult>;
  loadGame(): Promise<GameResult>;
  execute(command: GameCommand): Promise<GameResult>;
  retryPendingAction(): Promise<GameResult>;
  abandonGame(): Promise<void>;
}
