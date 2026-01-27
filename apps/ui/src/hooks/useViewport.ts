import {
  type Coordinate,
  MAP_HEIGHT,
  MAP_WIDTH,
} from '@dungeon-crawler/shared';
import { TILE_SIZE } from '@/sprites';

const MOBILE_HEADER_HEIGHT = 60;
const DESKTOP_VIEWPORT_RATIO = 0.7;
const ZOOMED_OUT_TILES = 13;
const ZOOMED_IN_TILES = 7;

interface ViewportParams {
  width: number;
  height: number;
  isMobile: boolean;
  zoomedOut: boolean;
  playerX?: number;
  playerY?: number;
}

export function useViewport({
  width,
  height,
  isMobile,
  zoomedOut,
  playerX,
  playerY,
}: ViewportParams) {
  // Calculate container dimensions
  const containerHeight = isMobile
    ? height - MOBILE_HEADER_HEIGHT
    : height * DESKTOP_VIEWPORT_RATIO;
  const containerWidth = width;

  // Calculate tile scaling
  const targetTilesY = zoomedOut
    ? Math.min(ZOOMED_OUT_TILES, MAP_HEIGHT)
    : ZOOMED_IN_TILES;
  const tileScale = containerHeight / (targetTilesY * TILE_SIZE);
  const tilesX = Math.ceil(containerWidth / (TILE_SIZE * tileScale));

  const viewportTiles: Coordinate = {
    x: Math.min(tilesX, MAP_WIDTH),
    y: Math.min(targetTilesY, MAP_HEIGHT),
  };

  // Calculate camera position (centered on player, clamped to map bounds)
  const camera: Coordinate =
    playerX === undefined || playerY === undefined
      ? { x: 0, y: 0 }
      : {
          x: Math.max(
            0,
            Math.min(
              playerX - Math.floor(viewportTiles.x / 2),
              MAP_WIDTH - viewportTiles.x,
            ),
          ),
          y: Math.max(
            0,
            Math.min(
              playerY - Math.floor(viewportTiles.y / 2),
              MAP_HEIGHT - viewportTiles.y,
            ),
          ),
        };

  return {
    viewportTiles,
    tileScale,
    camera,
  };
}
