import type {
  CharacterType,
  Enemy,
  Equipment,
  FacingDirection,
  GameEvent,
  GameStatus,
  Item,
  Tile,
} from '@dungeon-crawler/domain';
import { MAP_HEIGHT, MAP_WIDTH } from '@dungeon-crawler/domain';
import type { GameDelta, VisibleGameState } from '@dungeon-crawler/protocol';
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

// Local state that the frontend maintains
export interface LocalGameState {
  _id: string;
  revision: number;
  playerName: string;
  floor: number;
  player: {
    x: number;
    y: number;
    hp: number;
    maxHp: number;
    attack: number;
    defense: number;
    inventory: Item[];
    xp: number;
    level: number;
    xpToNextLevel: number;
    equipment: {
      weapon: Equipment | null;
      shield: Equipment | null;
      armor: Equipment | null;
      ranged: Equipment | null;
    };
    character: CharacterType;
    facingDirection: FacingDirection;
  };
  map: (Tile | null)[][];
  enemies: Map<string, Enemy>;
  items: Map<string, Item>;
  explored: boolean[][];
  visibleNow: boolean[][];
  status: GameStatus;
  score: number;
}

// Initialize empty map
function createEmptyMap(): (Tile | null)[][] {
  return Array.from({ length: MAP_HEIGHT }, () =>
    Array.from({ length: MAP_WIDTH }, () => null),
  );
}

// Convert VisibleGameState to LocalGameState
function initializeFromVisible(visible: VisibleGameState): LocalGameState {
  const map = createEmptyMap();
  const enemies = new Map<string, Enemy>();
  const items = new Map<string, Item>();

  // Populate map from visible tiles
  for (const tile of visible.visibleTiles) {
    map[tile.y][tile.x] = tile;
  }

  // Populate enemies
  for (const enemy of visible.visibleEnemies) {
    enemies.set(enemy.id, enemy);
  }

  // Populate items
  for (const item of visible.visibleItems) {
    items.set(item.id, item);
  }

  return {
    _id: visible._id,
    revision: visible.revision,
    playerName: visible.playerName,
    floor: visible.floor,
    player: visible.player,
    map,
    enemies,
    items,
    explored: visible.explored,
    visibleNow: visible.visibleNow,
    status: visible.status,
    score: visible.score,
  };
}

// Apply a single delta to state (returns new state)
function applyDelta(state: LocalGameState, delta: GameDelta): LocalGameState {
  switch (delta.type) {
    case 'player_pos':
      return {
        ...state,
        player: {
          ...state.player,
          x: delta.x,
          y: delta.y,
          facingDirection: delta.facingDirection,
        },
      };

    case 'player_stats':
      return {
        ...state,
        player: {
          ...state.player,
          ...(delta.hp !== undefined && { hp: delta.hp }),
          ...(delta.maxHp !== undefined && { maxHp: delta.maxHp }),
          ...(delta.attack !== undefined && { attack: delta.attack }),
          ...(delta.defense !== undefined && { defense: delta.defense }),
          ...(delta.xp !== undefined && { xp: delta.xp }),
          ...(delta.level !== undefined && { level: delta.level }),
          ...(delta.xpToNextLevel !== undefined && {
            xpToNextLevel: delta.xpToNextLevel,
          }),
        },
      };

    case 'score':
      return { ...state, score: delta.score };

    case 'player_equipment':
      return {
        ...state,
        player: {
          ...state.player,
          equipment: delta.equipment,
        },
      };

    case 'floor':
      return { ...state, floor: delta.floor };

    case 'enemy_visible': {
      const newEnemies = new Map(state.enemies);
      newEnemies.set(delta.enemy.id, delta.enemy);
      return { ...state, enemies: newEnemies };
    }

    case 'enemy_moved': {
      const newEnemies = new Map(state.enemies);
      const enemy = newEnemies.get(delta.enemyId);
      if (enemy) {
        newEnemies.set(delta.enemyId, { ...enemy, x: delta.x, y: delta.y });
      }
      return { ...state, enemies: newEnemies };
    }

    case 'enemy_damaged': {
      const newEnemies = new Map(state.enemies);
      const enemy = newEnemies.get(delta.enemyId);
      if (enemy) {
        newEnemies.set(delta.enemyId, { ...enemy, hp: delta.hp });
      }
      return { ...state, enemies: newEnemies };
    }

    case 'enemy_killed':
    case 'enemy_hidden': {
      const newEnemies = new Map(state.enemies);
      newEnemies.delete(delta.enemyId);
      return { ...state, enemies: newEnemies };
    }

    case 'item_visible': {
      const newItems = new Map(state.items);
      newItems.set(delta.item.id, delta.item);
      return { ...state, items: newItems };
    }

    case 'item_removed': {
      const newItems = new Map(state.items);
      newItems.delete(delta.itemId);
      return { ...state, items: newItems };
    }

    case 'fog_reveal': {
      const explored = state.explored.map((row) => [...row]);
      for (const [x, y] of delta.cells) {
        if (y >= 0 && y < explored.length && x >= 0 && x < explored[0].length) {
          explored[y][x] = true;
        }
      }
      return { ...state, explored };
    }

    case 'visibility':
      return {
        ...state,
        visibleNow: delta.visibleNow.map((row) => [...row]),
      };

    case 'tiles_reveal': {
      const newMap = state.map.map((row) => [...row]);
      for (const tile of delta.tiles) {
        newMap[tile.y][tile.x] = tile;
      }
      return { ...state, map: newMap };
    }

    case 'game_status':
      return { ...state, status: delta.status };

    case 'event':
      // Events are handled separately, not in state
      return state;

    case 'new_floor':
      // Full reset for new floor
      return initializeFromVisible(delta.visibleState);

    default:
      return state;
  }
}

interface GameStore {
  // Core game state
  state: LocalGameState | null;
  events: GameEvent[];

  error: string | null;

  // UI state - use array instead of Set to avoid reference equality issues
  damagedEntities: string[];

  // Actions
  initState: (visible: VisibleGameState) => void;
  applyDeltas: (deltas: GameDelta[]) => void;
  addEvents: (newEvents: GameEvent[]) => void;
  setError: (error: string | null) => void;
  setDamagedEntities: (entities: string[]) => void;
  reset: () => void;
}

export const useGameStore = create<GameStore>()(
  immer((set, get) => ({
    // Initial state
    state: null,
    events: [],
    error: null,
    damagedEntities: [],

    // Actions
    initState: (visible: VisibleGameState): void => {
      set({ state: initializeFromVisible(visible) });
    },

    applyDeltas: (deltas: GameDelta[]): void => {
      const currentState = get().state;
      if (!currentState) return;

      let newState = currentState;
      for (const delta of deltas) {
        newState = applyDelta(newState, delta);
      }
      set({ state: newState });
    },

    addEvents: (newEvents: GameEvent[]): void => {
      set((s) => ({
        events: [...newEvents, ...s.events].slice(0, 30),
      }));
    },

    setError: (error: string | null): void => set({ error }),
    setDamagedEntities: (damagedEntities: string[]): void =>
      set({ damagedEntities }),

    reset: (): void =>
      set({
        state: null,
        events: [],
        error: null,
        damagedEntities: [],
      }),
  })),
);

// Export reducers for focused state tests and narrow adapters.
export { applyDelta, initializeFromVisible };
