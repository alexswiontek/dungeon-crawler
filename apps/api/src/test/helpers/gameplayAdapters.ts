import { randomUUID } from 'node:crypto';
import {
  attackAtRange,
  type CharacterType,
  createSeededRandom,
  createVisibilityMask,
  type Direction,
  descendFloor,
  type Enemy,
  type GameCommandContext,
  type GameEvent,
  type GameState,
  generateDungeon,
  type Item,
  movePlayer,
  type Tile,
} from '@dungeon-crawler/domain';
import {
  diffClientProjections,
  type GameDelta,
  projectGameState,
  type VisibleGameState,
} from '@dungeon-crawler/protocol';

function context(): GameCommandContext {
  return {
    clock: { now: () => new Date() },
    random: createSeededRandom(randomUUID()),
  };
}

export function processMove(
  state: GameState,
  direction: Direction,
): GameEvent[] {
  return movePlayer(state, direction, context()).events;
}

export function processAttack(state: GameState): GameEvent[] {
  return attackAtRange(state, context()).events;
}

export function descendStairs(state: GameState): GameEvent[] {
  return descendFloor(state, context()).events;
}

export function getVisibleEnemies(state: GameState): Enemy[] {
  return state.enemies.filter(
    (enemy) => enemy.hp > 0 && state.visibleNow[enemy.y]?.[enemy.x] === true,
  );
}

export function getVisibleItems(state: GameState): Item[] {
  return state.items.filter(
    (item) => state.explored[item.y]?.[item.x] === true,
  );
}

export function getVisibleTiles(state: GameState): Tile[] {
  return state.map.flatMap((row, y) =>
    row.filter((_tile, x) => state.explored[y]?.[x] === true),
  );
}

export function getVisibleState(state: GameState): VisibleGameState {
  return projectGameState(state);
}

export function processAttackWithDeltas(state: GameState): {
  events: GameEvent[];
  deltas: GameDelta[];
} {
  const before = projectGameState(state);
  const { events } = attackAtRange(state, context());
  return {
    events,
    deltas: diffClientProjections(before, projectGameState(state), events),
  };
}

export function generateMap(floor: number, character: CharacterType = 'dwarf') {
  return generateDungeon(floor, character, createSeededRandom(randomUUID()));
}

export function initializeFog(): boolean[][] {
  return createVisibilityMask();
}
