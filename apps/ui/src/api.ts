import type {
  CharacterType,
  GameState,
  LeaderboardEntry,
  NewGameResponse,
} from '@dungeon-crawler/shared';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

interface ApiErrorResponse {
  error: string;
  code?: string;
}

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    if (!response.ok) {
      const error: ApiErrorResponse = await response
        .json()
        .catch(() => ({ error: 'Unknown error' }));

      // Use the error message from the API if available
      let message = error.error || `HTTP ${response.status}`;

      // Provide user-friendly messages for specific error codes
      if (error.code === 'DATABASE_UNAVAILABLE') {
        message =
          'Database is temporarily unavailable. Please try again in a moment.';
      } else if (error.code === 'DATABASE_ERROR') {
        message = 'Server error. Please try again later.';
      } else if (response.status === 503) {
        message =
          'Server is temporarily unavailable. Please try again in a moment.';
      } else if (response.status >= 500) {
        message = 'Server error. Please try again later.';
      }

      throw new Error(message);
    }

    return response.json();
  } catch (err) {
    // Network errors (MongoDB down, server unreachable, etc.)
    // Handle cross-browser network errors (TypeError, NetworkError, etc.)
    if (
      err instanceof TypeError ||
      (err instanceof Error && err.name === 'NetworkError')
    ) {
      throw new Error(
        'Unable to connect to server. Please check your connection.',
      );
    }

    // Ensure we throw an Error instance
    if (err instanceof Error) {
      throw err;
    }
    throw new Error('An unexpected error occurred');
  }
}

export const api = {
  createGame(
    playerName: string,
    character: CharacterType,
  ): Promise<NewGameResponse> {
    return fetchJson(`${API_BASE}/game/new`, {
      method: 'POST',
      body: JSON.stringify({ playerName, character }),
    });
  },

  getGame(gameId: string): Promise<{ state: GameState }> {
    return fetchJson(`${API_BASE}/game/${gameId}`);
  },

  getLeaderboard(): Promise<{ entries: LeaderboardEntry[] }> {
    return fetchJson(`${API_BASE}/leaderboard`);
  },
};
