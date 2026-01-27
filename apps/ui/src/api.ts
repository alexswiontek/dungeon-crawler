import type {
  CharacterType,
  GameState,
  LeaderboardEntry,
  NewGameResponse,
} from '@dungeon-crawler/shared';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
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
