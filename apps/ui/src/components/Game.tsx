import { useEffect, useRef, useState } from 'react';
import { ActionLog } from '@/components/ActionLog';
import { ConfirmModal } from '@/components/ConfirmModal';
import { ConnectionOverlay } from '@/components/ConnectionOverlay';
import { DamageNumbers } from '@/components/DamageNumbers';
import { DPad } from '@/components/DPad';
import { GameTooltip } from '@/components/GameTooltip';
import { Header } from '@/components/Header';
import { HUD } from '@/components/HUD';
import { LoadingScreen } from '@/components/LoadingScreen';
import { Projectiles } from '@/components/Projectile';
import { ToastContainer } from '@/components/ToastContainer';
import { AssetManager } from '@/engine/AssetManager';
import { GameCanvas } from '@/engine/GameCanvas';
import type { GameState } from '@/engine/GameState';
import { useDamageEvents } from '@/hooks/useDamageEvents';
import { useEventNotifications } from '@/hooks/useEventNotifications';
import { useGameSocket } from '@/hooks/useGameSocket';
import { useKeyboardControls } from '@/hooks/useKeyboardControls';
import { useProjectileEvents } from '@/hooks/useProjectileEvents';
import { useScreenShake } from '@/hooks/useScreenShake';
import { useViewport } from '@/hooks/useViewport';
import { useWindowSize } from '@/hooks/useWindowSize';
import { getProjectileConfig, TILE_SIZE } from '@/sprites';
import { cn } from '@/utils/cn';

export function Game({
  gameId,
  onGameEnd,
  onRestart,
}: {
  gameId: string;
  onGameEnd: (state: GameState, won: boolean) => void;
  onRestart: () => void;
}) {
  const {
    gameState,
    events,
    connected,
    reconnecting,
    reconnectAttempt,
    error,
    sendMove,
    sendAttack,
    damagedEntities,
    hasPlayer,
    status,
  } = useGameSocket(gameId);
  const { isMobile, width, height } = useWindowSize();

  const [showRestartConfirm, setShowRestartConfirm] = useState(false);
  const [zoomedOut, setZoomedOut] = useState(true);

  const gameContainerRef = useRef<HTMLDivElement>(null);
  const { handleKeyDown, handleMove, handleAttack } = useKeyboardControls(
    gameState,
    sendMove,
    sendAttack,
  );

  // Viewport calculations
  const { viewportTiles, tileScale, camera } = useViewport({
    width,
    height,
    isMobile,
    zoomedOut,
    playerX: gameState.player?.x,
    playerY: gameState.player?.y,
  });

  // Event notifications (toasts and tooltips)
  const { toasts, tooltip, removeToast, clearTooltip } = useEventNotifications(
    events,
    hasPlayer,
  );

  // Damage events
  const { damageEvents, removeDamageEvent } = useDamageEvents(
    events,
    gameState.player?.x,
    gameState.player?.y,
  );

  // Projectile events
  const { projectiles, removeProjectile } = useProjectileEvents(
    events,
    gameState.player?.x,
    gameState.player?.y,
    gameState.player?.facingDirection,
  );

  // Screen shake effect
  const playerDamaged = damagedEntities.includes('player');
  const isScreenShaking = useScreenShake(playerDamaged);
  const isLoading = !connected || reconnecting;

  const toggleZoom = () => {
    setZoomedOut((prev) => !prev);
  };

  const handleRestartClick = () => {
    setShowRestartConfirm(true);
  };

  // Notify parent when game ends
  useEffect(() => {
    if (gameState.player && (status === 'dead' || status === 'won')) {
      onGameEnd(gameState, status === 'won');
    }
  }, [status, gameState, onGameEnd]);

  // Auto-focus game container for keyboard controls
  useEffect(() => {
    if (hasPlayer && !isLoading) {
      gameContainerRef.current?.focus();
    }
  }, [hasPlayer, isLoading]);

  // Loading state - waiting for game state
  if (!hasPlayer) {
    return <LoadingScreen connected={connected} error={error} />;
  }

  return (
    <div
      ref={gameContainerRef}
      role="application"
      aria-label="Dungeon Crawler game"
      onKeyDown={handleKeyDown}
      tabIndex={-1}
      className="fixed inset-0 w-screen h-screen md:py-2.5 flex flex-col bg-primary select-none touch-none focus:outline-none"
    >
      {/* Header with title and controls */}
      <div className="shrink-0 z-50 relative">
        <Header
          zoomedOut={zoomedOut}
          onToggleZoom={toggleZoom}
          onRestart={handleRestartClick}
        />
      </div>

      {/* Desktop controls hint */}
      <div className="hidden md:flex justify-center py-1 text-xs text-gray-500 shrink-0">
        <span>
          <kbd className="px-1 py-0.5 bg-gray-800 rounded text-gray-400">
            WASD
          </kbd>{' '}
          or{' '}
          <kbd className="px-1 py-0.5 bg-gray-800 rounded text-gray-400">
            Arrows
          </kbd>{' '}
          to move/attack •{' '}
          <kbd className="px-1 py-0.5 bg-gray-800 rounded text-gray-400">
            Space
          </kbd>{' '}
          ranged attack
        </span>
      </div>

      {/* Game viewport */}
      <div
        className={cn(
          'flex-1 md:h-[70vh] md:flex-initial overflow-hidden relative',
          isScreenShaking && 'screen-shake',
        )}
      >
        <div className="w-full h-full flex items-center justify-center">
          <GameCanvas
            gameState={gameState}
            assets={AssetManager}
            viewportTiles={viewportTiles}
            tileScale={tileScale}
            damagedEntities={damagedEntities}
          />

          {/* Projectile animations */}
          <div
            className="absolute overflow-hidden pointer-events-none left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50"
            style={{
              width: viewportTiles.x * TILE_SIZE * tileScale,
              height: viewportTiles.y * TILE_SIZE * tileScale,
            }}
          >
            <Projectiles
              projectiles={projectiles}
              cameraX={camera.x}
              cameraY={camera.y}
              tileScale={tileScale}
              onComplete={removeProjectile}
            />
          </div>

          {/* Floating damage numbers */}
          <div
            className="absolute overflow-hidden pointer-events-none left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
            style={{
              width: viewportTiles.x * TILE_SIZE * tileScale,
              height: viewportTiles.y * TILE_SIZE * tileScale,
            }}
          >
            <DamageNumbers
              damageEvents={damageEvents}
              cameraX={camera.x}
              cameraY={camera.y}
              tileScale={tileScale}
              onComplete={removeDamageEvent}
            />
          </div>

          {/* Loading/Reconnecting overlay */}
          {isLoading && (
            <ConnectionOverlay
              reconnecting={reconnecting}
              reconnectAttempt={reconnectAttempt}
              error={error}
            />
          )}

          {/* Toasts */}
          <ToastContainer toasts={toasts} onRemove={removeToast} />

          {/* Tooltip overlay - tethered to game canvas */}
          {tooltip && (
            <GameTooltip
              key={tooltip.id}
              message={tooltip.message}
              subtext={tooltip.subtext}
              variant={tooltip.variant}
              onDone={clearTooltip}
              toastCount={toasts.length}
            />
          )}
        </div>
      </div>

      {/* D-pad controls - mobile only (overlays on viewport) */}
      <DPad
        onMove={handleMove}
        onAttack={handleAttack}
        disabled={isLoading || status !== 'active'}
        projectileConfig={getProjectileConfig(
          gameState.player?.character ?? 'dwarf',
        )}
      />

      {/* Compact HUD with action log - mobile only (overlays below header) */}
      <div className="md:hidden fixed top-12 left-0 right-0 z-40 pointer-events-none">
        <div className="pointer-events-auto">
          <HUD gameState={gameState} events={events} compact />
        </div>
        <div className="pointer-events-auto bg-dark/70 backdrop-blur-sm">
          <ActionLog events={events} maxEvents={3} />
        </div>
      </div>

      {/* Desktop HUD */}
      <div className="hidden md:block px-4 pb-4 w-full max-w-4xl mx-auto shrink-0">
        <HUD gameState={gameState} events={events} />
      </div>

      {/* Restart confirmation modal */}
      {showRestartConfirm && (
        <ConfirmModal
          message="Are you sure you want to restart? All progress will be lost."
          onConfirm={() => {
            setShowRestartConfirm(false);
            onRestart();
          }}
          onCancel={() => setShowRestartConfirm(false)}
        />
      )}
    </div>
  );
}
