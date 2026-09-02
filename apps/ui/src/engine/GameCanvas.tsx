// GameCanvas - React wrapper for canvas rendering

import type { Coordinate } from '@dungeon-crawler/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AssetManagerClass } from '@/engine/AssetManager';
import { Renderer } from '@/engine/Renderer';
import type { GameClientModel } from '@/game/GameClientModel';
import { TILE_SIZE } from '@/sprites';

interface GameCanvasProps {
  gameModel: GameClientModel;
  assets: AssetManagerClass;
  viewportTiles: Coordinate;
  tileScale: number;
  damagedEntities: string[];
}

export function GameCanvas({
  gameModel,
  assets,
  viewportTiles,
  tileScale,
  damagedEntities,
}: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const [assetStatus, setAssetStatus] = useState<'loading' | 'ready' | 'error'>(
    'loading',
  );
  const mountedRef = useRef(false);

  // Store singletons in refs to avoid effect re-runs
  const gameModelRef = useRef(gameModel);
  const assetsRef = useRef(assets);
  const viewportTilesRef = useRef(viewportTiles);
  const tileScaleRef = useRef(tileScale);
  const damagedEntitiesRef = useRef(damagedEntities);

  // Keep refs updated
  gameModelRef.current = gameModel;
  assetsRef.current = assets;
  viewportTilesRef.current = viewportTiles;
  tileScaleRef.current = tileScale;
  damagedEntitiesRef.current = damagedEntities;

  const initializeRenderer = useCallback(async (): Promise<void> => {
    setAssetStatus('loading');
    try {
      await assetsRef.current.loadAll();
      if (!mountedRef.current || !canvasRef.current) return;
      const renderer = new Renderer(
        canvasRef.current,
        assetsRef.current,
        gameModelRef.current,
      );
      renderer.setViewport(viewportTilesRef.current, tileScaleRef.current);
      renderer.setDamagedEntities(damagedEntitiesRef.current);
      renderer.start();
      rendererRef.current = renderer;
      setAssetStatus('ready');
    } catch {
      if (mountedRef.current) setAssetStatus('error');
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    void initializeRenderer();

    return () => {
      mountedRef.current = false;
      rendererRef.current?.stop();
      rendererRef.current = null;
    };
  }, [initializeRenderer]);

  // Update viewport config when it changes
  useEffect(() => {
    rendererRef.current?.setViewport(viewportTiles, tileScale);
  }, [viewportTiles, tileScale]);

  // Update damaged entities imperatively (Renderer reads on each frame)
  if (rendererRef.current) {
    rendererRef.current.setDamagedEntities(damagedEntities);
  }

  // Canvas dimensions - internal resolution (not scaled)
  const canvasWidth = viewportTiles.x * TILE_SIZE;
  const canvasHeight = viewportTiles.y * TILE_SIZE;

  // Display dimensions - scaled for screen
  const displayWidth = canvasWidth * tileScale;
  const displayHeight = canvasHeight * tileScale;

  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        width={canvasWidth}
        height={canvasHeight}
        aria-busy={assetStatus === 'loading'}
        className="block bg-dark border-2 border-gray-700 [image-rendering:pixelated]"
        style={{
          width: displayWidth,
          height: displayHeight,
        }}
      />
      {assetStatus === 'loading' && (
        <output className="absolute inset-0 flex items-center justify-center bg-dark text-gray-400">
          Loading sprites...
        </output>
      )}
      {assetStatus === 'error' && (
        <div
          role="alert"
          className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-dark text-center"
        >
          <p className="text-accent">Game artwork failed to load.</p>
          <button type="button" onClick={() => void initializeRenderer()}>
            Retry Assets
          </button>
        </div>
      )}
    </div>
  );
}
