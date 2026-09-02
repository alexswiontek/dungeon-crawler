import { randomUUID } from 'node:crypto';
import {
  attackAtRange,
  type CharacterType,
  createGame,
  createSeededRandom,
  type Direction,
  descendFloor,
  type Enemy,
  findPathToTarget,
  type GameCommandContext,
  type GameEvent,
  type GameState,
  hasLineOfSight,
  type Item,
  movePlayer,
  recalculateVisibility,
  type Tile,
} from '@dungeon-crawler/domain';
import {
  diffClientProjections,
  type GameDelta,
  projectGameState,
  type VisibleGameState,
} from '@dungeon-crawler/protocol';

interface MoveResult {
  events: GameEvent[];
  deltas: GameDelta[];
}

function createSystemContext(): GameCommandContext {
  return {
    clock: { now: () => new Date() },
    random: createSeededRandom(randomUUID()),
  };
}

export function createNewGame(
  playerName: string,
  playerId: string,
  character: CharacterType = 'dwarf',
): GameState {
  return createGame(
    { gameId: randomUUID(), playerId, playerName, character },
    createSystemContext(),
  );
}

export function updateFog(state: GameState): void {
  recalculateVisibility(state);
}

export function processMove(
  state: GameState,
  direction: Direction,
): GameEvent[] {
  return movePlayer(state, direction, createSystemContext()).events;
}

export function processAttack(state: GameState): GameEvent[] {
  return attackAtRange(state, createSystemContext()).events;
}

export function descendStairs(state: GameState): GameEvent[] {
  return descendFloor(state, createSystemContext()).events;
}

export function getVisibleEnemies(state: GameState): Enemy[] {
  return state.enemies.filter(
    (enemy) => enemy.hp > 0 && state.visibleNow[enemy.y]?.[enemy.x] === true,
  );
}

export function getVisibleItems(state: GameState): Item[] {
  return state.items.filter(
    (item) => state.visibleNow[item.y]?.[item.x] === true,
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

export function processMoveWithDeltas(
  state: GameState,
  direction: Direction,
): MoveResult {
  const before = projectGameState(state);
  const { events } = movePlayer(state, direction, createSystemContext());
  const after = projectGameState(state);
  return { events, deltas: diffClientProjections(before, after, events) };
}

export function processAttackWithDeltas(state: GameState): MoveResult {
  const before = projectGameState(state);
  const { events } = attackAtRange(state, createSystemContext());
  const after = projectGameState(state);
  return { events, deltas: diffClientProjections(before, after, events) };
}

export { findPathToTarget, hasLineOfSight };
