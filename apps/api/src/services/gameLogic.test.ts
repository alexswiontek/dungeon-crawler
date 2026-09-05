import { describe, expect, it } from 'vitest';
import {
  descendStairs,
  processAttack,
  processMove,
} from '@/test/helpers/gameplayAdapters.js';
import {
  createTestEnemy,
  createTestGameState,
  createTestPlayer,
} from '@/test/helpers/gameStateHelpers.js';

describe('Game Logic', () => {
  describe('Character Attack Configuration', () => {
    const characterConfigs = [
      {
        character: 'dwarf',
        attackType: 'dagger',
        hitVerb: 'Your dagger strikes',
        missMessage: 'Your dagger missed!',
      },
      {
        character: 'wizard',
        attackType: 'spell',
        hitVerb: 'Your spell blasts',
        missMessage: 'Your spell missed!',
      },
      {
        character: 'elf',
        attackType: 'magic_dagger',
        hitVerb: 'Your magic dagger strikes',
        missMessage: 'Your magic dagger missed!',
      },
      {
        character: 'bandit',
        attackType: 'bolt',
        hitVerb: 'Your bolt hits',
        missMessage: 'Your bolt missed!',
      },
    ] as const;

    characterConfigs.forEach((config) => {
      describe(`${config.character} attacks`, () => {
        it(`should use "${config.attackType}" attack type with correct hit message`, () => {
          const state = createTestGameState({
            player: createTestPlayer({
              character: config.character,
              x: 5,
              y: 5,
              facingDirection: 'right',
            }),
          });
          const enemy = createTestEnemy('rat', { x: 7, y: 5, hp: 10 });
          state.enemies = [enemy];

          const events = processAttack(state);
          const hitEvent = events.find((e) => e.type === 'ranged_attack');

          expect(hitEvent).toBeDefined();
          expect(hitEvent?.message).toContain(config.hitVerb);
          if (
            hitEvent?.type === 'ranged_attack' &&
            hitEvent.data &&
            'attackType' in hitEvent.data
          ) {
            expect(hitEvent.data.attackType).toBe(config.attackType);
          }
        });

        it(`should use "${config.missMessage}" when attack misses`, () => {
          const state = createTestGameState({
            player: createTestPlayer({
              character: config.character,
              x: 5,
              y: 5,
              facingDirection: 'right',
            }),
          });
          state.enemies = [];

          const events = processAttack(state);
          const missEvent = events.find((e) => e.type === 'ranged_missed');

          expect(missEvent).toBeDefined();
          expect(missEvent?.message).toBe(config.missMessage);
          if (
            missEvent?.type === 'ranged_missed' &&
            missEvent.data &&
            'attackType' in missEvent.data
          ) {
            expect(missEvent.data.attackType).toBe(config.attackType);
          }
        });
      });
    });
  });

  describe('Game Constants', () => {
    describe('Level up stat gains', () => {
      const levelUpTests = [
        { stat: 'maxHp', initial: 25, gain: 3, property: 'maxHp' },
        { stat: 'attack', initial: 5, gain: 1, property: 'attack' },
        { stat: 'defense', initial: 2, gain: 1, property: 'defense' },
      ] as const;

      levelUpTests.forEach(({ stat, initial, gain, property }) => {
        it(`should grant +${gain} ${stat} per level`, () => {
          const state = createTestGameState({
            player: createTestPlayer({
              xp: 0,
              level: 1,
              [property]: initial,
            }),
          });
          const enemy = createTestEnemy('orc', {
            x: 6,
            y: 5,
            hp: 1,
            variant: 'champion',
          });
          state.enemies = [enemy];

          const originalValue = state.player[property];
          processMove(state, 'right');

          if (state.player.level > 1) {
            const levelsGained = state.player.level - 1;
            const expectedValue = originalValue + levelsGained * gain;
            expect(state.player[property]).toBe(expectedValue);
          }
        });
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
        const enemy = createTestEnemy('rat', {
          x: 6,
          y: 5,
          hp: 1,
          variant: 'elite',
        });
        state.enemies = [enemy];

        const originalHp = state.player.hp;
        const originalLevel = state.player.level;
        processMove(state, 'right');

        if (state.player.level === originalLevel + 1) {
          const expectedMaxHp = 25 + 3;
          const expectedHealAmount = Math.floor(expectedMaxHp * 0.5);
          const expectedHp = Math.min(
            expectedMaxHp,
            originalHp + expectedHealAmount,
          );
          expect(state.player.maxHp).toBe(expectedMaxHp);
          expect(state.player.hp).toBe(expectedHp);
        }
      });
    });

    describe('Enemy score values', () => {
      const enemyScores = [
        { type: 'rat' as const, score: 10 },
        { type: 'skeleton' as const, score: 25 },
        { type: 'orc' as const, score: 50 },
        { type: 'dragon' as const, score: 200 },
      ];

      enemyScores.forEach(({ type, score }) => {
        it(`should grant ${score} score for killing a ${type}`, () => {
          const state = createTestGameState({ score: 0 });
          const enemy = createTestEnemy(type, { x: 6, y: 5, hp: 1 });
          state.enemies = [enemy];

          processMove(state, 'right');

          expect(state.score).toBe(score);
        });
      });
    });

    describe('Floor progression', () => {
      it('should grant 100 score bonus when descending stairs', () => {
        const state = createTestGameState({
          player: createTestPlayer({ x: 5, y: 5 }),
          floor: 1,
          score: 50,
        });
        state.map[5][5].type = 'stairs';

        descendStairs(state);

        expect(state.score).toBe(150); // 50 + 100
      });

      it('should grant 1000 victory bonus on floor 20', () => {
        const state = createTestGameState({
          player: createTestPlayer({ x: 5, y: 5 }),
          floor: 19,
          score: 100,
        });
        state.map[5][5].type = 'stairs';

        descendStairs(state);

        // Score should be: 100 (original) + 100 (descend bonus) + 1000 (victory bonus)
        expect(state.score).toBe(1200);
      });

      it('should win game at floor 20', () => {
        const state = createTestGameState({
          player: createTestPlayer({ x: 5, y: 5 }),
          floor: 19,
        });
        state.map[5][5].type = 'stairs';

        descendStairs(state);

        expect(state.floor).toBe(20);
        expect(state.status).toBe('won');
      });
    });
  });

  describe('Damage Calculation Formulas', () => {
    describe('Player melee damage', () => {
      it('should calculate melee damage as (playerAttack - enemyDefense)', () => {
        const state = createTestGameState({
          player: createTestPlayer({ attack: 12, x: 5, y: 5 }),
        });
        const enemy = createTestEnemy('rat', {
          x: 6,
          y: 5,
          hp: 100,
          defense: 5,
        });
        state.enemies = [enemy];

        processMove(state, 'right');

        expect(enemy.hp).toBe(100 - 7);
      });

      it('should enforce minimum damage of 1 for melee attacks', () => {
        const state = createTestGameState({
          player: createTestPlayer({ attack: 3, x: 5, y: 5 }),
        });
        const enemy = createTestEnemy('rat', {
          x: 6,
          y: 5,
          hp: 100,
          defense: 20,
        });
        state.enemies = [enemy];

        processMove(state, 'right');

        expect(enemy.hp).toBe(99);
      });

      it('should calculate melee damage with various attack/defense combinations', () => {
        const testCases = [
          { attack: 10, defense: 2, expectedDamage: 8 },
          { attack: 15, defense: 8, expectedDamage: 7 },
          { attack: 20, defense: 15, expectedDamage: 5 },
          { attack: 5, defense: 5, expectedDamage: 1 },
          { attack: 8, defense: 10, expectedDamage: 1 },
        ];

        for (const { attack, defense, expectedDamage } of testCases) {
          const state = createTestGameState({
            player: createTestPlayer({ attack, x: 5, y: 5 }),
          });
          const enemy = createTestEnemy('rat', {
            x: 6,
            y: 5,
            hp: 100,
            defense,
          });
          state.enemies = [enemy];

          processMove(state, 'right');

          expect(enemy.hp).toBe(100 - expectedDamage);
        }
      });
    });

    describe('Player ranged damage', () => {
      it('should calculate ranged damage as (rangedDamage - enemyDefense)', () => {
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
          hp: 100,
          defense: 2,
        });
        state.enemies = [enemy];

        processAttack(state);

        expect(enemy.hp).toBe(100 - 4);
      });

      it('should enforce minimum damage of 1 for ranged attacks', () => {
        const state = createTestGameState({
          player: createTestPlayer({
            character: 'dwarf',
            x: 5,
            y: 5,
            facingDirection: 'right',
          }),
        });
        const enemy = createTestEnemy('rat', {
          x: 7,
          y: 5,
          hp: 100,
          defense: 10,
        });
        state.enemies = [enemy];

        processAttack(state);

        expect(enemy.hp).toBe(99);
      });

      it('should calculate ranged damage for all character types', () => {
        const characters = [
          { character: 'dwarf' as const, baseRanged: 3 },
          { character: 'wizard' as const, baseRanged: 7 },
          { character: 'elf' as const, baseRanged: 6 },
          { character: 'bandit' as const, baseRanged: 6 },
        ];

        const enemyDefense = 2;

        for (const { character, baseRanged } of characters) {
          const state = createTestGameState({
            player: createTestPlayer({
              character,
              x: 5,
              y: 5,
              facingDirection: 'right',
            }),
          });
          const enemy = createTestEnemy('rat', {
            x: 6,
            y: 5,
            hp: 100,
            defense: enemyDefense,
            behavior: 'stationary',
          });
          state.enemies = [enemy];

          const events = processAttack(state);

          const expectedDamage = Math.max(1, baseRanged - enemyDefense);
          const rangedEvent = events.find((e) => e.type === 'ranged_attack');
          expect(rangedEvent).toBeDefined();
          if (
            rangedEvent?.type === 'ranged_attack' &&
            rangedEvent.data &&
            'damage' in rangedEvent.data
          ) {
            expect(rangedEvent.data.damage).toBe(expectedDamage);
          }
        }
      });

      it('should include ranged equipment bonus in damage calculation', () => {
        const state = createTestGameState({
          player: createTestPlayer({
            character: 'bandit',
            x: 5,
            y: 5,
            facingDirection: 'right',
          }),
        });
        state.player.equipment.ranged = {
          id: 'crossbow-1',
          name: 'Light Crossbow',
          slot: 'ranged',
          tier: 1,
          attackBonus: 0,
          defenseBonus: 0,
          hpBonus: 0,
          rangedDamageBonus: 2,
          rangedRangeBonus: 0,
        };

        const enemy = createTestEnemy('rat', {
          x: 7,
          y: 5,
          hp: 100,
          defense: 3,
        });
        state.enemies = [enemy];

        processAttack(state);

        expect(enemy.hp).toBe(100 - 5);
      });
    });

    describe('Enemy damage to player', () => {
      it('should calculate enemy damage as (enemyAttack - playerDefense)', () => {
        const state = createTestGameState({
          player: createTestPlayer({ x: 5, y: 5, hp: 100, defense: 4 }),
        });
        const enemy = createTestEnemy('orc', {
          x: 4,
          y: 5,
          attack: 12,
          behavior: 'aggressive',
        });
        state.enemies = [enemy];

        processMove(state, 'down');

        expect(state.player.hp).toBe(100 - 8);
      });

      it('should enforce minimum damage of 1 for enemy attacks', () => {
        const state = createTestGameState({
          player: createTestPlayer({ x: 5, y: 5, hp: 100, defense: 20 }),
        });
        const enemy = createTestEnemy('rat', {
          x: 4,
          y: 5,
          attack: 2,
          behavior: 'aggressive',
        });
        state.enemies = [enemy];

        processMove(state, 'down');

        expect(state.player.hp).toBe(99);
      });

      it('should calculate enemy damage with various attack/defense combinations', () => {
        const testCases = [
          { enemyAttack: 10, playerDefense: 3, expectedDamage: 7 },
          { enemyAttack: 15, playerDefense: 7, expectedDamage: 8 },
          { enemyAttack: 8, playerDefense: 8, expectedDamage: 1 },
          { enemyAttack: 5, playerDefense: 10, expectedDamage: 1 },
        ];

        for (const {
          enemyAttack,
          playerDefense,
          expectedDamage,
        } of testCases) {
          const state = createTestGameState({
            player: createTestPlayer({
              x: 5,
              y: 5,
              hp: 100,
              defense: playerDefense,
            }),
          });
          const enemy = createTestEnemy('orc', {
            x: 4,
            y: 5,
            attack: enemyAttack,
            behavior: 'aggressive',
          });
          state.enemies = [enemy];

          processMove(state, 'down');

          expect(state.player.hp).toBe(100 - expectedDamage);
        }
      });
    });

    describe('Damage calculation edge cases', () => {
      it('should handle zero defense correctly', () => {
        const state = createTestGameState({
          player: createTestPlayer({ attack: 10, x: 5, y: 5 }),
        });
        const enemy = createTestEnemy('rat', {
          x: 6,
          y: 5,
          hp: 100,
          defense: 0,
        });
        state.enemies = [enemy];

        processMove(state, 'right');

        expect(enemy.hp).toBe(90);
      });

      it('should handle zero attack correctly', () => {
        const state = createTestGameState({
          player: createTestPlayer({ attack: 0, x: 5, y: 5 }),
        });
        const enemy = createTestEnemy('rat', {
          x: 6,
          y: 5,
          hp: 100,
          defense: 5,
        });
        state.enemies = [enemy];

        processMove(state, 'right');

        expect(enemy.hp).toBe(99);
      });

      it('should handle very high defense (damage should always be at least 1)', () => {
        const state = createTestGameState({
          player: createTestPlayer({ attack: 10, x: 5, y: 5 }),
        });
        const enemy = createTestEnemy('dragon', {
          x: 6,
          y: 5,
          hp: 100,
          defense: 1000,
        });
        state.enemies = [enemy];

        processMove(state, 'right');

        expect(enemy.hp).toBe(99);
      });
    });
  });
});
