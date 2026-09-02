import {
  CHARACTER_STATS,
  type CharacterType,
  type Equipment,
} from '@dungeon-crawler/shared';
import { describe, expect, it } from 'vitest';
import {
  descendStairs,
  getVisibleEnemies,
  getVisibleState,
  processAttack,
  processAttackWithDeltas,
  processMove,
} from '@/test/helpers/gameplayAdapters.js';
import {
  createTestEnemy,
  createTestGameState,
  createTestPlayer,
} from '@/test/helpers/gameStateHelpers.js';

const CHARACTERS: CharacterType[] = ['dwarf', 'elf', 'bandit', 'wizard'];

describe('pre-modernization gameplay characterization', () => {
  describe.each(CHARACTERS)('%s', (character) => {
    it('can move, attack at range, descend, and finish the game', () => {
      const state = createTestGameState({
        player: createTestPlayer({
          character,
          x: 5,
          y: 5,
          facingDirection: 'right',
        }),
      });

      const moveEvents = processMove(state, 'right');

      expect(state.player).toMatchObject({
        character,
        x: 6,
        y: 5,
        hp: CHARACTER_STATS[character].hp,
      });
      expect(moveEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'player_moved' }),
        ]),
      );

      const enemy = createTestEnemy('rat', {
        x: 7,
        y: 5,
        hp: 100,
        maxHp: 100,
        defense: 0,
        behavior: 'stationary',
      });
      state.enemies = [enemy];

      const attackEvents = processAttack(state);

      expect(enemy.hp).toBeLessThan(100);
      expect(attackEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'ranged_attack' }),
        ]),
      );

      state.enemies = [];
      state.map[state.player.y][state.player.x].type = 'stairs';
      const descendEvents = descendStairs(state);

      expect(state.floor).toBe(2);
      expect(descendEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'floor_descended' }),
        ]),
      );

      state.floor = 19;
      state.map[state.player.y][state.player.x].type = 'stairs';
      const finishEvents = descendStairs(state);

      expect(state.floor).toBe(20);
      expect(state.status).toBe('won');
      expect(finishEvents).toEqual(
        expect.arrayContaining([expect.objectContaining({ type: 'game_won' })]),
      );
    });
  });

  describe('illegal actions', () => {
    it('does not consume a turn when movement is blocked by a wall', () => {
      const updatedAt = new Date('2026-08-18T00:00:00.000Z');
      const state = createTestGameState({
        player: createTestPlayer({ x: 5, y: 5 }),
        updatedAt,
      });
      const enemy = createTestEnemy('orc', {
        x: 8,
        y: 5,
        behavior: 'aggressive',
      });
      state.enemies = [enemy];
      state.map[5][6].type = 'wall';

      const events = processMove(state, 'right');

      expect(events).toEqual([]);
      expect(state.player).toMatchObject({ x: 5, y: 5 });
      expect(enemy).toMatchObject({ x: 8, y: 5 });
      expect(state.updatedAt).toBe(updatedAt);
    });

    it('does not mutate a finished game', () => {
      const state = createTestGameState({ status: 'won' });
      const before = structuredClone(state);

      expect(processMove(state, 'right')).toEqual([]);
      expect(processAttack(state)).toEqual([]);
      expect(state).toEqual(before);
    });

    it('stops a ranged attack at a wall', () => {
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
        maxHp: 20,
        behavior: 'stationary',
      });
      state.enemies = [enemy];
      state.map[5][6].type = 'wall';

      const events = processAttack(state);

      expect(enemy.hp).toBe(20);
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'ranged_missed' }),
        ]),
      );
    });
  });

  describe('ranged damage', () => {
    it('uses base, equipment, and level scaling for authoritative damage', () => {
      const rangedEquipment: Equipment = {
        id: 'test-crossbow',
        slot: 'ranged',
        name: 'Test Crossbow',
        attackBonus: 0,
        defenseBonus: 0,
        hpBonus: 0,
        rangedDamageBonus: 2,
        rangedRangeBonus: 0,
        tier: 1,
      };
      const state = createTestGameState({
        player: createTestPlayer({
          character: 'bandit',
          level: 4,
          x: 5,
          y: 5,
          facingDirection: 'right',
          equipment: {
            weapon: null,
            shield: null,
            armor: null,
            ranged: rangedEquipment,
          },
        }),
      });
      const enemy = createTestEnemy('rat', {
        x: 7,
        y: 5,
        hp: 100,
        maxHp: 100,
        defense: 0,
        behavior: 'stationary',
      });
      state.enemies = [enemy];

      const events = processAttack(state);
      const rangedAttack = events.find(
        (event) => event.type === 'ranged_attack',
      );

      expect(enemy.hp).toBe(89);
      expect(rangedAttack?.data).toMatchObject({ damage: 11 });
    });
  });

  describe('visibility and projection', () => {
    it('filters entities and tiles that have never been revealed', () => {
      const state = createTestGameState();
      const visibleEnemy = createTestEnemy('rat', {
        id: 'visible',
        x: 6,
        y: 5,
      });
      const hiddenEnemy = createTestEnemy('orc', {
        id: 'hidden',
        x: 20,
        y: 10,
      });
      state.enemies = [visibleEnemy, hiddenEnemy];
      state.items = [
        {
          id: 'visible-item',
          type: 'health_potion',
          name: 'Visible Potion',
          x: 5,
          y: 5,
          value: 10,
        },
        {
          id: 'hidden-item',
          type: 'health_potion',
          name: 'Hidden Potion',
          x: 20,
          y: 10,
          value: 10,
        },
      ];
      state.explored[5][5] = true;
      state.explored[5][6] = true;
      state.visibleNow[5][5] = true;
      state.visibleNow[5][6] = true;

      const projection = getVisibleState(state);

      expect(projection.visibleEnemies.map((enemy) => enemy.id)).toEqual([
        'visible',
      ]);
      expect(projection.visibleItems.map((item) => item.id)).toEqual([
        'visible-item',
      ]);
      expect(projection.visibleTiles).toHaveLength(2);
      expect(projection).not.toHaveProperty('enemies');
      expect(projection).not.toHaveProperty('items');
      expect(projection).not.toHaveProperty('map');
    });

    it('keeps explored terrain and items while hiding enemies outside visibleNow', () => {
      const state = createTestGameState({
        player: createTestPlayer({ x: 20, y: 10 }),
      });
      const enemy = createTestEnemy('rat', { x: 5, y: 5 });
      state.enemies = [enemy];
      state.items = [
        {
          id: 'remembered-item',
          type: 'health_potion',
          name: 'Remembered Potion',
          x: 5,
          y: 5,
          value: 10,
        },
      ];
      state.explored[5][5] = true;
      state.visibleNow[5][5] = false;

      expect(getVisibleEnemies(state)).not.toContain(enemy);
      expect(getVisibleState(state).visibleTiles).toContainEqual(
        state.map[5][5],
      );
      expect(getVisibleState(state).visibleItems).toEqual(state.items);
    });

    it('projects an enemy that becomes visible after a ranged turn', () => {
      const state = createTestGameState({
        player: createTestPlayer({
          x: 5,
          y: 5,
          facingDirection: 'left',
        }),
      });
      const enemy = createTestEnemy('orc', {
        id: 'approaching-enemy',
        x: 9,
        y: 5,
        behavior: 'aggressive',
      });
      state.enemies = [enemy];
      state.explored[5][8] = true;
      state.visibleNow[5][8] = false;
      state.visibleNow[5][9] = false;

      const { deltas } = processAttackWithDeltas(state);

      expect(enemy).toMatchObject({ x: 8, y: 5 });
      expect(getVisibleEnemies(state)).toContain(enemy);
      expect(deltas).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'enemy_visible',
            enemy: expect.objectContaining({ id: enemy.id }),
          }),
        ]),
      );
    });
  });
});
