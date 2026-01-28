import {
  MAP_HEIGHT,
  MAP_WIDTH,
  type Tile,
  type TileType,
} from '@dungeon-crawler/shared';

export function countTileType(map: Tile[][], type: TileType): number {
  let count = 0;
  for (let y = 0; y < MAP_HEIGHT; y++) {
    for (let x = 0; x < MAP_WIDTH; x++) {
      if (map[y][x].type === type) {
        count++;
      }
    }
  }
  return count;
}

export function findPath(
  map: Tile[][],
  start: { x: number; y: number },
  end: { x: number; y: number },
): boolean {
  // Simple BFS to check if path exists
  const visited = new Set<string>();
  const queue: Array<{ x: number; y: number }> = [start];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    const key = `${current.x},${current.y}`;

    if (current.x === end.x && current.y === end.y) {
      return true;
    }

    if (visited.has(key)) continue;
    visited.add(key);

    // Check 4 directions
    const directions = [
      { x: 0, y: -1 }, // up
      { x: 0, y: 1 }, // down
      { x: -1, y: 0 }, // left
      { x: 1, y: 0 }, // right
    ];

    for (const dir of directions) {
      const nx = current.x + dir.x;
      const ny = current.y + dir.y;

      if (nx >= 0 && nx < MAP_WIDTH && ny >= 0 && ny < MAP_HEIGHT) {
        const tile = map[ny][nx];
        if (tile.type !== 'wall' && !visited.has(`${nx},${ny}`)) {
          queue.push({ x: nx, y: ny });
        }
      }
    }
  }

  return false;
}

export function validateMapStructure(map: Tile[][]): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // Check dimensions
  if (map.length !== MAP_HEIGHT) {
    errors.push(`Map height is ${map.length}, expected ${MAP_HEIGHT}`);
  }

  for (let y = 0; y < map.length; y++) {
    if (map[y].length !== MAP_WIDTH) {
      errors.push(`Row ${y} width is ${map[y].length}, expected ${MAP_WIDTH}`);
    }
  }

  // Check that borders are walls
  for (let x = 0; x < MAP_WIDTH; x++) {
    if (map[0][x].type !== 'wall') {
      errors.push(`Top border at x=${x} is not a wall`);
    }
    if (map[MAP_HEIGHT - 1][x].type !== 'wall') {
      errors.push(`Bottom border at x=${x} is not a wall`);
    }
  }

  for (let y = 0; y < MAP_HEIGHT; y++) {
    if (map[y][0].type !== 'wall') {
      errors.push(`Left border at y=${y} is not a wall`);
    }
    if (map[y][MAP_WIDTH - 1].type !== 'wall') {
      errors.push(`Right border at y=${y} is not a wall`);
    }
  }

  // Check for invalid tile types
  const validTypes: TileType[] = ['floor', 'wall', 'stairs', 'door'];
  for (let y = 0; y < MAP_HEIGHT; y++) {
    for (let x = 0; x < MAP_WIDTH; x++) {
      if (!validTypes.includes(map[y][x].type)) {
        errors.push(`Invalid tile type "${map[y][x].type}" at (${x}, ${y})`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
