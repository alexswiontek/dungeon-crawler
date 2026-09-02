import type { CharacterType } from '@dungeon-crawler/domain';
import {
  GAMEPLAY_PROTOCOL_HEADER,
  GAMEPLAY_PROTOCOL_VERSION,
  type GameCommandResult,
  GameCommandResultSchema,
  type GameErrorResponse,
  GameErrorResponseSchema,
  type GameStateResponse,
  GameStateResponseSchema,
  type NewGameResponse,
  NewGameResponseSchema,
} from '@dungeon-crawler/protocol';

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
  loadGame(credential: GameSessionCredential): Promise<GameStateResponse>;
  executeAction(
    credential: GameSessionCredential,
    serializedBody: string,
  ): Promise<GameCommandResult>;
  abandonGame(credential: GameSessionCredential): Promise<void>;
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

  constructor(options: GameHttpClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? import.meta.env.VITE_API_URL ?? '/api';
    this.fetchImplementation =
      options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.now = options.now ?? Date.now;
  }

  createGame(input: CreateGameInput): Promise<NewGameResponse> {
    return this.fetchJson(`${this.baseUrl}/games`, NewGameResponseSchema, {
      method: 'POST',
      body: JSON.stringify(input),
    });
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
    try {
      return await this.fetchImplementation(url, {
        ...options,
        headers: {
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
          ...options.headers,
        },
      });
    } catch {
      throw new GameNetworkError();
    }
  }

  private assertVersion(response: Response): void {
    const version = response.headers.get(GAMEPLAY_PROTOCOL_HEADER);
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
      const eligibleAt = retryAt(response, this.now);
      if (parsed.code === 'RATE_LIMITED' && eligibleAt === null) {
        throw new GameProtocolError(
          'The rate-limit response omitted its retry timing.',
        );
      }
      return new GameApiError(response.status, parsed, eligibleAt);
    } catch (error) {
      if (error instanceof GameProtocolError) throw error;
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
