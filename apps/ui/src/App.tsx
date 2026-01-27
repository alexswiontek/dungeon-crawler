import type { CharacterType } from '@dungeon-crawler/shared';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { api } from '@/api';
import { DeathScreen } from '@/components/DeathScreen';
import { Game } from '@/components/Game';
import { Leaderboard } from '@/components/Leaderboard';
import { StartScreen } from '@/components/StartScreen';
import type { GameState } from '@/engine/GameState';
import { safeLocalStorage } from '@/utils/storage';

type Screen = 'start' | 'game' | 'dead' | 'won' | 'leaderboard';

const STORAGE_KEY = 'dungeon_crawler_active_game';
const GAME_TTL_MS = 60 * 60 * 1000; // 1 hour

const SavedGameSchema = z.object({
  gameId: z.string(),
  playerName: z.string(),
  character: z.enum(['dwarf', 'elf', 'bandit', 'wizard']).optional(),
  savedAt: z.number(),
});

function Title() {
  return <h1 className="mb-5">Dungeon Crawler</h1>;
}

function App() {
  const [screen, setScreen] = useState<Screen>('start');
  const [gameId, setGameId] = useState<string | null>(null);
  const [playerName, setPlayerName] = useState<string>('');
  const [character, setCharacter] = useState<CharacterType>('dwarf');
  const [finalState, setFinalState] = useState<GameState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRestoring, setIsRestoring] = useState(true);

  // Check for saved game on mount
  useEffect(() => {
    const checkSavedGame = async () => {
      try {
        const saved = safeLocalStorage.getItem(STORAGE_KEY);
        if (!saved) {
          setIsRestoring(false);
          return;
        }

        const parsed = SavedGameSchema.safeParse(JSON.parse(saved));
        if (!parsed.success) {
          safeLocalStorage.removeItem(STORAGE_KEY);
          setIsRestoring(false);
          return;
        }

        const {
          gameId: savedGameId,
          playerName: savedName,
          character: savedCharacter,
          savedAt,
        } = parsed.data;

        // Always preserve the player name and character for convenience
        if (savedName) {
          setPlayerName(savedName);
        }
        if (savedCharacter) {
          setCharacter(savedCharacter);
        }

        // Check TTL - expire after 1 hour
        if (Date.now() - savedAt > GAME_TTL_MS) {
          safeLocalStorage.removeItem(STORAGE_KEY);
          setIsRestoring(false);
          return;
        }

        // Check if game is still active
        const response = await api.getGame(savedGameId);
        if (response.state.status === 'active') {
          setGameId(savedGameId);
          setScreen('game');
        } else {
          // Game is no longer active, clear storage (name already preserved)
          safeLocalStorage.removeItem(STORAGE_KEY);
        }
      } catch {
        // Game not found or error, clear storage (name already preserved)
        safeLocalStorage.removeItem(STORAGE_KEY);
      } finally {
        setIsRestoring(false);
      }
    };

    checkSavedGame();
  }, []);

  const handleStartGame = async (
    name: string,
    selectedCharacter: CharacterType,
  ) => {
    try {
      setError(null);
      setPlayerName(name);
      setCharacter(selectedCharacter);
      const response = await api.createGame(name, selectedCharacter);
      setGameId(response.gameId);
      // Save to localStorage for auto-resume
      safeLocalStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          gameId: response.gameId,
          playerName: name,
          character: selectedCharacter,
          savedAt: Date.now(),
        }),
      );
      setScreen('game');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start game');
    }
  };

  const handlePlayAgainWithName = async () => {
    if (playerName) {
      await handleStartGame(playerName, character);
    }
  };

  const handleRestart = () => {
    // Clear old game from storage
    safeLocalStorage.removeItem(STORAGE_KEY);
    // Go back to start screen with name preserved (allows character change)
    setGameId(null);
    setFinalState(null);
    setScreen('start');
  };

  const handleGameEnd = (state: GameState, won: boolean) => {
    // Clear saved game since it's over
    safeLocalStorage.removeItem(STORAGE_KEY);
    setFinalState(state);
    setScreen(won ? 'won' : 'dead');
  };

  const handleBackToStart = () => {
    setGameId(null);
    setFinalState(null);
    setScreen('start');
  };

  const handleShowLeaderboard = () => {
    setScreen('leaderboard');
  };

  // Show loading while checking for saved game
  if (isRestoring) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-5">
        <Title />
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  // Game screen uses its own full-screen layout
  if (screen === 'game' && gameId) {
    return (
      <Game
        key={gameId}
        gameId={gameId}
        onGameEnd={handleGameEnd}
        onRestart={handleRestart}
      />
    );
  }

  // Non-game screens use centered layout with title
  return (
    <div className="min-h-screen flex flex-col items-center p-5">
      <Title />

      {screen === 'start' && (
        <StartScreen
          initialName={playerName}
          onStart={handleStartGame}
          onShowLeaderboard={handleShowLeaderboard}
          error={error}
        />
      )}

      {(screen === 'dead' || screen === 'won') && finalState && (
        <DeathScreen
          gameState={finalState}
          won={screen === 'won'}
          playerName={playerName}
          onPlayAgainWithName={handlePlayAgainWithName}
          onChangeName={handleBackToStart}
          onShowLeaderboard={handleShowLeaderboard}
        />
      )}

      {screen === 'leaderboard' && <Leaderboard onBack={handleBackToStart} />}
    </div>
  );
}

export default App;
