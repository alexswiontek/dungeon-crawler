import type { CharacterType } from '@dungeon-crawler/domain/model';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { DeathScreen } from '@/components/DeathScreen';
import { Game } from '@/components/Game';
import { Leaderboard } from '@/components/Leaderboard';
import { StartScreen } from '@/components/StartScreen';
import type { GameClientSnapshot } from '@/game/GameClientModel';
import { GameGateway } from '@/game/GameGateway';
import { GameHttpClient } from '@/game/GameHttpClient';
import { GameSessionStorage } from '@/game/GameSessionStorage';
import { useUiStore } from '@/stores/uiStore';

type AppLifecycle =
  | { readonly kind: 'restoring' }
  | { readonly kind: 'start'; readonly message: string | null }
  | { readonly kind: 'creating' }
  | {
      readonly kind: 'restore-failed';
      readonly gateway: GameGateway;
      readonly legacyGameId?: string;
      readonly message: string;
    }
  | { readonly kind: 'game'; readonly gateway: GameGateway }
  | {
      readonly kind: 'terminal';
      readonly state: GameClientSnapshot;
      readonly won: boolean;
    }
  | { readonly kind: 'protocol-mismatch'; readonly message: string }
  | { readonly kind: 'leaderboard' };

function Title() {
  return <h1 className="mb-5">Dungeon Crawler</h1>;
}

function App() {
  const storage = useMemo(
    () => new GameSessionStorage({ storage: localStorage }),
    [],
  );
  const transport = useMemo(() => new GameHttpClient(), []);
  const [lifecycle, setLifecycle] = useState<AppLifecycle>({
    kind: 'restoring',
  });
  const [playerName, setPlayerName] = useState('');
  const [character, setCharacter] = useState<CharacterType>('dwarf');

  const restoreGateway = useCallback(
    async (gateway: GameGateway): Promise<void> => {
      setLifecycle({ kind: 'restoring' });
      try {
        const result = await gateway.loadGame();
        const status = result.model.getSnapshot().status;
        if (status === 'dead' || status === 'won') {
          setLifecycle({
            kind: 'terminal',
            state: result.model.getSnapshot(),
            won: status === 'won',
          });
        } else {
          setLifecycle({ kind: 'game', gateway });
        }
      } catch {
        const gatewayLifecycle = gateway.getSnapshot().lifecycle;
        if (gatewayLifecycle.kind === 'session-invalid') {
          setLifecycle({ kind: 'start', message: gatewayLifecycle.message });
        } else if (gatewayLifecycle.kind === 'protocol-mismatch') {
          setLifecycle({
            kind: 'protocol-mismatch',
            message: gatewayLifecycle.message,
          });
        } else {
          setLifecycle({
            kind: 'restore-failed',
            gateway,
            message:
              gatewayLifecycle.kind === 'load-failed'
                ? gatewayLifecycle.message
                : 'The saved game could not be loaded. Retry the saved session.',
          });
        }
      }
    },
    [],
  );

  const migrateLegacyGateway = useCallback(
    async (gateway: GameGateway, gameId: string): Promise<void> => {
      setLifecycle({ kind: 'restoring' });
      try {
        const result = await gateway.migrateLegacyGame(gameId);
        const status = result.model.getSnapshot().status;
        if (status === 'dead' || status === 'won') {
          setLifecycle({
            kind: 'terminal',
            state: result.model.getSnapshot(),
            won: status === 'won',
          });
        } else {
          setLifecycle({ kind: 'game', gateway });
        }
      } catch {
        const gatewayLifecycle = gateway.getSnapshot().lifecycle;
        if (gatewayLifecycle.kind === 'protocol-mismatch') {
          setLifecycle({
            kind: 'protocol-mismatch',
            message: gatewayLifecycle.message,
          });
        } else if (gatewayLifecycle.kind === 'session-invalid') {
          setLifecycle({ kind: 'start', message: gatewayLifecycle.message });
        } else {
          setLifecycle({
            kind: 'restore-failed',
            gateway,
            legacyGameId: gameId,
            message:
              gatewayLifecycle.kind === 'load-failed'
                ? gatewayLifecycle.message
                : 'The saved game could not be migrated. Retry when the server is available.',
          });
        }
      }
    },
    [],
  );

  useEffect(() => {
    const preferences = storage.loadPreferences();
    if (preferences) {
      setPlayerName(preferences.playerName);
      setCharacter(preferences.character);
    }

    const credential = storage.loadActiveGame();
    if (credential) {
      const gateway = new GameGateway({ transport, storage, credential });
      void restoreGateway(gateway);
      return;
    }
    const legacy = storage.loadLegacyGame();
    if (!legacy) {
      setLifecycle({ kind: 'start', message: null });
      return;
    }
    const gateway = new GameGateway({ transport, storage });
    void migrateLegacyGateway(gateway, legacy.gameId);
  }, [migrateLegacyGateway, restoreGateway, storage, transport]);

  const handleStartGame = async (
    name: string,
    selectedCharacter: CharacterType,
  ): Promise<void> => {
    if (lifecycle.kind === 'creating') return;
    useUiStore.getState().reset();
    setPlayerName(name);
    setCharacter(selectedCharacter);
    storage.savePreferences({
      playerName: name,
      character: selectedCharacter,
    });
    setLifecycle({ kind: 'creating' });
    const gateway = new GameGateway({ transport, storage });
    try {
      await gateway.createGame({
        playerName: name,
        character: selectedCharacter,
      });
      setLifecycle({ kind: 'game', gateway });
    } catch {
      const gatewayLifecycle = gateway.getSnapshot().lifecycle;
      if (gatewayLifecycle.kind === 'protocol-mismatch') {
        setLifecycle({
          kind: 'protocol-mismatch',
          message: gatewayLifecycle.message,
        });
      } else {
        setLifecycle({
          kind: 'start',
          message:
            gatewayLifecycle.kind === 'create-failed'
              ? gatewayLifecycle.message
              : 'The game could not be created. Try again.',
        });
      }
    }
  };

  const handleSessionInvalid = (message: string): void => {
    setLifecycle({ kind: 'start', message });
  };

  const handleBackToStart = (): void => {
    setLifecycle({ kind: 'start', message: null });
  };

  if (lifecycle.kind === 'restoring') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-5">
        <Title />
        <p className="text-gray-500">Loading saved game...</p>
      </div>
    );
  }

  if (lifecycle.kind === 'game') {
    return (
      <Game
        gateway={lifecycle.gateway}
        onGameEnd={(state, won) =>
          setLifecycle({ kind: 'terminal', state, won })
        }
        onSessionInvalid={handleSessionInvalid}
        onAbandoned={handleBackToStart}
      />
    );
  }

  if (lifecycle.kind === 'protocol-mismatch') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-5 text-center">
        <Title />
        <h2 className="text-accent">Reload required</h2>
        <p className="text-gray-400 mt-3">{lifecycle.message}</p>
        <button
          type="button"
          className="mt-5"
          onClick={() => window.location.reload()}
        >
          Reload Game
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center p-5">
      <Title />

      {(lifecycle.kind === 'start' || lifecycle.kind === 'creating') && (
        <StartScreen
          initialName={playerName}
          initialCharacter={character}
          onStart={handleStartGame}
          onShowLeaderboard={() => setLifecycle({ kind: 'leaderboard' })}
          error={lifecycle.kind === 'start' ? lifecycle.message : null}
          isLoading={lifecycle.kind === 'creating'}
        />
      )}

      {lifecycle.kind === 'restore-failed' && (
        <div role="alert" className="text-center">
          <h2 className="text-accent">Saved game unavailable</h2>
          <p className="text-gray-400 mt-3">{lifecycle.message}</p>
          <button
            type="button"
            className="mt-5"
            onClick={() =>
              lifecycle.legacyGameId
                ? void migrateLegacyGateway(
                    lifecycle.gateway,
                    lifecycle.legacyGameId,
                  )
                : void restoreGateway(lifecycle.gateway)
            }
          >
            Retry Load
          </button>
        </div>
      )}

      {lifecycle.kind === 'terminal' && (
        <DeathScreen
          gameState={lifecycle.state}
          won={lifecycle.won}
          playerName={playerName}
          onPlayAgainWithName={() =>
            void handleStartGame(playerName, character)
          }
          onChangeName={handleBackToStart}
          onShowLeaderboard={() => setLifecycle({ kind: 'leaderboard' })}
        />
      )}

      {lifecycle.kind === 'leaderboard' && (
        <Leaderboard onBack={handleBackToStart} />
      )}
    </div>
  );
}

export default App;
