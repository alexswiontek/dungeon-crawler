import {
  type Enemy,
  type GameStatus,
  type Item,
  MAP_HEIGHT,
  MAP_WIDTH,
  type Tile,
} from '@dungeon-crawler/domain/model';
import type { VisibleGameState } from '@dungeon-crawler/protocol/schemas';

export interface GameClientSnapshot {
  readonly id: string;
  readonly revision: number;
  readonly version: number;
  readonly playerName: string;
  readonly floor: number;
  readonly player: VisibleGameState['player'];
  readonly map: readonly (readonly (Tile | null)[])[];
  readonly enemies: ReadonlyMap<string, Enemy>;
  readonly items: ReadonlyMap<string, Item>;
  readonly explored: readonly (readonly boolean[])[];
  readonly visibleNow: readonly (readonly boolean[])[];
  readonly status: GameStatus;
  readonly score: number;
}

type ModelListener = () => void;

function materialize(
  state: VisibleGameState,
  version: number,
): GameClientSnapshot {
  const map: (Tile | null)[][] = Array.from({ length: MAP_HEIGHT }, () =>
    Array.from({ length: MAP_WIDTH }, () => null),
  );
  for (const tile of state.visibleTiles) map[tile.y][tile.x] = tile;

  return {
    id: state._id,
    revision: state.revision,
    version,
    playerName: state.playerName,
    floor: state.floor,
    player: state.player,
    map,
    enemies: new Map(state.visibleEnemies.map((enemy) => [enemy.id, enemy])),
    items: new Map(state.visibleItems.map((item) => [item.id, item])),
    explored: state.explored.map((row) => [...row]),
    visibleNow: state.visibleNow.map((row) => [...row]),
    status: state.status,
    score: state.score,
  };
}

export class GameClientModel {
  private snapshot: GameClientSnapshot;
  private readonly listeners = new Set<ModelListener>();

  constructor(state: VisibleGameState) {
    this.snapshot = materialize(state, 0);
  }

  readonly getSnapshot = (): GameClientSnapshot => this.snapshot;

  readonly subscribe = (listener: ModelListener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  replace(state: VisibleGameState): void {
    this.snapshot = materialize(state, this.snapshot.version + 1);
    for (const listener of this.listeners) listener();
  }
}
