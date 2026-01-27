// GameCanvas - React wrapper for canvas rendering

import type { Coordinate } from '@dungeon-crawler/shared';
import { useEffect, useRef } from 'react';
import type { AssetManagerClass } from '@/engine/AssetManager';
import type { GameState } from '@/engine/GameState';
import { Renderer } from '@/engine/Renderer';
import { TILE_SIZE } from '@/sprites';

interface GameCanvasProps {
  gameState: GameState;
  assets: AssetManagerClass;
  viewportTiles: Coordinate;
  tileScale: number;
  damagedEntities: string[];
}

export function GameCanvas({
  gameState,
  assets,
  viewportTiles,
  tileScale,
  damagedEntities,
}: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<Renderer | null>(null);

  // Store singletons in refs to avoid effect re-runs
  const gameStateRef = useRef(gameState);
  const assetsRef = useRef(assets);

  // Keep refs updated
  gameStateRef.current = gameState;
  assetsRef.current = assets;

  // Initialize renderer ONCE on mount
  useEffect(() => {
    if (!canvasRef.current || !assetsRef.current.isLoaded()) {
      return;
    }

    const renderer = new Renderer(
      canvasRef.current,
      assetsRef.current,
      gameStateRef.current,
    );
    renderer.start();
    rendererRef.current = renderer;

    return () => {
      renderer.stop();
      rendererRef.current = null;
    };
  }, []);

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
    <canvas
      ref={canvasRef}
      width={canvasWidth}
      height={canvasHeight}
      className="bg-dark border-2 border-gray-700 [image-rendering:pixelated]"
      style={{
        width: displayWidth,
        height: displayHeight,
      }}
    />
  );
}
