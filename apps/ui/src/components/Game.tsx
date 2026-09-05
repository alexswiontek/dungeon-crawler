import { useEffect, useRef, useState } from 'react';
import { ActionLog } from '@/components/ActionLog';
import { ActionRequestOverlay } from '@/components/ActionRequestOverlay';
import { ConfirmModal } from '@/components/ConfirmModal';
import { DamageNumbers } from '@/components/DamageNumbers';
import { DPad } from '@/components/DPad';
import { GameTooltip } from '@/components/GameTooltip';
import { Header } from '@/components/Header';
import { HUD } from '@/components/HUD';
import { Projectiles } from '@/components/Projectile';
import { ToastContainer } from '@/components/ToastContainer';
import { AssetManager } from '@/engine/AssetManager';
import { GameCanvas } from '@/engine/GameCanvas';
import type { GameClientSnapshot } from '@/game/GameClientModel';
import type { GameGateway, GameGatewayLifecycle } from '@/game/GameGateway';
import { useDamageEvents } from '@/hooks/useDamageEvents';
import { useEventNotifications } from '@/hooks/useEventNotifications';
import { useGameSession } from '@/hooks/useGameSession';
import { useKeyboardControls } from '@/hooks/useKeyboardControls';
import { useProjectileEvents } from '@/hooks/useProjectileEvents';
import { useScreenShake } from '@/hooks/useScreenShake';
import { useViewport } from '@/hooks/useViewport';
import { useWindowSize } from '@/hooks/useWindowSize';
import { getProjectileConfig, TILE_SIZE } from '@/sprites';
import { cn } from '@/utils/cn';

interface GameProps {
  gateway: GameGateway;
  onGameEnd: (state: GameClientSnapshot, won: boolean) => void;
  onSessionInvalid: (message: string) => void;
  onAbandoned: () => void;
}

function permitsInput(lifecycle: GameGatewayLifecycle): boolean {
  return (
    lifecycle.kind === 'playing' ||
    lifecycle.kind === 'action-in-flight' ||
    lifecycle.kind === 'conflict-resynchronized' ||
    lifecycle.kind === 'command-failed'
  );
}

export function Game({
  gateway,
  onGameEnd,
  onSessionInvalid,
  onAbandoned,
}: GameProps) {
  const {
    model,
    game,
    gatewaySnapshot,
    events,
    damagedEntities,
    sendMove,
    sendAttack,
    retryAction,
  } = useGameSession(gateway);
  const { isMobile, width, height } = useWindowSize();
  const [showRestartConfirm, setShowRestartConfirm] = useState(false);
  const [zoomedOut, setZoomedOut] = useState(true);
  const [localNotice, setLocalNotice] = useState<string | null>(null);
  const gameContainerRef = useRef<HTMLDivElement>(null);
  const terminalRevisionRef = useRef<number | null>(null);
  const sessionInvalidHandledRef = useRef(false);
  const abandonedHandledRef = useRef(false);
  const lifecycle = gatewaySnapshot.lifecycle;
  const inputAllowed = permitsInput(lifecycle) && game.status === 'active';

  useEffect(() => {
    const closeGateway = (event: PageTransitionEvent) => {
      if (!event.persisted) gateway.dispose();
    };
    window.addEventListener('pagehide', closeGateway);
    return () => window.removeEventListener('pagehide', closeGateway);
  }, [gateway]);

  const { handleKeyDown, handleMove, handleAttack } = useKeyboardControls(
    game,
    sendMove,
    sendAttack,
  );

  const { viewportTiles, tileScale, camera } = useViewport({
    width,
    height,
    isMobile,
    zoomedOut,
    playerX: game.player.x,
    playerY: game.player.y,
  });
  const { toasts, tooltip, removeToast, clearTooltip } = useEventNotifications(
    events,
    true,
  );
  const { damageEvents, removeDamageEvent } = useDamageEvents(
    events,
    game.player.x,
    game.player.y,
  );
  const { projectiles, removeProjectile } = useProjectileEvents(
    events,
    game.player.x,
    game.player.y,
    game.player.facingDirection,
  );
  const isScreenShaking = useScreenShake(damagedEntities.includes('player'));

  useEffect(() => {
    if (lifecycle.kind !== 'dead' && lifecycle.kind !== 'won') return;
    if (terminalRevisionRef.current === lifecycle.revision) return;
    terminalRevisionRef.current = lifecycle.revision;
    onGameEnd(game, lifecycle.kind === 'won');
  }, [game, lifecycle, onGameEnd]);

  useEffect(() => {
    if (
      lifecycle.kind !== 'session-invalid' ||
      sessionInvalidHandledRef.current
    ) {
      return;
    }
    sessionInvalidHandledRef.current = true;
    onSessionInvalid(lifecycle.message);
  }, [lifecycle, onSessionInvalid]);

  useEffect(() => {
    if (lifecycle.kind !== 'abandoned' || abandonedHandledRef.current) return;
    abandonedHandledRef.current = true;
    onAbandoned();
  }, [lifecycle, onAbandoned]);

  useEffect(() => {
    if (inputAllowed) gameContainerRef.current?.focus();
  }, [inputAllowed]);

  const retryAbandon = (): void => {
    void gateway.retryAbandon().catch(() => {});
  };

  return (
    <div
      ref={gameContainerRef}
      role="application"
      aria-label="Dungeon Crawler game"
      onKeyDown={inputAllowed ? handleKeyDown : undefined}
      tabIndex={-1}
      className="fixed inset-0 w-screen h-screen md:py-2.5 flex flex-col bg-primary select-none touch-none focus:outline-none"
    >
      <div className="shrink-0 z-50 relative">
        <Header
          zoomedOut={zoomedOut}
          onToggleZoom={() => setZoomedOut((current) => !current)}
          onRestart={() => setShowRestartConfirm(true)}
        />
      </div>

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

      {(lifecycle.kind === 'conflict-resynchronized' ||
        lifecycle.kind === 'command-failed') && (
        <output className="text-center text-sm text-gold py-1">
          {lifecycle.message}
        </output>
      )}
      {localNotice && (
        <output className="text-center text-sm text-gold py-1">
          {localNotice}
        </output>
      )}
      {(gatewaySnapshot.transportState === 'connecting' ||
        gatewaySnapshot.transportState === 'authenticating' ||
        gatewaySnapshot.transportState === 'reconnecting') && (
        <output className="text-center text-xs text-gray-400 py-1">
          Reconnecting game stream...
        </output>
      )}
      {gatewaySnapshot.transportState === 'degraded-http-fallback' && (
        <output className="text-center text-xs text-gold py-1">
          Using slower HTTP fallback
        </output>
      )}

      <div
        className={cn(
          'flex-1 md:h-[70vh] md:flex-initial overflow-hidden relative',
          isScreenShaking && 'screen-shake',
        )}
      >
        <div className="w-full h-full flex items-center justify-center">
          <GameCanvas
            gameModel={model}
            assets={AssetManager}
            viewportTiles={viewportTiles}
            tileScale={tileScale}
            damagedEntities={damagedEntities}
          />

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

          {lifecycle.kind === 'retry-required' && (
            <ActionRequestOverlay
              error={lifecycle.message}
              retryAt={lifecycle.retryAt}
              onRetry={retryAction}
            />
          )}

          {lifecycle.kind === 'protocol-mismatch' && (
            <div
              role="alert"
              className="absolute inset-0 bg-dark/90 flex flex-col items-center justify-center z-40 text-center"
            >
              <p className="text-accent">Reload required</p>
              <p className="text-gray-400 mt-2">{lifecycle.message}</p>
              <button
                type="button"
                className="mt-4"
                onClick={() => window.location.reload()}
              >
                Reload Game
              </button>
            </div>
          )}

          {(lifecycle.kind === 'abandoning' ||
            lifecycle.kind === 'abandon-failed') && (
            <div
              role={lifecycle.kind === 'abandon-failed' ? 'alert' : 'status'}
              className="absolute inset-0 bg-dark/90 flex flex-col items-center justify-center z-40 text-center"
            >
              <p className="text-gold">
                {lifecycle.kind === 'abandoning'
                  ? 'Abandoning game...'
                  : 'Abandonment failed'}
              </p>
              {lifecycle.kind === 'abandon-failed' && (
                <>
                  <p className="text-accent text-sm mt-2">
                    {lifecycle.message}
                  </p>
                  <button type="button" className="mt-4" onClick={retryAbandon}>
                    Retry Abandon
                  </button>
                </>
              )}
            </div>
          )}

          <ToastContainer toasts={toasts} onRemove={removeToast} />
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

      <DPad
        onMove={handleMove}
        onAttack={handleAttack}
        disabled={!inputAllowed}
        projectileConfig={getProjectileConfig(game.player.character)}
      />

      <div className="md:hidden fixed top-12 left-0 right-0 z-40 pointer-events-none">
        <div className="pointer-events-auto">
          <HUD gameState={game} events={events} compact />
        </div>
        <div className="pointer-events-auto bg-dark/70 backdrop-blur-sm">
          <ActionLog events={events} maxEvents={3} />
        </div>
      </div>

      <div className="hidden md:block px-4 pb-4 w-full max-w-4xl mx-auto shrink-0">
        <HUD gameState={game} events={events} />
      </div>

      {showRestartConfirm && (
        <ConfirmModal
          message="Are you sure you want to restart? All progress will be lost."
          onConfirm={() => {
            setShowRestartConfirm(false);
            setLocalNotice(null);
            void gateway.abandonGame().catch((error: unknown) => {
              if (gateway.getSnapshot().lifecycle.kind === 'abandon-failed') {
                return;
              }
              setLocalNotice(
                error instanceof Error
                  ? error.message
                  : 'The game could not be abandoned yet.',
              );
            });
          }}
          onCancel={() => setShowRestartConfirm(false)}
        />
      )}
    </div>
  );
}
