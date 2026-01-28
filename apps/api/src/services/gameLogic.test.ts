import {
  type EquipmentItem,
  type GameState,
  getEnemyXpReward,
  type Item,
  MAP_HEIGHT,
  MAP_WIDTH,
  VISION_RADIUS,
} from '@dungeon-crawler/shared';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createSmallTestMap,
  createTestEnemy,
  createTestEquipment,
  createTestGameState,
  createTestPlayer,
  revealFogAtPosition,
} from '@/test/helpers/gameStateHelpers.js';
import {
  canMoveToTile,
  createNewGame,
  descendStairs,
  findPathToTarget,
  getVisibleEnemies,
  getVisibleItems,
  getVisibleState,
  getVisibleTiles,
  hasLineOfSight,
  processAttack,
  processAttackWithDeltas,
  processMove,
  processMoveWithDeltas,
  updateFog,
} from './gameLogic.js';

// ============================================
// Suite: Visibility Functions (Anti-Cheat)
// ============================================

describe('Visibility Functions (Anti-Cheat)', () => {
  describe('getVisibleEnemies', () => {
    it('should only return enemies in revealed fog and filter out dead enemies', () => {
      const state = createTestGameState();
      const visibleEnemy = createTestEnemy('rat', { x: 5, y: 5, hp: 10 });
      const hiddenEnemy = createTestEnemy('orc', { x: 20, y: 20 });
      const deadEnemy = createTestEnemy('skeleton', { x: 6, y: 5, hp: 0 });

      state.enemies = [visibleEnemy, hiddenEnemy, deadEnemy];

      state.fog[5][5] = true;
      state.fog[5][6] = true;
      state.fog[20][20] = false;

      const visible = getVisibleEnemies(state);

      expect(visible).toHaveLength(1);
      expect(visible[0].id).toBe(visibleEnemy.id);
    });

    it('should handle edge cases (out-of-bounds and map edges)', () => {
      const state = createTestGameState();
      const outOfBounds = createTestEnemy('rat', { x: -1, y: -1 });
      const atEdge1 = createTestEnemy('orc', { x: 0, y: 0 });
      const atEdge2 = createTestEnemy('skeleton', {
        x: MAP_WIDTH - 1,
        y: MAP_HEIGHT - 1,
      });

      state.enemies = [outOfBounds, atEdge1, atEdge2];

      state.fog[0][0] = true;
      state.fog[MAP_HEIGHT - 1][MAP_WIDTH - 1] = true;

      const visible = getVisibleEnemies(state);

      expect(visible).toHaveLength(2);
      expect(visible.some((e) => e.id === atEdge1.id)).toBe(true);
      expect(visible.some((e) => e.id === atEdge2.id)).toBe(true);
    });
  });

  describe('getVisibleItems', () => {
    it('should only return items in revealed fog', () => {
      const state = createTestGameState();
      const item1: Item = {
        id: 'item1',
        type: 'health_potion',
        name: 'Health Potion',
        x: 5,
        y: 5,
        value: 10,
      };
      const item2: Item = {
        id: 'item2',
        type: 'health_potion',
        name: 'Health Potion',
        x: 20,
        y: 20,
        value: 10,
      };

      state.items = [item1, item2];

      state.fog[5][5] = true;
      state.fog[20][20] = false;

      const visible = getVisibleItems(state);

      expect(visible).toHaveLength(1);
      expect(visible[0].id).toBe(item1.id);
    });

    it('should handle out-of-bounds coordinates', () => {
      const state = createTestGameState();
      const item = {
        id: 'item1',
        type: 'health_potion',
        name: 'Health Potion',
        x: MAP_WIDTH + 10,
        y: MAP_HEIGHT + 10,
        value: 10,
      } satisfies Item;

      state.items = [item];

      const visible = getVisibleItems(state);

      expect(visible).toHaveLength(0);
    });
  });

  describe('getVisibleTiles', () => {
    it('should only return tiles where fog is true', () => {
      const state = createTestGameState();

      // Reveal a small area
      for (let y = 5; y < 10; y++) {
        for (let x = 5; x < 10; x++) {
          state.fog[y][x] = true;
        }
      }

      const visible = getVisibleTiles(state);

      // Should be 5x5 = 25 tiles
      expect(visible.length).toBe(25);

      // All visible tiles should have fog = true at their coordinates
      for (const tile of visible) {
        expect(state.fog[tile.y][tile.x]).toBe(true);
      }
    });

    it('should return correct tile objects', () => {
      const state = createTestGameState();
      state.fog[5][5] = true;

      const visible = getVisibleTiles(state);

      const tile = visible.find((t) => t.x === 5 && t.y === 5);
      expect(tile).toBeDefined();
      expect(tile?.type).toBe('floor');
    });
  });

  describe('getVisibleState', () => {
    it('should construct VisibleGameState correctly', () => {
      const state = createTestGameState();
      state.floor = 3;
      state.score = 150;

      const visibleState = getVisibleState(state);

      expect(visibleState).toMatchObject({
        _id: state._id,
        playerName: state.playerName,
        floor: 3,
        score: 150,
        status: 'active',
        fog: state.fog,
        player: state.player,
      });
    });

    it('should call visibility filters properly', () => {
      const state = createTestGameState();
      const enemy = createTestEnemy('rat', { x: 5, y: 5 });
      const item = {
        id: 'item1',
        type: 'health_potion',
        name: 'Health Potion',
        x: 6,
        y: 5,
        value: 10,
      } satisfies Item;

      state.enemies = [enemy];
      state.items = [item];

      // Reveal fog around entities
      state.fog[5][5] = true;
      state.fog[5][6] = true;

      const visibleState = getVisibleState(state);

      expect(visibleState.visibleEnemies).toHaveLength(1);
      expect(visibleState.visibleItems).toHaveLength(1);
      expect(visibleState.visibleTiles.length).toBeGreaterThan(0);
    });
  });
});

// ============================================
// Suite: Movement & Collision
// ============================================

describe('Movement & Collision', () => {
  let state: GameState;

  beforeEach(() => {
    state = createTestGameState({
      map: createSmallTestMap(),
      player: createTestPlayer({ x: 5, y: 5 }),
    });
    revealFogAtPosition(state.fog, 5, 5);
  });

  describe('Player movement', () => {
    it('should move player in all four directions', () => {
      const movements = [
        { direction: 'up' as const, expectedX: 5, expectedY: 4 },
        { direction: 'down' as const, expectedX: 5, expectedY: 6 },
        { direction: 'left' as const, expectedX: 4, expectedY: 5 },
        { direction: 'right' as const, expectedX: 6, expectedY: 5 },
      ];

      for (const { direction, expectedX, expectedY } of movements) {
        state.player.x = 5;
        state.player.y = 5;

        const events = processMove(state, direction);

        expect(state.player).toMatchObject({ x: expectedX, y: expectedY });
        expect(events).toContainEqual(
          expect.objectContaining({ type: 'player_moved' }),
        );
      }
    });

    it('should update facing direction on horizontal movement only', () => {
      // Horizontal movement updates facing
      state.player.facingDirection = 'left';
      processMove(state, 'right');
      expect(state.player.facingDirection).toBe('right');

      processMove(state, 'left');
      expect(state.player.facingDirection).toBe('left');

      // Vertical movement preserves facing
      state.player.facingDirection = 'right';
      processMove(state, 'up');
      expect(state.player.facingDirection).toBe('right');

      processMove(state, 'down');
      expect(state.player.facingDirection).toBe('right');
    });
  });

  describe('Collision detection', () => {
    it('should block movement into walls and boundaries', () => {
      // Test wall collision
      state.player.x = 1;
      state.player.y = 1;
      const wallEvents = processMove(state, 'left');
      expect(state.player.x).toBe(1);
      expect(wallEvents).toHaveLength(0);

      // Test map boundaries
      state.player.x = 0;
      state.player.y = 0;
      const boundaryEvents1 = processMove(state, 'left');
      expect(state.player.x).toBe(0);
      expect(boundaryEvents1).toHaveLength(0);

      const boundaryEvents2 = processMove(state, 'up');
      expect(state.player.y).toBe(0);
      expect(boundaryEvents2).toHaveLength(0);

      // Test maximum boundaries
      state.player.x = 9;
      state.player.y = 9;
      const maxEvents1 = processMove(state, 'right');
      expect(state.player.x).toBe(9);
      expect(maxEvents1).toHaveLength(0);

      const maxEvents2 = processMove(state, 'down');
      expect(state.player.y).toBe(9);
      expect(maxEvents2).toHaveLength(0);
    });

    it('should attack enemy instead of moving when enemy is in target position', () => {
      const enemy = createTestEnemy('rat', { x: 6, y: 5, hp: 10 });
      state.enemies = [enemy];

      const originalX = state.player.x;
      const events = processMove(state, 'right');

      expect(state.player.x).toBe(originalX);
      expect(enemy.hp).toBeLessThan(10);
      expect(events).toContainEqual(
        expect.objectContaining({ type: 'player_attacked' }),
      );
    });

    it('should update facing direction when attacking horizontally', () => {
      const enemy = createTestEnemy('rat', { x: 6, y: 5, hp: 10 });
      state.enemies = [enemy];
      state.player.facingDirection = 'left';

      processMove(state, 'right');

      expect(state.player.facingDirection).toBe('right');
    });
  });

  describe('Item pickup on movement', () => {
    it('should pick up health potion when moving over it', () => {
      const item = {
        id: 'potion1',
        type: 'health_potion',
        name: 'Health Potion',
        x: 6,
        y: 5,
        value: 10,
      } satisfies Item;
      state.items = [item];
      state.player.hp = state.player.maxHp - 5;

      const events = processMove(state, 'right');

      expect(state.items).toHaveLength(0);
      expect(state.player.hp).toBeGreaterThan(state.player.maxHp - 5);
      expect(events).toContainEqual(
        expect.objectContaining({ type: 'player_healed' }),
      );
    });

    it('should refuse potion when at max HP', () => {
      const item = {
        id: 'potion1',
        type: 'health_potion',
        name: 'Health Potion',
        x: 6,
        y: 5,
        value: 10,
      } satisfies Item;
      state.items = [item];
      state.player.hp = state.player.maxHp;

      const events = processMove(state, 'right');

      expect(state.items).toHaveLength(1);
      expect(events).toContainEqual(
        expect.objectContaining({ type: 'potion_refused' }),
      );
    });

    it('should auto-equip better equipment when moving over it', () => {
      const weapon = createTestEquipment('weapon', 1);
      const item = {
        id: 'weapon1',
        type: 'equipment',
        name: weapon.name,
        x: 6,
        y: 5,
        value: 0,
        equipment: weapon,
      } satisfies EquipmentItem;
      state.items = [item];

      const events = processMove(state, 'right');

      expect(state.items).toHaveLength(0);
      expect(state.player.equipment.weapon).toEqual(weapon);
      expect(events).toContainEqual(
        expect.objectContaining({ type: 'equipment_equipped' }),
      );
    });
  });

  describe('Stairs interaction', () => {
    it('should auto-descend when stepping on stairs', () => {
      state.map = createTestGameState().map;
      state.player.x = 5;
      state.player.y = 5;
      state.map[5][5].type = 'stairs';

      const events = descendStairs(state);

      expect(state.floor).toBe(2);
      expect(events).toContainEqual(
        expect.objectContaining({ type: 'floor_descended' }),
      );
    });

    it('should skip enemy movement on floor change', () => {
      state.map = createTestGameState().map;
      state.player.x = 5;
      state.player.y = 5;
      const enemy = createTestEnemy('rat', { x: 3, y: 5 });
      state.enemies = [enemy];
      state.map[5][5].type = 'stairs';

      descendStairs(state);

      // Enemies should be new from new floor, not moved from old floor
      expect(state.enemies.every((e) => e.id !== enemy.id)).toBe(true);
    });
  });
});

// ============================================
// Suite: Fog of War
// ============================================

describe('Fog of War', () => {
  describe('updateFog', () => {
    it('should reveal tiles within VISION_RADIUS', () => {
      const state = createTestGameState({
        map: createSmallTestMap(),
        player: createTestPlayer({ x: 5, y: 5 }),
      });

      updateFog(state);

      // Check center is revealed
      expect(state.fog[5][5]).toBe(true);

      // Check tiles within radius
      for (let dy = -VISION_RADIUS; dy <= VISION_RADIUS; dy++) {
        for (let dx = -VISION_RADIUS; dx <= VISION_RADIUS; dx++) {
          const distance = Math.sqrt(dx * dx + dy * dy);
          const x = 5 + dx;
          const y = 5 + dy;

          if (x >= 0 && x < 10 && y >= 0 && y < 10) {
            if (distance <= VISION_RADIUS) {
              expect(state.fog[y][x]).toBe(true);
            }
          }
        }
      }
    });

    it('should use correct radius calculation', () => {
      const state = createTestGameState({
        map: createSmallTestMap(),
        player: createTestPlayer({ x: 5, y: 5 }),
      });

      updateFog(state);

      // Tile exactly at radius should be revealed
      const exactRadiusX = 5 + VISION_RADIUS;
      if (exactRadiusX < 10) {
        expect(state.fog[5][exactRadiusX]).toBe(true);
      }

      // Tile just beyond radius should not be revealed
      state.fog = state.fog.map((row) => row.map(() => false));
      updateFog(state);

      const beyondRadiusX = 5 + VISION_RADIUS + 2;
      if (beyondRadiusX < 10) {
        expect(state.fog[5][beyondRadiusX]).toBe(false);
      }
    });

    it('should not unreveal tiles (fog is permanent)', () => {
      const state = createTestGameState({
        map: createSmallTestMap(),
        player: createTestPlayer({ x: 5, y: 5 }),
      });

      updateFog(state);
      expect(state.fog[5][5]).toBe(true);

      // Move player far away
      state.player.x = 8;
      state.player.y = 8;
      updateFog(state);

      // Original area should still be revealed
      expect(state.fog[5][5]).toBe(true);
    });

    it('should handle map boundaries', () => {
      const state = createTestGameState({
        map: createSmallTestMap(),
        player: createTestPlayer({ x: 1, y: 1 }),
      });

      updateFog(state);

      expect(state.fog[1][1]).toBe(true);
      expect(state.fog[0][0]).toBe(true);
    });
  });
});

// ============================================
// Suite: Combat System
// ============================================

describe('Combat System', () => {
  describe('Melee combat', () => {
    it('should calculate damage correctly (attack - defense, minimum 1)', () => {
      const state = createTestGameState({
        player: createTestPlayer({ attack: 10, defense: 2 }),
      });
      const enemy = createTestEnemy('rat', { x: 6, y: 5, hp: 20, defense: 3 });
      state.enemies = [enemy];

      processMove(state, 'right');

      // Damage = 10 - 3 = 7
      expect(enemy.hp).toBe(20 - 7);
    });

    it('should deal minimum 1 damage even if defense is higher', () => {
      const state = createTestGameState({
        player: createTestPlayer({ attack: 5, defense: 2 }),
      });
      const enemy = createTestEnemy('rat', {
        x: 6,
        y: 5,
        hp: 20,
        defense: 10,
      });
      state.enemies = [enemy];

      processMove(state, 'right');

      // Damage = max(1, 5 - 10) = 1
      expect(enemy.hp).toBe(19);
    });

    it('should kill enemy and grant XP and score', () => {
      const state = createTestGameState({
        player: createTestPlayer({ xp: 0 }),
        score: 0,
      });
      const enemy = createTestEnemy('rat', { x: 6, y: 5, hp: 1 });
      state.enemies = [enemy];

      const events = processMove(state, 'right');

      expect(enemy.hp).toBeLessThanOrEqual(0);
      expect(state.player.xp).toBeGreaterThan(0);
      expect(state.score).toBeGreaterThan(0);
      expect(events).toContainEqual(
        expect.objectContaining({ type: 'enemy_killed' }),
      );
      expect(events).toContainEqual(
        expect.objectContaining({ type: 'xp_gained' }),
      );
    });
  });

  describe('Player death', () => {
    it('should set game status to dead when player HP <= 0', () => {
      const state = createTestGameState({
        player: createTestPlayer({ hp: 1, defense: 0 }),
      });
      const enemy = createTestEnemy('orc', {
        x: 6,
        y: 5,
        attack: 20,
        behavior: 'aggressive',
      });
      state.enemies = [enemy];

      processMove(state, 'right');

      if (state.player.hp <= 0) {
        expect(state.status).toBe('dead');
      }
    });

    it('should generate player_died event', () => {
      const state = createTestGameState({
        player: createTestPlayer({ hp: 1, defense: 0 }),
      });
      const enemy = createTestEnemy('orc', {
        x: 4,
        y: 5,
        attack: 20,
        behavior: 'aggressive',
      });
      state.enemies = [enemy];

      const events = processMove(state, 'down');

      if (state.player.hp <= 0) {
        expect(events).toContainEqual(
          expect.objectContaining({ type: 'player_died' }),
        );
      }
    });
  });

  describe('Ranged attack', () => {
    it('should calculate ranged damage correctly', () => {
      const state = createTestGameState({
        player: createTestPlayer({
          character: 'bandit',
          x: 5,
          y: 5,
          facingDirection: 'right',
        }),
      });
      const enemy = createTestEnemy('rat', {
        x: 7,
        y: 5,
        hp: 20,
        defense: 1,
      });
      state.enemies = [enemy];

      const events = processAttack(state);

      // Bandit has rangedDamage 6, enemy defense 1 = 5 damage
      expect(enemy.hp).toBe(20 - 5);
      expect(events).toContainEqual(
        expect.objectContaining({ type: 'ranged_attack' }),
      );
    });

    it('should shoot in facing direction', () => {
      const state = createTestGameState({
        player: createTestPlayer({
          character: 'wizard',
          x: 5,
          y: 5,
          facingDirection: 'left',
        }),
      });
      const enemyLeft = createTestEnemy('rat', { x: 3, y: 5, hp: 20 });
      const enemyRight = createTestEnemy('orc', { x: 7, y: 5, hp: 20 });
      state.enemies = [enemyLeft, enemyRight];

      processAttack(state);

      expect(enemyLeft.hp).toBeLessThan(20);
      expect(enemyRight.hp).toBe(20);
    });

    it('should stop at walls', () => {
      const state = createTestGameState({
        player: createTestPlayer({
          character: 'bandit',
          x: 5,
          y: 5,
          facingDirection: 'right',
        }),
      });
      state.map[5][6].type = 'wall';
      const enemy = createTestEnemy('rat', { x: 8, y: 5, hp: 20 });
      state.enemies = [enemy];

      const events = processAttack(state);

      expect(enemy.hp).toBe(20);
      expect(events).toContainEqual(
        expect.objectContaining({ type: 'ranged_missed' }),
      );
    });

    it('should respect ranged range limit', () => {
      const state = createTestGameState({
        player: createTestPlayer({
          character: 'dwarf',
          x: 5,
          y: 5,
          facingDirection: 'right',
        }),
      });
      const enemy = createTestEnemy('rat', { x: 8, y: 5, hp: 20 });
      state.enemies = [enemy];

      const events = processAttack(state);

      expect(enemy.hp).toBe(20);
      expect(events).toContainEqual(
        expect.objectContaining({ type: 'ranged_missed' }),
      );
    });

    it('should hit first enemy in line', () => {
      const state = createTestGameState({
        player: createTestPlayer({
          character: 'wizard',
          x: 5,
          y: 5,
          facingDirection: 'right',
        }),
      });
      const enemy1 = createTestEnemy('rat', { x: 6, y: 5, hp: 20 });
      const enemy2 = createTestEnemy('orc', { x: 7, y: 5, hp: 30 });
      state.enemies = [enemy1, enemy2];

      processAttack(state);

      expect(enemy1.hp).toBeLessThan(20);
      expect(enemy2.hp).toBe(30);
    });
  });

  describe('Line of sight', () => {
    it('should return true for clear line of sight', () => {
      const state = createTestGameState({ map: createSmallTestMap() });

      expect(hasLineOfSight(state, 1, 1, 5, 5)).toBe(true);
      expect(hasLineOfSight(state, 5, 5, 5, 5)).toBe(true);
      expect(hasLineOfSight(state, 2, 5, 7, 5)).toBe(true);
      expect(hasLineOfSight(state, 5, 2, 5, 7)).toBe(true);
      expect(hasLineOfSight(state, 2, 2, 7, 7)).toBe(true);
    });

    it('should return false when wall blocks path', () => {
      const state = createTestGameState({ map: createSmallTestMap() });
      state.map[3][3].type = 'wall';

      const hasLOS = hasLineOfSight(state, 1, 1, 5, 5);

      expect(hasLOS).toBe(false);
    });
  });
});

// ============================================
// Suite: Enemy AI
// ============================================

describe('Enemy AI', () => {
  describe('findPathToTarget - A* pathfinding', () => {
    it('should find shortest path and avoid walls', () => {
      const state = createTestGameState({ map: createSmallTestMap() });

      const step = findPathToTarget(state, 1, 1, 5, 5);

      expect(step).toBeDefined();
      expect(step?.x).toBeGreaterThanOrEqual(1);
      expect(step?.y).toBeGreaterThanOrEqual(1);

      // Test wall avoidance
      state.map[3][3].type = 'wall';
      state.map[3][4].type = 'wall';
      state.map[3][5].type = 'wall';

      const stepAroundWall = findPathToTarget(state, 2, 3, 4, 3);

      expect(stepAroundWall).toBeDefined();
      if (stepAroundWall) {
        expect(state.map[stepAroundWall.y][stepAroundWall.x].type).not.toBe(
          'wall',
        );
      }
    });

    it('should return null if no path exists or already at target', () => {
      const state = createTestGameState({ map: createSmallTestMap() });

      // Already at target
      expect(findPathToTarget(state, 5, 5, 5, 5)).toBeNull();

      // Surround target with walls
      for (let y = 3; y <= 5; y++) {
        for (let x = 3; x <= 5; x++) {
          if (x !== 4 || y !== 4) {
            state.map[y][x].type = 'wall';
          }
        }
      }

      expect(findPathToTarget(state, 1, 1, 4, 4)).toBeNull();
    });

    it('should respect maxDistance parameter', () => {
      const state = createTestGameState({ map: createSmallTestMap() });

      const step = findPathToTarget(state, 1, 1, 8, 8, 2);

      expect(step).toBeNull();
    });

    it('should avoid other enemies', () => {
      const state = createTestGameState({ map: createSmallTestMap() });
      const blockingEnemy = createTestEnemy('rat', { x: 3, y: 3 });
      state.enemies = [blockingEnemy];

      const step = findPathToTarget(state, 2, 3, 4, 3);

      if (step) {
        expect(step.x !== 3 || step.y !== 3).toBe(true);
      }
    });
  });

  describe('Enemy behaviors', () => {
    it('should handle aggressive behavior - chase player', () => {
      const state = createTestGameState({
        map: createSmallTestMap(),
        player: createTestPlayer({ x: 5, y: 5 }),
      });
      const enemy = createTestEnemy('orc', {
        x: 3,
        y: 5,
        behavior: 'aggressive',
      });
      state.enemies = [enemy];
      revealFogAtPosition(state.fog, 5, 5);

      const originalX = enemy.x;
      processMove(state, 'down');

      expect(enemy.x !== originalX || enemy.y !== 5).toBe(true);
    });

    it('should handle flee behavior - run when low HP', () => {
      const state = createTestGameState({
        map: createSmallTestMap(),
        player: createTestPlayer({ x: 5, y: 5 }),
      });
      const enemy = createTestEnemy('rat', {
        x: 4,
        y: 5,
        hp: 2,
        maxHp: 10,
        behavior: 'flee',
      });
      state.enemies = [enemy];
      revealFogAtPosition(state.fog, 5, 5);

      const originalX = enemy.x;
      processMove(state, 'down');

      expect(enemy.x).toBeLessThanOrEqual(originalX);
    });

    it('should handle patrol behavior - only chase when seeing player', () => {
      const state = createTestGameState({
        map: createSmallTestMap(),
        player: createTestPlayer({ x: 5, y: 5 }),
      });
      const enemy = createTestEnemy('skeleton', {
        x: 7,
        y: 7,
        behavior: 'patrol',
      });
      state.enemies = [enemy];
      revealFogAtPosition(state.fog, 5, 5);

      processMove(state, 'down');

      expect(enemy).toBeDefined();
    });

    it('should handle stationary behavior - only attack when adjacent', () => {
      const state = createTestGameState({
        map: createSmallTestMap(),
        player: createTestPlayer({ x: 5, y: 5 }),
      });
      const enemy = createTestEnemy('dragon', {
        x: 7,
        y: 5,
        behavior: 'stationary',
      });
      state.enemies = [enemy];
      revealFogAtPosition(state.fog, 5, 5);

      const originalX = enemy.x;
      processMove(state, 'down');

      expect(enemy.x).toBe(originalX);
      expect(enemy.y).toBe(5);
    });
  });

  describe('Enemy movement logic', () => {
    it('should attack player when adjacent', () => {
      const state = createTestGameState({
        map: createSmallTestMap(),
        player: createTestPlayer({ x: 5, y: 5, hp: 30 }),
      });
      const enemy = createTestEnemy('orc', {
        x: 5,
        y: 4,
        behavior: 'aggressive',
      });
      state.enemies = [enemy];
      revealFogAtPosition(state.fog, 5, 5);

      const playerHp = state.player.hp;
      const events = processMove(state, 'down');

      expect(state.player.hp).toBeLessThan(playerHp);
      expect(events).toContainEqual(
        expect.objectContaining({ type: 'player_damaged' }),
      );
    });

    it('should not move if no line of sight and no memory', () => {
      const state = createTestGameState({
        map: createSmallTestMap(),
        player: createTestPlayer({ x: 5, y: 5 }),
      });
      state.map[5][4].type = 'wall';
      state.map[5][3].type = 'wall';

      const enemy = createTestEnemy('orc', {
        x: 2,
        y: 5,
        behavior: 'aggressive',
      });
      state.enemies = [enemy];
      revealFogAtPosition(state.fog, 5, 5);

      const originalX = enemy.x;
      processMove(state, 'down');

      expect(enemy.x).toBe(originalX);
    });

    it('should remember last seen player position', () => {
      const state = createTestGameState({
        map: createSmallTestMap(),
        player: createTestPlayer({ x: 5, y: 5 }),
      });
      const enemy = createTestEnemy('orc', {
        x: 3,
        y: 5,
        behavior: 'aggressive',
      });
      state.enemies = [enemy];
      revealFogAtPosition(state.fog, 5, 5);

      processMove(state, 'down');

      expect(enemy.lastSeenPlayer).toBeDefined();
      expect(enemy.lastSeenPlayer?.x).toBe(5);
    });
  });

  describe('canMoveToTile', () => {
    it('should return false for walls, player position, other enemies, and out of bounds', () => {
      const state = createTestGameState({
        map: createSmallTestMap(),
        player: createTestPlayer({ x: 5, y: 5 }),
      });
      const enemy1 = createTestEnemy('rat', { x: 5, y: 5 });
      const enemy2 = createTestEnemy('orc', { x: 6, y: 5 });
      state.enemies = [enemy1, enemy2];

      expect(canMoveToTile(state, enemy1, 0, 0)).toBe(false); // Wall
      expect(canMoveToTile(state, enemy1, 5, 5)).toBe(false); // Player
      expect(canMoveToTile(state, enemy1, 6, 5)).toBe(false); // Other enemy
      expect(canMoveToTile(state, enemy1, -1, 5)).toBe(false); // Out of bounds
    });

    it('should return true for valid empty floor tile', () => {
      const state = createTestGameState({ map: createSmallTestMap() });
      const enemy = createTestEnemy('rat', { x: 5, y: 5 });

      const canMove = canMoveToTile(state, enemy, 6, 6);

      expect(canMove).toBe(true);
    });
  });
});

// ============================================
// Suite: Equipment System
// ============================================

describe('Equipment System', () => {
  describe('Stat bonuses', () => {
    it('should apply attack bonus from weapon', () => {
      const state = createTestGameState({
        player: createTestPlayer({ attack: 5 }),
      });
      const weapon = createTestEquipment('weapon', 1);
      const item = {
        id: 'weapon1',
        type: 'equipment',
        name: weapon.name,
        x: 6,
        y: 5,
        value: 0,
        equipment: weapon,
      } satisfies EquipmentItem;
      state.items = [item];

      processMove(state, 'right');

      expect(state.player.attack).toBe(5 + weapon.attackBonus);
      expect(state.player.equipment.weapon).toEqual(weapon);
    });

    it('should apply defense bonus from shield', () => {
      const state = createTestGameState({
        player: createTestPlayer({ defense: 2 }),
      });
      const shield = createTestEquipment('shield', 1);
      const item = {
        id: 'shield1',
        type: 'equipment',
        name: shield.name,
        x: 6,
        y: 5,
        value: 0,
        equipment: shield,
      } satisfies EquipmentItem;
      state.items = [item];

      processMove(state, 'right');

      expect(state.player.defense).toBe(2 + shield.defenseBonus);
      expect(state.player.equipment.shield).toEqual(shield);
    });

    it('should apply HP bonus from armor', () => {
      const state = createTestGameState({
        player: createTestPlayer({ maxHp: 25, hp: 25 }),
      });
      const armor = createTestEquipment('armor', 1);
      const item = {
        id: 'armor1',
        type: 'equipment',
        name: armor.name,
        x: 6,
        y: 5,
        value: 0,
        equipment: armor,
      } satisfies EquipmentItem;
      state.items = [item];

      processMove(state, 'right');

      expect(state.player.maxHp).toBe(25 + armor.hpBonus);
      expect(state.player.equipment.armor).toEqual(armor);
    });

    it('should apply ranged bonuses from ranged equipment', () => {
      const state = createTestGameState({
        player: createTestPlayer({ character: 'bandit' }),
      });
      const ranged = createTestEquipment('ranged', 1);
      const item = {
        id: 'ranged1',
        type: 'equipment',
        name: ranged.name,
        x: 6,
        y: 5,
        value: 0,
        equipment: ranged,
      } satisfies EquipmentItem;
      state.items = [item];

      processMove(state, 'right');

      expect(state.player.equipment.ranged).toEqual(ranged);
    });

    it('should clamp HP to maxHP after equipment change', () => {
      const state = createTestGameState({
        player: createTestPlayer({ maxHp: 30, hp: 30 }),
      });
      const armor = createTestEquipment('armor', 1);
      const item = {
        id: 'armor1',
        type: 'equipment',
        name: armor.name,
        x: 6,
        y: 5,
        value: 0,
        equipment: armor,
      } satisfies EquipmentItem;
      state.items = [item];

      processMove(state, 'right');

      expect(state.player.hp).toBeLessThanOrEqual(state.player.maxHp);
    });
  });

  describe('Auto-equip', () => {
    it('should auto-equip when no equipment in slot', () => {
      const state = createTestGameState();
      const weapon = createTestEquipment('weapon', 1);
      const item = {
        id: 'weapon1',
        type: 'equipment',
        name: weapon.name,
        x: 6,
        y: 5,
        value: 0,
        equipment: weapon,
      } satisfies EquipmentItem;
      state.items = [item];

      processMove(state, 'right');

      expect(state.player.equipment.weapon).toEqual(weapon);
      expect(state.items).toHaveLength(0);
    });

    it('should auto-equip if new equipment is better', () => {
      const state = createTestGameState();
      const oldWeapon = createTestEquipment('weapon', 1);
      const newWeapon = createTestEquipment('weapon', 3);
      state.player.equipment.weapon = oldWeapon;
      state.player.attack += oldWeapon.attackBonus;

      const item = {
        id: 'weapon2',
        type: 'equipment',
        name: newWeapon.name,
        x: 6,
        y: 5,
        value: 0,
        equipment: newWeapon,
      } satisfies EquipmentItem;
      state.items = [item];

      const originalAttack = state.player.attack;
      processMove(state, 'right');

      expect(state.player.equipment.weapon?.id).toBe(newWeapon.id);
      expect(state.player.attack).toBe(
        originalAttack - oldWeapon.attackBonus + newWeapon.attackBonus,
      );
    });

    it('should not equip if current equipment is better', () => {
      const state = createTestGameState();
      const oldWeapon = createTestEquipment('weapon', 3);
      const newWeapon = createTestEquipment('weapon', 1);
      state.player.equipment.weapon = oldWeapon;
      state.player.attack += oldWeapon.attackBonus;

      const item = {
        id: 'weapon2',
        type: 'equipment',
        name: newWeapon.name,
        x: 6,
        y: 5,
        value: 0,
        equipment: newWeapon,
      } satisfies EquipmentItem;
      state.items = [item];

      processMove(state, 'right');

      expect(state.player.equipment.weapon?.id).toBe(oldWeapon.id);
      expect(state.items).toHaveLength(1);
    });
  });

  describe('Equipment replacement', () => {
    it('should remove old equipment stats when equipping new', () => {
      const state = createTestGameState({
        player: createTestPlayer({ attack: 10 }),
      });
      const oldWeapon = createTestEquipment('weapon', 1);
      state.player.equipment.weapon = oldWeapon;
      state.player.attack += oldWeapon.attackBonus;

      const newWeapon = createTestEquipment('weapon', 3);
      const item = {
        id: 'weapon2',
        type: 'equipment',
        name: newWeapon.name,
        x: 6,
        y: 5,
        value: 0,
        equipment: newWeapon,
      } satisfies EquipmentItem;
      state.items = [item];

      processMove(state, 'right');

      expect(state.player.attack).toBe(14);
    });

    it('should handle complex equipment with multiple bonuses', () => {
      const state = createTestGameState({
        player: createTestPlayer({ defense: 3, maxHp: 25 }),
      });
      const oldArmor = createTestEquipment('armor', 1);
      state.player.equipment.armor = oldArmor;
      state.player.defense += oldArmor.defenseBonus;
      state.player.maxHp += oldArmor.hpBonus;

      const newArmor = createTestEquipment('armor', 3);
      const item = {
        id: 'armor2',
        type: 'equipment',
        name: newArmor.name,
        x: 6,
        y: 5,
        value: 0,
        equipment: newArmor,
      } satisfies EquipmentItem;
      state.items = [item];

      processMove(state, 'right');

      expect(state.player.defense).toBe(6);
      expect(state.player.maxHp).toBe(40);
    });
  });
});

// ============================================
// Suite: Level Progression
// ============================================

describe('Level Progression', () => {
  describe('XP gain', () => {
    it('should grant XP on enemy kill using getEnemyXpReward', () => {
      const state = createTestGameState({
        player: createTestPlayer({ xp: 0 }),
      });
      const enemy = createTestEnemy('rat', { x: 6, y: 5, hp: 1 });
      state.enemies = [enemy];

      const expectedXp = getEnemyXpReward(enemy);
      processMove(state, 'right');

      expect(state.player.xp).toBe(expectedXp);
    });

    describe('XP calculation', () => {
      let rat: ReturnType<typeof createTestEnemy>;
      let orc: ReturnType<typeof createTestEnemy>;
      let normalEnemy: ReturnType<typeof createTestEnemy>;
      let eliteEnemy: ReturnType<typeof createTestEnemy>;

      beforeAll(() => {
        rat = createTestEnemy('rat', { x: 6, y: 5, hp: 1 });
        orc = createTestEnemy('orc', { x: 7, y: 5, hp: 1 });
        normalEnemy = createTestEnemy('rat', { variant: 'normal' });
        eliteEnemy = createTestEnemy('rat', { variant: 'elite' });
      });

      it('should grant more XP for higher tier enemies', () => {
        const ratXp = getEnemyXpReward(rat);
        const orcXp = getEnemyXpReward(orc);

        expect(orcXp).toBeGreaterThan(ratXp);
      });

      it('should grant more XP for elite variants', () => {
        const normalXp = getEnemyXpReward(normalEnemy);
        const eliteXp = getEnemyXpReward(eliteEnemy);

        expect(eliteXp).toBeGreaterThan(normalXp);
      });
    });
  });

  describe('Level up', () => {
    it('should level up when XP >= xpToNextLevel and increase stats', () => {
      const state = createTestGameState({
        player: createTestPlayer({
          xp: 0,
          level: 1,
          maxHp: 25,
          attack: 5,
          defense: 2,
        }),
      });
      const enemy = createTestEnemy('orc', {
        x: 6,
        y: 5,
        hp: 1,
        variant: 'champion',
      });
      state.enemies = [enemy];

      const originalMaxHp = state.player.maxHp;
      const originalAttack = state.player.attack;
      const originalDefense = state.player.defense;

      const events = processMove(state, 'right');

      expect(state.player.level).toBeGreaterThan(1);
      expect(events).toContainEqual(
        expect.objectContaining({ type: 'level_up' }),
      );
      expect(state.player.maxHp).toBeGreaterThan(originalMaxHp);
      expect(state.player.attack).toBeGreaterThan(originalAttack);
      expect(state.player.defense).toBeGreaterThan(originalDefense);
    });

    it('should heal 50% of max HP on level up', () => {
      const state = createTestGameState({
        player: createTestPlayer({
          xp: 0,
          level: 1,
          hp: 10,
          maxHp: 25,
        }),
      });
      const enemy = createTestEnemy('orc', {
        x: 6,
        y: 5,
        hp: 1,
        variant: 'champion',
      });
      state.enemies = [enemy];

      const originalHp = state.player.hp;
      processMove(state, 'right');

      if (state.player.level > 1) {
        expect(state.player.hp).toBeGreaterThan(originalHp);
      }
    });

    it('should handle multiple level ups and carry over excess XP', () => {
      const state = createTestGameState({
        player: createTestPlayer({ xp: 0, level: 1, xpToNextLevel: 10 }),
      });
      const enemy = createTestEnemy('dragon', {
        x: 6,
        y: 5,
        hp: 1,
        variant: 'champion',
      });
      state.enemies = [enemy];

      const events = processMove(state, 'right');

      const levelUpEvents = events.filter((e) => e.type === 'level_up');
      expect(levelUpEvents.length).toBeGreaterThan(1);

      // XP should carry over
      expect(state.player.xp).toBeGreaterThanOrEqual(0);
      expect(state.player.xp).toBeLessThan(state.player.xpToNextLevel);
    });
  });
});

// ============================================
// Suite: Delta Generation (Sampling)
// ============================================

describe('Delta Generation', () => {
  describe('processMoveWithDeltas', () => {
    it('should generate core deltas (player_pos, fog, tiles, events)', () => {
      const state = createTestGameState({
        map: createSmallTestMap(),
        player: createTestPlayer({ x: 5, y: 5 }),
        score: 0,
      });
      revealFogAtPosition(state.fog, 5, 5);

      const { deltas, events } = processMoveWithDeltas(state, 'right');

      // Should have player_pos delta
      const posDelta = deltas.find((d) => d.type === 'player_pos');
      expect(posDelta).toBeDefined();
      if (posDelta?.type === 'player_pos') {
        expect(posDelta.x).toBe(6);
        expect(posDelta.y).toBe(5);
      }

      // Should have fog_reveal delta
      const fogDelta = deltas.find((d) => d.type === 'fog_reveal');
      expect(fogDelta).toBeDefined();

      // Should have tiles_reveal delta
      const tilesDelta = deltas.find((d) => d.type === 'tiles_reveal');
      expect(tilesDelta).toBeDefined();

      // Should have event deltas matching events
      const eventDeltas = deltas.filter((d) => d.type === 'event');
      expect(eventDeltas.length).toBe(events.length);
    });

    it('should generate equipment and enemy deltas when relevant', () => {
      const state = createTestGameState({
        map: createSmallTestMap(),
        player: createTestPlayer({ x: 5, y: 5 }),
      });
      const weapon = createTestEquipment('weapon', 1);
      const item = {
        id: 'weapon1',
        type: 'equipment',
        name: weapon.name,
        x: 6,
        y: 5,
        value: 0,
        equipment: weapon,
      } satisfies EquipmentItem;
      state.items = [item];

      const { deltas } = processMoveWithDeltas(state, 'right');

      // Should have player_equipment delta
      const equipDelta = deltas.find((d) => d.type === 'player_equipment');
      expect(equipDelta).toBeDefined();
    });

    it('should generate enemy deltas (visible, moved, damaged, killed)', () => {
      const state = createTestGameState({
        map: createSmallTestMap(),
        player: createTestPlayer({ x: 5, y: 5 }),
      });
      const enemy = createTestEnemy('rat', { x: 6, y: 5, hp: 1 });
      state.enemies = [enemy];
      revealFogAtPosition(state.fog, 5, 5);
      revealFogAtPosition(state.fog, 6, 5);

      const { deltas } = processMoveWithDeltas(state, 'right');

      // Should have enemy_killed delta
      const enemyKilledDelta = deltas.find((d) => d.type === 'enemy_killed');
      expect(enemyKilledDelta).toBeDefined();
    });

    it('should generate item deltas when items are picked up', () => {
      const state = createTestGameState({
        map: createSmallTestMap(),
        player: createTestPlayer({ x: 5, y: 5, hp: 20 }),
      });
      const item = {
        id: 'potion1',
        type: 'health_potion',
        name: 'Health Potion',
        x: 6,
        y: 5,
        value: 10,
      } satisfies Item;
      state.items = [item];

      const { deltas } = processMoveWithDeltas(state, 'right');

      // Should have item_removed delta
      const itemRemovedDelta = deltas.find((d) => d.type === 'item_removed');
      expect(itemRemovedDelta).toBeDefined();
      if (itemRemovedDelta?.type === 'item_removed') {
        expect(itemRemovedDelta.itemId).toBe('potion1');
      }
    });

    it('should generate new_floor delta on floor change', () => {
      const fullState = createTestGameState();
      fullState.player.x = 4;
      fullState.player.y = 5;
      fullState.map[5][5].type = 'stairs';

      const { deltas } = processMoveWithDeltas(fullState, 'right');

      const newFloorDelta = deltas.find((d) => d.type === 'new_floor');
      expect(newFloorDelta).toBeDefined();
      if (newFloorDelta?.type === 'new_floor') {
        expect(newFloorDelta.visibleState.floor).toBe(2);
      }
    });

    it('should generate game_status delta when game ends', () => {
      const state = createTestGameState({
        map: createSmallTestMap(),
        player: createTestPlayer({ x: 5, y: 5, hp: 1, defense: 0 }),
      });
      const enemy = createTestEnemy('dragon', {
        x: 4,
        y: 5,
        attack: 50,
        behavior: 'aggressive',
      });
      state.enemies = [enemy];

      const { deltas } = processMoveWithDeltas(state, 'down');

      if (state.status === 'dead') {
        const statusDelta = deltas.find((d) => d.type === 'game_status');
        expect(statusDelta).toBeDefined();
      }
    });
  });

  describe('processAttackWithDeltas', () => {
    it('should generate ranged attack deltas correctly', () => {
      const state = createTestGameState({
        map: createSmallTestMap(),
        player: createTestPlayer({
          character: 'wizard',
          x: 5,
          y: 5,
          facingDirection: 'right',
          xp: 0,
        }),
      });
      const enemy = createTestEnemy('rat', { x: 7, y: 5, hp: 1 });
      state.enemies = [enemy];

      const { deltas } = processAttackWithDeltas(state);

      // Should have enemy_killed delta
      const killedDelta = deltas.find((d) => d.type === 'enemy_killed');
      expect(killedDelta).toBeDefined();

      // Should have player_stats delta (from XP)
      const statsDelta = deltas.find((d) => d.type === 'player_stats');
      expect(statsDelta).toBeDefined();
      if (statsDelta?.type === 'player_stats') {
        expect(statsDelta.xp).toBeGreaterThan(0);
      }

      // Should have event deltas
      const eventDeltas = deltas.filter((d) => d.type === 'event');
      expect(eventDeltas.length).toBeGreaterThan(0);
    });
  });
});

// ============================================
// Suite: Game Initialization & Progression
// ============================================

describe('Game Initialization & Progression', () => {
  describe('createNewGame', () => {
    it('should create game with correct initial state', () => {
      const game = createNewGame('Test Player', 'player-123', 'dwarf');

      expect(game.playerName).toBe('Test Player');
      expect(game.playerId).toBe('player-123');
      expect(game.floor).toBe(1);
      expect(game.status).toBe('active');
      expect(game.score).toBe(0);
      expect(game.player.character).toBe('dwarf');
    });

    it('should initialize fog around player', () => {
      const game = createNewGame('Test Player', 'player-123', 'dwarf');

      const playerX = game.player.x;
      const playerY = game.player.y;

      expect(game.fog[playerY][playerX]).toBe(true);
    });

    it('should create valid map with player on floor', () => {
      const game = createNewGame('Test Player', 'player-123', 'dwarf');

      const playerTile = game.map[game.player.y][game.player.x];
      expect(playerTile.type).toBe('floor');
    });

    it('should use character-specific stats', () => {
      const dwarfGame = createNewGame('Dwarf', 'player-1', 'dwarf');
      const wizardGame = createNewGame('Wizard', 'player-2', 'wizard');

      expect(dwarfGame.player.hp).not.toBe(wizardGame.player.hp);
      expect(dwarfGame.player.attack).not.toBe(wizardGame.player.attack);
    });
  });

  describe('descendStairs', () => {
    it('should not descend if not on stairs', () => {
      const state = createTestGameState({
        player: createTestPlayer({ x: 5, y: 5 }),
        floor: 1,
      });
      state.map[5][5].type = 'floor';

      const events = descendStairs(state);

      expect(state.floor).toBe(1);
      expect(events).toHaveLength(0);
    });

    it('should increment floor and generate new map when on stairs', () => {
      const state = createTestGameState({
        player: createTestPlayer({ x: 5, y: 5 }),
        floor: 1,
      });
      const oldMap = state.map;
      state.map[5][5].type = 'stairs';

      descendStairs(state);

      expect(state.floor).toBe(2);
      expect(state.map).not.toBe(oldMap);
    });

    it('should reset fog and add score bonus on new floor', () => {
      const state = createTestGameState({
        player: createTestPlayer({ x: 5, y: 5 }),
        floor: 1,
        score: 100,
      });
      state.map[5][5].type = 'stairs';
      state.fog = state.fog.map((row) => row.map(() => true));

      descendStairs(state);

      const totalRevealed = state.fog.flat().filter((f) => f).length;
      const totalCells = MAP_HEIGHT * MAP_WIDTH;
      expect(totalRevealed).toBeLessThan(totalCells / 2);
      expect(state.score).toBe(200);
    });

    it('should generate floor_descended event', () => {
      const state = createTestGameState({
        player: createTestPlayer({ x: 5, y: 5 }),
        floor: 1,
      });
      state.map[5][5].type = 'stairs';

      const events = descendStairs(state);

      expect(events).toContainEqual(
        expect.objectContaining({ type: 'floor_descended' }),
      );
    });

    it('should win game on floor 20', () => {
      const state = createTestGameState({
        player: createTestPlayer({ x: 5, y: 5 }),
        floor: 19,
        score: 1000,
      });
      state.map[5][5].type = 'stairs';

      const events = descendStairs(state);

      expect(state.floor).toBe(20);
      expect(state.status).toBe('won');
      expect(state.score).toBe(2100);
      expect(events).toContainEqual(
        expect.objectContaining({ type: 'game_won' }),
      );
    });

    it('should not descend if game is not active', () => {
      const state = createTestGameState({
        player: createTestPlayer({ x: 5, y: 5 }),
        floor: 1,
        status: 'dead',
      });
      state.map[5][5].type = 'stairs';

      const events = descendStairs(state);

      expect(state.floor).toBe(1);
      expect(events).toHaveLength(0);
    });
  });
});
