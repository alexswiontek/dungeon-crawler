import { Button } from '@/components/Button';
import type { GameState } from '@/engine/GameState';
import { cn } from '@/utils/cn';

export function DeathScreen({
  gameState,
  won,
  playerName,
  onPlayAgainWithName,
  onChangeName,
  onShowLeaderboard,
}: {
  gameState: GameState;
  won: boolean;
  playerName: string;
  onPlayAgainWithName: () => void;
  onChangeName: () => void;
  onShowLeaderboard: () => void;
}) {
  return (
    <div className="text-center">
      <h2 className={cn('mb-5', won ? 'text-success' : 'text-accent')}>
        {won ? 'Victory!' : 'Game Over'}
      </h2>

      <p className="mb-2.5">
        {won
          ? 'You escaped the dungeon!'
          : 'You have perished in the depths...'}
      </p>

      <div className="mb-8">
        <p>
          <span className="text-gray-500">Player: </span>
          {gameState.playerName}
        </p>
        <p>
          <span className="text-gray-500">Final Score: </span>
          <span className="text-player text-2xl">{gameState.score}</span>
        </p>
        <p>
          <span className="text-gray-500">Reached Floor: </span>
          {gameState.floor}
        </p>
      </div>

      <div className="flex flex-col gap-2.5 items-center">
        <div className="flex gap-2.5">
          <Button type="button" onClick={onPlayAgainWithName}>
            Play as {playerName}
          </Button>
          <Button type="button" onClick={onShowLeaderboard}>
            Leaderboard
          </Button>
        </div>
        <Button
          variant="unstyled"
          type="button"
          onClick={onChangeName}
          className="text-sm text-gray-500 hover:text-gray-300 bg-transparent border-none underline"
        >
          Change Name/Character
        </Button>
      </div>
    </div>
  );
}
