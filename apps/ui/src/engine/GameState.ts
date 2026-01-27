// GameState - Mutable state buffer for canvas rendering
// This class is NOT React state - it's mutated directly by WebSocket updates
// and read by the RAF render loop without causing React re-renders.

import type {
  CharacterType,
  Enemy,
  Equipment,
  FacingDirection,
  GameDelta,
  GameStatus,
  Item,
  Tile,
  VisibleGameState,
} from '@dungeon-crawler/shared';
import { MAP_HEIGHT, MAP_WIDTH } from '@dungeon-crawler/shared';

export interface PlayerState {
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
}

/**
 * Mutable game state buffer for canvas rendering.
 *
 * Key differences from Zustand store:
 * - Mutations happen in-place (no immutable spreads)
 * - No React subscriptions or re-renders
 * - Read directly by RAF render loop
 */
export class GameState {
  _id = '';
  playerName = '';
  floor = 1;
  player: PlayerState | null = null;
  map: (Tile | null)[][] = [];
  enemies = new Map<string, Enemy>();
  items = new Map<string, Item>();
  fog: boolean[][] = [];
  status: GameStatus = 'active';
  score = 0;

  // Version counter - incremented on each mutation for change detection
  version = 0;

  constructor() {
    this.map = this.createEmptyMap();
    this.fog = this.createEmptyFog();
  }

  private createEmptyMap(): (Tile | null)[][] {
    return Array.from({ length: MAP_HEIGHT }, () =>
      Array.from({ length: MAP_WIDTH }, () => null),
    );
  }

  private createEmptyFog(): boolean[][] {
    return Array.from({ length: MAP_HEIGHT }, () =>
      Array.from({ length: MAP_WIDTH }, () => false),
    );
  }

  /**
   * Initialize state from server's visible game state.
   * Used on initial load and reconnection.
   */
  initFromVisible(visible: VisibleGameState): void {
    this._id = visible._id;
    this.playerName = visible.playerName;
    this.floor = visible.floor;
    this.player = { ...visible.player };
    this.status = visible.status;
    this.score = visible.score;

    // Reset and populate map
    this.map = this.createEmptyMap();
    for (const tile of visible.visibleTiles) {
      this.map[tile.y][tile.x] = tile;
    }

    // Populate enemies
    this.enemies.clear();
    for (const enemy of visible.visibleEnemies) {
      this.enemies.set(enemy.id, enemy);
    }

    // Populate items
    this.items.clear();
    for (const item of visible.visibleItems) {
      this.items.set(item.id, item);
    }

    // Copy fog
    this.fog = visible.fog.map((row) => [...row]);

    this.version++;
  }

  /**
   * Apply a single delta mutation in place.
   */
  applyDelta(delta: GameDelta): void {
    switch (delta.type) {
      case 'player_pos':
        if (this.player) {
          this.player.x = delta.x;
          this.player.y = delta.y;
          this.player.facingDirection = delta.facingDirection;
        }
        break;

      case 'player_stats':
        if (this.player) {
          if (delta.hp !== undefined) this.player.hp = delta.hp;
          if (delta.maxHp !== undefined) this.player.maxHp = delta.maxHp;
          if (delta.attack !== undefined) this.player.attack = delta.attack;
          if (delta.defense !== undefined) this.player.defense = delta.defense;
          if (delta.xp !== undefined) this.player.xp = delta.xp;
          if (delta.level !== undefined) this.player.level = delta.level;
          if (delta.xpToNextLevel !== undefined) {
            this.player.xpToNextLevel = delta.xpToNextLevel;
          }
        }
        break;

      case 'score':
        this.score = delta.score;
        break;

      case 'player_equipment':
        if (this.player) {
          this.player.equipment = delta.equipment;
        }
        break;

      case 'floor':
        this.floor = delta.floor;
        break;

      case 'enemy_visible':
        this.enemies.set(delta.enemy.id, delta.enemy);
        break;

      case 'enemy_moved': {
        const enemy = this.enemies.get(delta.enemyId);
        if (enemy) {
          enemy.x = delta.x;
          enemy.y = delta.y;
        }
        break;
      }

      case 'enemy_damaged': {
        const enemy = this.enemies.get(delta.enemyId);
        if (enemy) {
          enemy.hp = delta.hp;
        }
        break;
      }

      case 'enemy_killed':
      case 'enemy_hidden':
        this.enemies.delete(delta.enemyId);
        break;

      case 'item_visible':
        this.items.set(delta.item.id, delta.item);
        break;

      case 'item_removed':
        this.items.delete(delta.itemId);
        break;

      case 'fog_reveal':
        for (const [x, y] of delta.cells) {
          if (
            y >= 0 &&
            y < this.fog.length &&
            x >= 0 &&
            x < this.fog[0].length
          ) {
            this.fog[y][x] = true;
          }
        }
        break;

      case 'tiles_reveal':
        for (const tile of delta.tiles) {
          this.map[tile.y][tile.x] = tile;
        }
        break;

      case 'game_status':
        this.status = delta.status;
        break;

      case 'event':
        // Events are handled separately, not in game state
        break;

      case 'new_floor':
        // Full reset for new floor
        this.initFromVisible(delta.visibleState);
        break;
    }

    this.version++;
  }

  /**
   * Apply multiple deltas in sequence.
   */
  applyDeltas(deltas: GameDelta[]): void {
    for (const delta of deltas) {
      this.applyDelta(delta);
    }
  }

  /**
   * Reset to initial empty state.
   */
  reset(): void {
    this._id = '';
    this.playerName = '';
    this.floor = 1;
    this.player = null;
    this.map = this.createEmptyMap();
    this.enemies.clear();
    this.items.clear();
    this.fog = this.createEmptyFog();
    this.status = 'active';
    this.score = 0;
    this.version++;
  }
}
