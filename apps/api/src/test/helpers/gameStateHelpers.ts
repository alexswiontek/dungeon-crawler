import { randomUUID } from 'node:crypto';
import type {
  AIBehavior,
  CharacterType,
  Enemy,
  EnemyType,
  EnemyVariant,
  Equipment,
  EquipmentSlot,
  GameState,
  Player,
  Tile,
} from '@dungeon-crawler/shared';
import {
  CHARACTER_STATS,
  ENEMY_STATS,
  EQUIPMENT_DEFINITIONS,
  getXpToNextLevel,
  MAP_HEIGHT,
  MAP_WIDTH,
  VARIANT_MULTIPLIERS,
} from '@dungeon-crawler/shared';
import { initializeFog } from '@/services/mapGenerator.js';

/**
 * Create a test game state with sensible defaults and optional overrides
 */
export function createTestGameState(overrides?: Partial<GameState>): GameState {
  const defaultPlayer = createTestPlayer();
  const defaultMap = createTestMap(MAP_WIDTH, MAP_HEIGHT);

  return {
    _id: randomUUID(),
    playerId: 'test-player-id',
    playerName: 'Test Player',
    floor: 1,
    player: defaultPlayer,
    map: defaultMap,
    enemies: [],
    items: [],
    fog: initializeFog(),
    status: 'active',
    score: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/**
 * Create a test player with sensible defaults and optional overrides
 */
export function createTestPlayer(overrides?: Partial<Player>): Player {
  const character: CharacterType = overrides?.character || 'dwarf';
  const stats = CHARACTER_STATS[character];

  return {
    x: 5,
    y: 5,
    hp: stats.hp,
    maxHp: stats.maxHp,
    attack: stats.attack,
    defense: stats.defense,
    inventory: [],
    xp: 0,
    level: 1,
    xpToNextLevel: getXpToNextLevel(1),
    equipment: {
      weapon: null,
      shield: null,
      armor: null,
      ranged: null,
    },
    character,
    facingDirection: 'left',
    ...overrides,
  };
}

/**
 * Create a test enemy with optional overrides
 */
export function createTestEnemy(
  type: EnemyType,
  overrides?: Partial<Enemy>,
): Enemy {
  const variant: EnemyVariant = overrides?.variant || 'normal';
  const mult = VARIANT_MULTIPLIERS[variant];
  const base = ENEMY_STATS[type];

  // Default behavior based on type
  let defaultBehavior: AIBehavior = 'aggressive';
  if (type === 'rat') defaultBehavior = 'flee';

  return {
    id: randomUUID(),
    type,
    variant,
    displayName: `${mult.namePrefix}${capitalize(type)}`,
    x: 10,
    y: 10,
    hp: Math.floor(base.hp * mult.hpMult),
    maxHp: Math.floor(base.hp * mult.hpMult),
    attack: Math.floor(base.attack * mult.attackMult),
    defense: Math.floor(base.defense * mult.defenseMult),
    behavior: defaultBehavior,
    ...overrides,
  };
}

/**
 * Create test equipment by slot and optional tier
 */
export function createTestEquipment(
  slot: EquipmentSlot,
  tier: number = 1,
): Equipment {
  // Find equipment matching slot and tier
  const equipment = EQUIPMENT_DEFINITIONS.find(
    (e) => e.slot === slot && e.tier === tier,
  );

  if (!equipment) {
    // Fallback: create a basic equipment item
    return {
      id: `test_${slot}`,
      slot,
      name: `Test ${capitalize(slot)}`,
      attackBonus: slot === 'weapon' ? 2 : 0,
      defenseBonus: slot === 'shield' || slot === 'armor' ? 2 : 0,
      hpBonus: slot === 'armor' ? 10 : 0,
      rangedDamageBonus: slot === 'ranged' ? 2 : 0,
      rangedRangeBonus: 0,
      tier,
    };
  }

  return { ...equipment };
}

/**
 * Create a simple test map with walls around the border and floor inside
 */
export function createTestMap(width: number, height: number): Tile[][] {
  const map: Tile[][] = [];

  for (let y = 0; y < height; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < width; x++) {
      // Walls on border, floor inside
      const isWall = x === 0 || x === width - 1 || y === 0 || y === height - 1;

      row.push({
        type: isWall ? 'wall' : 'floor',
        x,
        y,
      });
    }
    map.push(row);
  }

  return map;
}

/**
 * Create a small test map (10x10) for quick tests
 */
export function createSmallTestMap(): Tile[][] {
  return createTestMap(10, 10);
}

/**
 * Reveal fog around a specific position
 */
export function revealFogAtPosition(
  fog: boolean[][],
  x: number,
  y: number,
  radius: number = 5,
): void {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const targetX = x + dx;
      const targetY = y + dy;

      if (
        targetY >= 0 &&
        targetY < fog.length &&
        targetX >= 0 &&
        targetX < fog[0].length
      ) {
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance <= radius) {
          fog[targetY][targetX] = true;
        }
      }
    }
  }
}

// Helper: capitalize first letter
function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
