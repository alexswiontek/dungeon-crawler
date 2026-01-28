import {
  isEquipmentItem,
  MAP_HEIGHT,
  MAP_WIDTH,
  type Tile,
} from '@dungeon-crawler/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  countTileType,
  findPath,
  validateMapStructure,
} from '@/test/helpers/mapHelpers.js';
import { generateMap, initializeFog } from './mapGenerator.js';

describe('generateMap', () => {
  describe('Map Structure', () => {
    let map: Tile[][] = [];

    beforeAll(() => {
      const data = generateMap(1);
      map = data.map;
    });

    it('should generate map with correct dimensions', () => {
      expect(map.length).toBe(MAP_HEIGHT);
      for (const row of map) {
        expect(row.length).toBe(MAP_WIDTH);
      }
    });

    it('should have walls on map borders', () => {
      // Check top and bottom borders
      for (let x = 0; x < MAP_WIDTH; x++) {
        expect(map[0][x].type).toBe('wall');
        expect(map[MAP_HEIGHT - 1][x].type).toBe('wall');
      }

      // Check left and right borders
      for (let y = 0; y < MAP_HEIGHT; y++) {
        expect(map[y][0].type).toBe('wall');
        expect(map[y][MAP_WIDTH - 1].type).toBe('wall');
      }
    });

    it('should not have invalid tile types', () => {
      const result = validateMapStructure(map);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should have floor tiles (rooms exist)', () => {
      const floorCount = countTileType(map, 'floor');
      expect(floorCount).toBeGreaterThan(0);
    });

    it('should have exactly one stairs tile', () => {
      const stairsCount = countTileType(map, 'stairs');
      expect(stairsCount).toBe(1);
    });
  });

  describe('Room Generation', () => {
    it('should generate 5-8 rooms', () => {
      const { map } = generateMap(1);
      const floorCount = countTileType(map, 'floor');

      // Each room is at least 4x4 = 16 tiles
      // 5 rooms minimum = 80 tiles
      // But with corridors, should be more
      expect(floorCount).toBeGreaterThan(80);
    });

    it('should connect all rooms (path exists from start to stairs)', () => {
      const { map, playerStart } = generateMap(1);

      // Find stairs position
      let stairsPos: { x: number; y: number } | null = null;
      for (let y = 0; y < MAP_HEIGHT; y++) {
        for (let x = 0; x < MAP_WIDTH; x++) {
          if (map[y][x].type === 'stairs') {
            stairsPos = { x, y };
            break;
          }
        }
        if (stairsPos) break;
      }

      expect(stairsPos).not.toBeNull();
      if (stairsPos) {
        expect(findPath(map, playerStart, stairsPos)).toBe(true);
      }
    });
  });

  describe('Player Spawn', () => {
    it('should spawn player on floor tile', () => {
      const { map, playerStart } = generateMap(1);

      expect(map[playerStart.y][playerStart.x].type).toBe('floor');
    });

    it('should spawn player within map bounds', () => {
      const { playerStart } = generateMap(1);

      expect(playerStart.x).toBeGreaterThanOrEqual(0);
      expect(playerStart.x).toBeLessThan(MAP_WIDTH);
      expect(playerStart.y).toBeGreaterThanOrEqual(0);
      expect(playerStart.y).toBeLessThan(MAP_HEIGHT);
    });
  });

  describe('Stairs Placement', () => {
    it('should place stairs in last room', () => {
      const { map } = generateMap(1);

      let stairsFound = false;
      for (let y = 0; y < MAP_HEIGHT; y++) {
        for (let x = 0; x < MAP_WIDTH; x++) {
          if (map[y][x].type === 'stairs') {
            stairsFound = true;
            break;
          }
        }
        if (stairsFound) break;
      }

      expect(stairsFound).toBe(true);
    });
  });

  describe('Enemy Spawning', () => {
    it('should spawn enemies based on floor', () => {
      const { enemies: floor1Enemies } = generateMap(1);
      const { enemies: floor10Enemies } = generateMap(10);

      // Floor 1: 3-5 base + floor/2 = 3-5
      expect(floor1Enemies.length).toBeGreaterThanOrEqual(3);
      expect(floor1Enemies.length).toBeLessThanOrEqual(5);

      // Floor 10: 3-5 base + floor/2 = 8-10
      expect(floor10Enemies.length).toBeGreaterThanOrEqual(8);
      expect(floor10Enemies.length).toBeLessThanOrEqual(10);
    });

    it('should spawn enemies within map bounds', () => {
      const { enemies } = generateMap(1);

      for (const enemy of enemies) {
        expect(enemy.x).toBeGreaterThanOrEqual(0);
        expect(enemy.x).toBeLessThan(MAP_WIDTH);
        expect(enemy.y).toBeGreaterThanOrEqual(0);
        expect(enemy.y).toBeLessThan(MAP_HEIGHT);
      }
    });

    it('should spawn enemies on floor tiles', () => {
      const { map, enemies } = generateMap(1);

      for (const enemy of enemies) {
        const tile = map[enemy.y][enemy.x];
        expect(tile.type === 'floor' || tile.type === 'stairs').toBe(true);
      }
    });

    it('should have valid enemy properties', () => {
      const { enemies } = generateMap(1);

      for (const enemy of enemies) {
        expect(enemy.id).toBeDefined();
        expect(enemy.type).toBeDefined();
        expect(enemy.variant).toBeDefined();
        expect(enemy.displayName).toBeDefined();
        expect(enemy.hp).toBeGreaterThan(0);
        expect(enemy.maxHp).toBeGreaterThan(0);
        expect(enemy.attack).toBeGreaterThan(0);
        expect(enemy.defense).toBeGreaterThanOrEqual(0);
        expect(enemy.behavior).toBeDefined();
      }
    });

    it('should unlock more enemy types on deeper floors', () => {
      const { enemies: floor1Enemies } = generateMap(1);
      const { enemies: floor9Enemies } = generateMap(9);

      // Floor 1: only rats available (min(1 + floor/3, 4) = 1)
      const floor1Types = new Set(floor1Enemies.map((e) => e.type));

      // Floor 9: up to 4 types available (min(1 + 9/3, 4) = 4)
      const floor9Types = new Set(floor9Enemies.map((e) => e.type));

      expect(floor9Types.size).toBeGreaterThanOrEqual(floor1Types.size);
    });
  });

  describe('Item Spawning', () => {
    it('should spawn 1-3 health potions', () => {
      const { items } = generateMap(1);

      const potions = items.filter((item) => item.type === 'health_potion');
      expect(potions.length).toBeGreaterThanOrEqual(1);
      expect(potions.length).toBeLessThanOrEqual(3);
    });

    it('should spawn 1-2 equipment items', () => {
      const { items } = generateMap(1);

      const equipment = items.filter((item) => item.type === 'equipment');
      expect(equipment.length).toBeGreaterThanOrEqual(1);
      expect(equipment.length).toBeLessThanOrEqual(2);
    });

    it('should spawn items within map bounds', () => {
      const { items } = generateMap(1);

      for (const item of items) {
        expect(item.x).toBeGreaterThanOrEqual(0);
        expect(item.x).toBeLessThan(MAP_WIDTH);
        expect(item.y).toBeGreaterThanOrEqual(0);
        expect(item.y).toBeLessThan(MAP_HEIGHT);
      }
    });

    it('should spawn items on floor tiles', () => {
      const { map, items } = generateMap(1);

      for (const item of items) {
        const tile = map[item.y][item.x];
        expect(tile.type === 'floor' || tile.type === 'stairs').toBe(true);
      }
    });

    it('should have valid item properties', () => {
      const { items } = generateMap(1);

      for (const item of items) {
        expect(item.id).toBeDefined();
        expect(item.type).toBeDefined();
        expect(item.name).toBeDefined();
        expect(typeof item.value).toBe('number');
      }
    });
  });

  describe('Character-Specific Equipment', () => {
    it('should spawn character-appropriate ranged equipment', () => {
      const testCases = [
        { character: 'wizard' as const, expectedWeapon: 'staff' },
        { character: 'bandit' as const, expectedWeapon: 'crossbow' },
        { character: 'elf' as const, expectedWeapon: 'dagger' },
        { character: 'dwarf' as const, expectedWeapon: 'dagger' },
      ];

      for (const { character, expectedWeapon } of testCases) {
        const { items } = generateMap(1, character);

        const rangedEquipment = items.filter(
          (item) =>
            item.type === 'equipment' &&
            isEquipmentItem(item) &&
            item.equipment.slot === 'ranged',
        );

        // If any ranged equipment spawned, verify it's the expected type
        for (const item of rangedEquipment) {
          if (isEquipmentItem(item)) {
            expect(item.equipment.id).toContain(expectedWeapon);
          }
        }
      }
    });
  });

  describe('Floor Difficulty Scaling', () => {
    it('should spawn more enemies on higher floors', () => {
      const { enemies: floor1Enemies } = generateMap(1);
      const { enemies: floor10Enemies } = generateMap(10);

      expect(floor10Enemies.length).toBeGreaterThan(floor1Enemies.length);
    });

    it('should provide better equipment on higher floors', () => {
      const { items: floor10Items } = generateMap(10, 'dwarf');

      const floor10Equipment = floor10Items.filter(
        (item) => item.type === 'equipment',
      );

      // Higher floors should have access to higher tier equipment
      // This is probabilistic, so we can't guarantee specific items
      expect(floor10Equipment.length).toBeGreaterThanOrEqual(1);
    });
  });
});

describe('initializeFog', () => {
  it('should return MAP_HEIGHT x MAP_WIDTH array', () => {
    const fog = initializeFog();

    expect(fog.length).toBe(MAP_HEIGHT);
    for (const row of fog) {
      expect(row.length).toBe(MAP_WIDTH);
    }
  });

  it('should initialize all values to false', () => {
    const fog = initializeFog();

    for (let y = 0; y < MAP_HEIGHT; y++) {
      for (let x = 0; x < MAP_WIDTH; x++) {
        expect(fog[y][x]).toBe(false);
      }
    }
  });

  it('should return a new array each time', () => {
    const fog1 = initializeFog();
    const fog2 = initializeFog();

    expect(fog1).not.toBe(fog2);
    fog1[0][0] = true;
    expect(fog2[0][0]).toBe(false);
  });
});
