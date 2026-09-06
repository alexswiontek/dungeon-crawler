import type { CharacterType } from '@dungeon-crawler/domain/model';
import {
  type GameCommandResult,
  GameCommandResultSchema,
  type GameErrorResponse,
  GameErrorResponseSchema,
  GAMEPLAY_PROTOCOL_HEADER,
  GAMEPLAY_PROTOCOL_VERSION,
  type GameStateResponse,
  GameStateResponseSchema,
  type NewGameResponse,
  NewGameResponseSchema,
} from '@dungeon-crawler/protocol/schemas';
import {
  API_BASE_URL,
  gameWebSocketUrl,
  normalizeApiBaseUrl,
} from '@/config/apiBaseUrl';

export const DEFAULT_GAME_REQUEST_TIMEOUT_MS = 15_000;

export interface GameSessionCredential {
  readonly gameId: string;
  readonly sessionToken: string;
}

export interface CreateGameInput {
  readonly playerName: string;
  readonly character: CharacterType;
}

export interface GameTransport {
  createGame(input: CreateGameInput): Promise<NewGameResponse>;
  migrateLegacyGame(gameId: string): Promise<NewGameResponse>;
  loadGame(credential: GameSessionCredential): Promise<GameStateResponse>;
  executeAction(
    credential: GameSessionCredential,
    serializedBody: string,
  ): Promise<GameCommandResult>;
  abandonGame(credential: GameSessionCredential): Promise<void>;
  openGameSocket?(gameId: string): WebSocket;
}

interface RuntimeSchema<T> {
  parse(input: unknown): T;
}

export class GameApiError extends Error {
  constructor(
    readonly status: number,
    readonly response: GameErrorResponse,
    readonly retryAt: number | null = null,
  ) {
    super(response.error);
    this.name = 'GameApiError';
  }
}

export class GameNetworkError extends Error {
  constructor() {
    super('Could not reach the game server.');
    this.name = 'GameNetworkError';
  }
}

export class GameRequestTimeoutError extends GameNetworkError {
  constructor() {
    super();
    this.message = 'The game server took too long to respond.';
    this.name = 'GameRequestTimeoutError';
  }
}

export class GameProtocolError extends Error {
  constructor(message = 'The server returned an invalid gameplay response.') {
    super(message);
    this.name = 'GameProtocolError';
  }
}

export class GameProtocolMismatchError extends Error {
  constructor(readonly receivedVersion: string | null) {
    super('This game tab is incompatible with the server. Reload the page.');
    this.name = 'GameProtocolMismatchError';
  }
}

interface GameHttpClientOptions {
  readonly baseUrl?: string;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  readonly requestTimeoutMs?: number;
  readonly enableWebSocket?: boolean;
}

function authorization(credential: GameSessionCredential): HeadersInit {
  return { Authorization: `Bearer ${credential.sessionToken}` };
}

function retryAt(response: Response, now: () => number): number | null {
  const value = response.headers.get('Retry-After');
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return now() + Math.max(0, seconds * 1000);
  const absolute = Date.parse(value);
  return Number.isNaN(absolute) ? null : absolute;
}

export class GameHttpClient implements GameTransport {
  private readonly baseUrl: string;
  private readonly fetchImplementation: typeof fetch;
  private readonly now: () => number;
  private readonly requestTimeoutMs: number;
  readonly openGameSocket?: (gameId: string) => WebSocket;

  constructor(options: GameHttpClientOptions = {}) {
    this.baseUrl =
      options.baseUrl === undefined
        ? API_BASE_URL
        : normalizeApiBaseUrl(options.baseUrl);
    this.fetchImplementation =
      options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.now = options.now ?? Date.now;
    this.requestTimeoutMs =
      options.requestTimeoutMs ?? DEFAULT_GAME_REQUEST_TIMEOUT_MS;
    if (!Number.isFinite(this.requestTimeoutMs) || this.requestTimeoutMs <= 0) {
      throw new RangeError('requestTimeoutMs must be a positive number.');
    }
    if (options.enableWebSocket ?? import.meta.env.MODE !== 'test') {
      this.openGameSocket = (gameId) =>
        new WebSocket(gameWebSocketUrl(gameId, this.baseUrl));
    }
  }

  createGame(input: CreateGameInput): Promise<NewGameResponse> {
    return this.fetchJson(`${this.baseUrl}/games`, NewGameResponseSchema, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  migrateLegacyGame(gameId: string): Promise<NewGameResponse> {
    return this.fetchJson(
      `${this.gameUrl(gameId)}/migrate`,
      NewGameResponseSchema,
      { method: 'POST' },
    );
  }

  loadGame(credential: GameSessionCredential): Promise<GameStateResponse> {
    return this.fetchJson(
      this.gameUrl(credential.gameId),
      GameStateResponseSchema,
      { headers: authorization(credential) },
    );
  }

  executeAction(
    credential: GameSessionCredential,
    serializedBody: string,
  ): Promise<GameCommandResult> {
    return this.fetchJson(
      `${this.gameUrl(credential.gameId)}/actions`,
      GameCommandResultSchema,
      {
        method: 'POST',
        headers: authorization(credential),
        body: serializedBody,
      },
    );
  }

  async abandonGame(credential: GameSessionCredential): Promise<void> {
    const response = await this.request(this.gameUrl(credential.gameId), {
      method: 'DELETE',
      headers: authorization(credential),
    });
    this.assertVersion(response);
    if (!response.ok) throw await this.parseError(response);
    if (response.status !== 204) throw new GameProtocolError();
  }

  private gameUrl(gameId: string): string {
    return `${this.baseUrl}/games/${encodeURIComponent(gameId)}`;
  }

  private async request(url: string, options: RequestInit): Promise<Response> {
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.requestTimeoutMs);
    try {
      return await this.fetchImplementation(url, {
        ...options,
        signal: controller.signal,
        headers: {
          [GAMEPLAY_PROTOCOL_HEADER]: GAMEPLAY_PROTOCOL_VERSION,
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
          ...options.headers,
        },
      });
    } catch {
      if (timedOut) throw new GameRequestTimeoutError();
      throw new GameNetworkError();
    } finally {
      clearTimeout(timeout);
    }
  }

  private assertVersion(response: Response): void {
    const version = response.headers.get(GAMEPLAY_PROTOCOL_HEADER);
    const contentType = response.headers.get('Content-Type') ?? '';
    if (
      version === null &&
      response.status >= 500 &&
      !contentType.includes('application/json')
    ) {
      throw new GameNetworkError();
    }
    if (version !== GAMEPLAY_PROTOCOL_VERSION) {
      throw new GameProtocolMismatchError(version);
    }
  }

  private async parseJson(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      throw new GameProtocolError();
    }
  }

  private async parseError(response: Response): Promise<GameApiError> {
    const payload = await this.parseJson(response);
    try {
      const parsed = GameErrorResponseSchema.parse(payload);
      if (parsed.code === 'PROTOCOL_MISMATCH') {
        throw new GameProtocolMismatchError(
          response.headers.get(GAMEPLAY_PROTOCOL_HEADER),
        );
      }
      const eligibleAt = retryAt(response, this.now);
      if (parsed.code === 'RATE_LIMITED' && eligibleAt === null) {
        throw new GameProtocolError(
          'The rate-limit response omitted its retry timing.',
        );
      }
      return new GameApiError(response.status, parsed, eligibleAt);
    } catch (error) {
      if (
        error instanceof GameProtocolError ||
        error instanceof GameProtocolMismatchError
      ) {
        throw error;
      }
      throw new GameProtocolError();
    }
  }

  private async fetchJson<T>(
    url: string,
    schema: RuntimeSchema<T>,
    options: RequestInit,
  ): Promise<T> {
    const response = await this.request(url, options);
    this.assertVersion(response);
    if (!response.ok) throw await this.parseError(response);
    const payload = await this.parseJson(response);
    try {
      return schema.parse(payload);
    } catch {
      throw new GameProtocolError();
    }
  }
}

export function isInvalidSessionError(error: unknown): boolean {
  return (
    error instanceof GameApiError &&
    (error.response.code === 'UNAUTHORIZED' ||
      error.response.code === 'GAME_NOT_FOUND')
  );
}
