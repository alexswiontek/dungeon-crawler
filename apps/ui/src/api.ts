import type { LeaderboardEntry } from '@dungeon-crawler/shared';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

export const api = {
  async getLeaderboard(): Promise<{ entries: LeaderboardEntry[] }> {
    const response = await fetch(`${API_BASE}/leaderboard`, {
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) throw new Error('Failed to load leaderboard');
    return (await response.json()) as { entries: LeaderboardEntry[] };
  },
};
