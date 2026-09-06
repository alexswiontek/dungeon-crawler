import type { LeaderboardEntry } from '@dungeon-crawler/domain/model';
import { API_BASE_URL } from '@/config/apiBaseUrl';

export const api = {
  async getLeaderboard(): Promise<{ entries: LeaderboardEntry[] }> {
    const response = await fetch(`${API_BASE_URL}/leaderboard`, {
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) throw new Error('Failed to load leaderboard');
    return (await response.json()) as { entries: LeaderboardEntry[] };
  },
};
