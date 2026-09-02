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
  const initializationRef = useRef(0);
  const configRef = useRef({ viewportTiles, tileScale, damagedEntities });

  const initializeRenderer = useCallback(async (): Promise<void> => {
    const initialization = ++initializationRef.current;
    let renderer: Renderer | null = null;
    rendererRef.current?.stop();
    rendererRef.current = null;
    setAssetStatus('loading');
    try {
      await assets.loadAll();
      if (
        !mountedRef.current ||
        initialization !== initializationRef.current ||
        !canvasRef.current
      ) {
        return;
      }
      renderer = new Renderer(canvasRef.current, assets, gameModel);
      const config = configRef.current;
      renderer.setViewport(config.viewportTiles, config.tileScale);
      renderer.setDamagedEntities(config.damagedEntities);
      rendererRef.current = renderer;
      await renderer.start();
      if (
        !mountedRef.current ||
        initialization !== initializationRef.current ||
        rendererRef.current !== renderer
      ) {
        renderer.stop();
        return;
      }
      setAssetStatus('ready');
    } catch {
      renderer?.stop();
      if (rendererRef.current === renderer) rendererRef.current = null;
      if (mountedRef.current && initialization === initializationRef.current) {
        setAssetStatus('error');
      }
    }
  }, [assets, gameModel]);

  useEffect(() => {
    mountedRef.current = true;

    void initializeRenderer();

    return () => {
      mountedRef.current = false;
      initializationRef.current += 1;
      rendererRef.current?.stop();
      rendererRef.current = null;
    };
  }, [initializeRenderer]);

  // Update viewport config when it changes
  useEffect(() => {
    configRef.current = {
      ...configRef.current,
      viewportTiles,
      tileScale,
    };
    rendererRef.current?.setViewport(viewportTiles, tileScale);
  }, [viewportTiles, tileScale]);

  useEffect(() => {
    configRef.current = { ...configRef.current, damagedEntities };
    rendererRef.current?.setDamagedEntities(damagedEntities);
  }, [damagedEntities]);

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
