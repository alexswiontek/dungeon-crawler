import { type Coordinate, type GameState, VISION_RADIUS } from './model.js';

export function hasLineOfSight(
  state: GameState,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): boolean {
  if (x1 === x2 && y1 === y2) return true;

  const dx = Math.abs(x2 - x1);
  const dy = Math.abs(y2 - y1);
  const sx = x1 < x2 ? 1 : -1;
  const sy = y1 < y2 ? 1 : -1;
  let error = dx - dy;
  let x = x1;
  let y = y1;
  const maxIterations = state.map.length + (state.map[0]?.length ?? 0);

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    if (x === x2 && y === y2) return true;

    const doubled = 2 * error;
    if (doubled > -dy) {
      error -= dy;
      x += sx;
    }
    if (doubled < dx) {
      error += dx;
      y += sy;
    }

    if (x === x2 && y === y2) return true;
    if (state.map[y]?.[x]?.type === 'wall') return false;
  }

  return false;
}

export function recalculateVisibility(state: GameState): void {
  const width = state.map[0]?.length ?? 0;
  const height = state.map.length;
  const visibleNow = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => false),
  );
  const { x: playerX, y: playerY } = state.player;

  for (let dy = -VISION_RADIUS; dy <= VISION_RADIUS; dy++) {
    for (let dx = -VISION_RADIUS; dx <= VISION_RADIUS; dx++) {
      const x = playerX + dx;
      const y = playerY + dy;
      if (x < 0 || x >= width || y < 0 || y >= height) continue;
      if (Math.sqrt(dx * dx + dy * dy) > VISION_RADIUS) continue;
      if (!hasLineOfSight(state, playerX, playerY, x, y)) continue;
      visibleNow[y][x] = true;
      state.explored[y][x] = true;
    }
  }

  state.visibleNow = visibleNow;
}

interface PathNode extends Coordinate {
  path: Coordinate[];
}

export function findPathToTarget(
  state: GameState,
  startX: number,
  startY: number,
  targetX: number,
  targetY: number,
  maxDistance = 20,
): Coordinate | null {
  if (startX === targetX && startY === targetY) return null;

  const visited = new Set<string>([`${startX},${startY}`]);
  const queue: PathNode[] = [{ x: startX, y: startY, path: [] }];
  const directions = [
    { x: 0, y: -1 },
    { x: 0, y: 1 },
    { x: -1, y: 0 },
    { x: 1, y: 0 },
  ];
  const maxIterations = state.map.length * (state.map[0]?.length ?? 0);

  for (
    let iteration = 0;
    queue.length > 0 && iteration < maxIterations;
    iteration++
  ) {
    const current = queue.shift();
    if (!current || current.path.length >= maxDistance) continue;

    for (const direction of directions) {
      const x = current.x + direction.x;
      const y = current.y + direction.y;
      const key = `${x},${y}`;
      if (visited.has(key)) continue;
      visited.add(key);
      if (!state.map[y]?.[x] || state.map[y][x].type === 'wall') continue;
      const occupied = state.enemies.some(
        (enemy) => enemy.hp > 0 && enemy.x === x && enemy.y === y,
      );
      const isPlayer = state.player.x === x && state.player.y === y;
      const path = [...current.path, { x, y }];
      if (x === targetX && y === targetY) return path[0] ?? null;
      if (!occupied && !isPlayer) queue.push({ x, y, path });
    }
  }
  return null;
}
