import type { LeaderboardEntry } from '@dungeon-crawler/shared';
import { useEffect, useState } from 'react';
import { api } from '@/api';
import { Button } from '@/components/Button';
import { cn } from '@/utils/cn';

export function Leaderboard({ onBack }: { onBack: () => void }) {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getLeaderboard()
      .then((res) => setEntries(res.entries))
      .catch((err) => {
        console.error('Failed to fetch leaderboard:', err);
        setError('Failed to load leaderboard. Please try again later.');
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="text-center min-w-[400px]">
      <h2 className="mb-5">Leaderboard</h2>

      {loading ? (
        <p>Loading...</p>
      ) : error ? (
        <div className="text-red-500 mb-4">
          <p>{error}</p>
        </div>
      ) : entries.length === 0 ? (
        <p className="text-gray-500">No scores yet. Be the first!</p>
      ) : (
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-gray-700">
              <th className="p-2 text-left">#</th>
              <th className="p-2 text-left">Name</th>
              <th className="p-2 text-right">Score</th>
              <th className="p-2 text-right">Floor</th>
              <th className="p-2 text-left">Killed By</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry, i) => (
              <tr key={entry._id} className="border-b border-gray-800">
                <td className="p-2 text-gray-500">{i + 1}</td>
                <td className="p-2">{entry.playerName}</td>
                <td className="p-2 text-right text-player">{entry.score}</td>
                <td className="p-2 text-right">{entry.floor}</td>
                <td
                  className={cn(
                    'p-2',
                    entry.killedBy ? 'text-accent' : 'text-success',
                  )}
                >
                  {entry.killedBy || 'Escaped!'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <Button type="button" onClick={onBack} className="mt-5">
        Back
      </Button>
    </div>
  );
}
