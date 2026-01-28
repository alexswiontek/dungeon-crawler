import type {
  Enemy,
  Equipment,
  FacingDirection,
  GameDelta,
  GameEvent,
  GameStatus,
  Item,
  PlayerEquipment,
  Tile,
  VisibleGameState,
} from '@dungeon-crawler/shared';
import { MAP_HEIGHT, MAP_WIDTH } from '@dungeon-crawler/shared';

/**
 * Test data builder for game store tests
 * Provides factory methods for creating mock entities and deltas
 */
class StoreHelpersBuilder {
  // Mock entities
  visibleGameState(
    overrides?: Partial<Omit<VisibleGameState, 'player'>> & {
      player?: Partial<VisibleGameState['player']>;
    },
  ): VisibleGameState {
    const defaultState: VisibleGameState = {
      _id: 'test-game-id',
      playerName: 'TestPlayer',
      floor: 1,
      player: {
        x: 5,
        y: 5,
        hp: 25,
        maxHp: 25,
        attack: 5,
        defense: 2,
        inventory: [],
        xp: 0,
        level: 1,
        xpToNextLevel: 50,
        equipment: {
          weapon: null,
          shield: null,
          armor: null,
          ranged: null,
        },
        character: 'dwarf',
        facingDirection: 'right',
      },
      visibleTiles: [
        { type: 'floor', x: 5, y: 5 },
        { type: 'wall', x: 4, y: 5 },
        { type: 'stairs', x: 6, y: 6 },
      ],
      visibleEnemies: [],
      visibleItems: [],
      fog: Array.from({ length: MAP_HEIGHT }, () =>
        Array.from({ length: MAP_WIDTH }, () => false),
      ),
      status: 'active',
      score: 0,
    };

    // Set fog to true around player position for default state
    if (!overrides?.fog) {
      for (let y = 0; y < MAP_HEIGHT; y++) {
        for (let x = 0; x < MAP_WIDTH; x++) {
          const dx = x - defaultState.player.x;
          const dy = y - defaultState.player.y;
          if (dx * dx + dy * dy <= 25) {
            // vision radius squared
            defaultState.fog[y][x] = true;
          }
        }
      }
    }

    return {
      ...defaultState,
      ...overrides,
      player: {
        ...defaultState.player,
        ...overrides?.player,
        equipment: {
          ...defaultState.player.equipment,
          ...overrides?.player?.equipment,
        },
      },
    };
  }

  enemy(overrides?: Partial<Enemy>): Enemy {
    return {
      id: 'enemy-1',
      type: 'rat',
      variant: 'normal',
      displayName: 'Rat',
      x: 10,
      y: 10,
      hp: 6,
      maxHp: 6,
      attack: 4,
      defense: 0,
      behavior: 'aggressive',
      ...overrides,
    };
  }

  item(overrides?: Partial<Item>): Item {
    return {
      id: 'item-1',
      type: 'health_potion',
      name: 'Health Potion',
      x: 8,
      y: 8,
      value: 10,
      ...overrides,
    };
  }

  equipment(overrides?: Partial<Equipment>): Equipment {
    return {
      id: 'rusty_sword',
      slot: 'weapon',
      name: 'Rusty Sword',
      attackBonus: 2,
      defenseBonus: 0,
      hpBonus: 0,
      rangedDamageBonus: 0,
      rangedRangeBonus: 0,
      tier: 1,
      ...overrides,
    };
  }

  tile(overrides?: Partial<Tile>): Tile {
    return {
      type: 'floor',
      x: 0,
      y: 0,
      ...overrides,
    };
  }

  event(overrides?: Partial<GameEvent>): GameEvent {
    return {
      id: 'test-event-id',
      type: 'player_moved',
      message: 'Test message',
      ...overrides,
    };
  }

  // Delta creators
  readonly delta = {
    playerPos: (
      x: number,
      y: number,
      facingDirection: FacingDirection = 'right',
    ): GameDelta => {
      return { type: 'player_pos', x, y, facingDirection };
    },

    playerStats: (stats: {
      hp?: number;
      maxHp?: number;
      attack?: number;
      defense?: number;
      xp?: number;
      level?: number;
      xpToNextLevel?: number;
    }): GameDelta => {
      return { type: 'player_stats', ...stats };
    },

    playerEquipment: (equipment: PlayerEquipment): GameDelta => {
      return { type: 'player_equipment', equipment };
    },

    score: (score: number): GameDelta => {
      return { type: 'score', score };
    },

    floor: (floor: number): GameDelta => {
      return { type: 'floor', floor };
    },

    enemyVisible: (enemy: Enemy): GameDelta => {
      return { type: 'enemy_visible', enemy };
    },

    enemyMoved: (enemyId: string, x: number, y: number): GameDelta => {
      return { type: 'enemy_moved', enemyId, x, y };
    },

    enemyDamaged: (enemyId: string, hp: number): GameDelta => {
      return { type: 'enemy_damaged', enemyId, hp };
    },

    enemyKilled: (enemyId: string): GameDelta => {
      return { type: 'enemy_killed', enemyId };
    },

    enemyHidden: (enemyId: string): GameDelta => {
      return { type: 'enemy_hidden', enemyId };
    },

    itemVisible: (item: Item): GameDelta => {
      return { type: 'item_visible', item };
    },

    itemRemoved: (itemId: string): GameDelta => {
      return { type: 'item_removed', itemId };
    },

    fogReveal: (cells: [number, number][]): GameDelta => {
      return { type: 'fog_reveal', cells };
    },

    tilesReveal: (tiles: Tile[]): GameDelta => {
      return { type: 'tiles_reveal', tiles };
    },

    gameStatus: (status: GameStatus): GameDelta => {
      return { type: 'game_status', status };
    },

    newFloor: (visibleState: VisibleGameState): GameDelta => {
      return { type: 'new_floor', visibleState };
    },

    event: (event: GameEvent): GameDelta => {
      return { type: 'event', event };
    },
  };
}

// Export a singleton instance
export const StoreHelpers = new StoreHelpersBuilder();
