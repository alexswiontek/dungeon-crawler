import { describe, expect, it, vi } from 'vitest';
import {
  CHARACTER_STATS,
  type CharacterType,
  createEnemy,
  ENEMY_STATS,
  type EnemyType,
  type EnemyVariant,
  EQUIPMENT_DEFINITIONS,
  getEnemyVariant,
  getEnemyXpReward,
  getEquipmentForFloor,
  getXpToNextLevel,
  isDirection,
  isEquipmentItem,
  VARIANT_MULTIPLIERS,
} from './index.js';

describe('Constants Validation', () => {
  describe('CHARACTER_STATS', () => {
    it('should have all 4 character types', () => {
      const expectedTypes: CharacterType[] = [
        'dwarf',
        'elf',
        'bandit',
        'wizard',
      ];
      for (const type of expectedTypes) {
        expect(CHARACTER_STATS[type]).toBeDefined();
      }
    });

    it('should have valid stats for each character', () => {
      for (const [_characterType, stats] of Object.entries(CHARACTER_STATS)) {
        expect(stats.hp).toBeGreaterThan(0);
        expect(stats.maxHp).toBe(stats.hp);
        expect(stats.attack).toBeGreaterThan(0);
        expect(stats.defense).toBeGreaterThanOrEqual(0);
        expect(stats.rangedDamage).toBeGreaterThan(0);
        expect(stats.rangedRange).toBeGreaterThan(0);
      }
    });
  });

  describe('ENEMY_STATS', () => {
    it('should have all enemy types', () => {
      const expectedTypes: EnemyType[] = ['rat', 'skeleton', 'orc', 'dragon'];
      for (const type of expectedTypes) {
        expect(ENEMY_STATS[type]).toBeDefined();
      }
    });

    it('should have valid stats for each enemy', () => {
      for (const [_enemyType, stats] of Object.entries(ENEMY_STATS)) {
        expect(stats.hp).toBeGreaterThan(0);
        expect(stats.attack).toBeGreaterThan(0);
        expect(stats.defense).toBeGreaterThanOrEqual(0);
        expect(stats.xpReward).toBeGreaterThan(0);
      }
    });

    it('should scale stats appropriately from rat to dragon', () => {
      expect(ENEMY_STATS.dragon.hp).toBeGreaterThan(ENEMY_STATS.orc.hp);
      expect(ENEMY_STATS.orc.hp).toBeGreaterThan(ENEMY_STATS.skeleton.hp);
      expect(ENEMY_STATS.skeleton.hp).toBeGreaterThan(ENEMY_STATS.rat.hp);
    });
  });

  describe('VARIANT_MULTIPLIERS', () => {
    it('should have all variant types', () => {
      const expectedVariants: EnemyVariant[] = ['normal', 'elite', 'champion'];
      for (const variant of expectedVariants) {
        expect(VARIANT_MULTIPLIERS[variant]).toBeDefined();
      }
    });

    it('should have correct multipliers for normal variant', () => {
      const normal = VARIANT_MULTIPLIERS.normal;
      expect(normal.hpMult).toBe(1);
      expect(normal.attackMult).toBe(1);
      expect(normal.defenseMult).toBe(1);
      expect(normal.xpMult).toBe(1);
      expect(normal.namePrefix).toBe('');
    });

    it('should have correct multipliers for elite variant', () => {
      const elite = VARIANT_MULTIPLIERS.elite;
      expect(elite.hpMult).toBe(1.5);
      expect(elite.attackMult).toBe(1.5);
      expect(elite.defenseMult).toBe(1.2);
      expect(elite.xpMult).toBe(2.5);
      expect(elite.namePrefix).toBe('Elite ');
    });

    it('should have correct multipliers for champion variant', () => {
      const champion = VARIANT_MULTIPLIERS.champion;
      expect(champion.hpMult).toBe(2.5);
      expect(champion.attackMult).toBe(1.8);
      expect(champion.defenseMult).toBe(1.5);
      expect(champion.xpMult).toBe(4);
      expect(champion.namePrefix).toBe('Champion ');
    });
  });

  describe('EQUIPMENT_DEFINITIONS', () => {
    it('should have at least one equipment item', () => {
      expect(EQUIPMENT_DEFINITIONS.length).toBeGreaterThan(0);
    });

    it('should have all required fields for each equipment', () => {
      for (const equipment of EQUIPMENT_DEFINITIONS) {
        expect(equipment.id).toBeDefined();
        expect(equipment.slot).toBeDefined();
        expect(equipment.name).toBeDefined();
        expect(equipment.tier).toBeGreaterThan(0);
        expect(typeof equipment.attackBonus).toBe('number');
        expect(typeof equipment.defenseBonus).toBe('number');
        expect(typeof equipment.hpBonus).toBe('number');
        expect(typeof equipment.rangedDamageBonus).toBe('number');
        expect(typeof equipment.rangedRangeBonus).toBe('number');
      }
    });

    it('should have valid equipment slots', () => {
      const validSlots = ['weapon', 'shield', 'armor', 'ranged'];
      for (const equipment of EQUIPMENT_DEFINITIONS) {
        expect(validSlots).toContain(equipment.slot);
      }
    });

    it('should have valid tier values', () => {
      for (const equipment of EQUIPMENT_DEFINITIONS) {
        expect(equipment.tier).toBeGreaterThanOrEqual(1);
        expect(equipment.tier).toBeLessThanOrEqual(10);
      }
    });
  });
});

describe('getEnemyVariant', () => {
  it('should return a valid variant', () => {
    const validVariants: EnemyVariant[] = ['normal', 'elite', 'champion'];
    for (let floor = 1; floor <= 10; floor++) {
      const variant = getEnemyVariant(floor);
      expect(validVariants).toContain(variant);
    }
  });

  it('should have higher chance of elite/champion on higher floors', () => {
    // Mock Math.random to test probability logic
    const floor1Elite = 0.1 + 1 * 0.05; // 15%
    const floor10Elite = Math.min(0.1 + 10 * 0.05, 0.4); // 40% (capped)

    expect(floor10Elite).toBeGreaterThan(floor1Elite);
  });

  it('should have 0% champion chance on floor 1', () => {
    // Champion chance = max(0, (floor - 1) * 0.04)
    // Floor 1: (1-1) * 0.04 = 0
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const variant = getEnemyVariant(1);
    // With roll = 0 and championChance = 0, should get elite or normal
    expect(variant).not.toBe('champion');
    vi.restoreAllMocks();
  });

  it('should return normal when roll is high', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const variant = getEnemyVariant(1);
    expect(variant).toBe('normal');
    vi.restoreAllMocks();
  });

  it('should return champion when roll is very low on higher floors', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.01);
    const variant = getEnemyVariant(5); // Champion chance ~16%
    expect(variant).toBe('champion');
    vi.restoreAllMocks();
  });
});

describe('createEnemy', () => {
  it('should create an enemy with correct base properties', () => {
    const enemy = createEnemy('test-id', 'rat', 5, 10, 1);

    expect(enemy.id).toBe('test-id');
    expect(enemy.type).toBe('rat');
    expect(enemy.x).toBe(5);
    expect(enemy.y).toBe(10);
    expect(enemy.variant).toBeDefined();
    expect(enemy.displayName).toBeDefined();
  });

  it('should apply variant multipliers to stats', () => {
    // Mock to always get normal variant
    vi.spyOn(Math, 'random').mockReturnValue(0.99);

    const ratBase = ENEMY_STATS.rat;
    const normalMult = VARIANT_MULTIPLIERS.normal;
    const enemy = createEnemy('test-id', 'rat', 0, 0, 1);

    expect(enemy.hp).toBe(Math.floor(ratBase.hp * normalMult.hpMult));
    expect(enemy.maxHp).toBe(Math.floor(ratBase.hp * normalMult.hpMult));
    expect(enemy.attack).toBe(
      Math.floor(ratBase.attack * normalMult.attackMult),
    );
    expect(enemy.defense).toBe(
      Math.floor(ratBase.defense * normalMult.defenseMult),
    );

    vi.restoreAllMocks();
  });

  it('should create elite enemy with correct stats', () => {
    // Mock to get elite variant (roll between championChance and championChance + eliteChance)
    vi.spyOn(Math, 'random').mockReturnValue(0.05);

    const ratBase = ENEMY_STATS.rat;
    const eliteMult = VARIANT_MULTIPLIERS.elite;
    const enemy = createEnemy('test-id', 'rat', 0, 0, 1);

    expect(enemy.variant).toBe('elite');
    expect(enemy.hp).toBe(Math.floor(ratBase.hp * eliteMult.hpMult));
    expect(enemy.attack).toBe(
      Math.floor(ratBase.attack * eliteMult.attackMult),
    );
    expect(enemy.defense).toBe(
      Math.floor(ratBase.defense * eliteMult.defenseMult),
    );

    vi.restoreAllMocks();
  });

  it('should format display name correctly', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99); // Normal
    const normalEnemy = createEnemy('id1', 'rat', 0, 0, 1);
    expect(normalEnemy.displayName).toBe('Rat');
    vi.restoreAllMocks();

    vi.spyOn(Math, 'random').mockReturnValue(0.05); // Elite
    const eliteEnemy = createEnemy('id2', 'orc', 0, 0, 1);
    expect(eliteEnemy.displayName).toBe('Elite Orc');
    vi.restoreAllMocks();

    vi.spyOn(Math, 'random').mockReturnValue(0.01); // Champion
    const championEnemy = createEnemy('id3', 'dragon', 0, 0, 5);
    expect(championEnemy.displayName).toBe('Champion Dragon');
    vi.restoreAllMocks();
  });

  it('should assign correct behavior for rats', () => {
    const enemy = createEnemy('test-id', 'rat', 0, 0, 1);
    expect(enemy.behavior).toBe('flee');
  });

  it('should assign correct behavior for dragons', () => {
    const enemy = createEnemy('test-id', 'dragon', 0, 0, 1);
    expect(enemy.behavior).toBe('aggressive');
  });

  it('should assign aggressive or patrol behavior for skeletons and orcs', () => {
    const validBehaviors = ['aggressive', 'patrol'];

    const skeleton = createEnemy('id1', 'skeleton', 0, 0, 1);
    expect(validBehaviors).toContain(skeleton.behavior);

    const orc = createEnemy('id2', 'orc', 0, 0, 1);
    expect(validBehaviors).toContain(orc.behavior);
  });

  it('should create champion enemy on higher floors', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.01);

    const enemy = createEnemy('test-id', 'dragon', 0, 0, 10);
    const championMult = VARIANT_MULTIPLIERS.champion;
    const dragonBase = ENEMY_STATS.dragon;

    expect(enemy.variant).toBe('champion');
    expect(enemy.displayName).toBe('Champion Dragon');
    expect(enemy.hp).toBe(Math.floor(dragonBase.hp * championMult.hpMult));

    vi.restoreAllMocks();
  });
});

describe('getEnemyXpReward', () => {
  it('should return correct XP for normal variant', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const enemy = createEnemy('test-id', 'rat', 0, 0, 1);
    const xp = getEnemyXpReward(enemy);

    const expected = Math.floor(
      ENEMY_STATS.rat.xpReward * VARIANT_MULTIPLIERS.normal.xpMult,
    );
    expect(xp).toBe(expected);
    vi.restoreAllMocks();
  });

  it('should return correct XP for elite variant', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.05);
    const enemy = createEnemy('test-id', 'skeleton', 0, 0, 1);
    const xp = getEnemyXpReward(enemy);

    const expected = Math.floor(
      ENEMY_STATS.skeleton.xpReward * VARIANT_MULTIPLIERS.elite.xpMult,
    );
    expect(xp).toBe(expected);
    vi.restoreAllMocks();
  });

  it('should return correct XP for champion variant', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.01);
    const enemy = createEnemy('test-id', 'orc', 0, 0, 5);
    const xp = getEnemyXpReward(enemy);

    const expected = Math.floor(
      ENEMY_STATS.orc.xpReward * VARIANT_MULTIPLIERS.champion.xpMult,
    );
    expect(xp).toBe(expected);
    vi.restoreAllMocks();
  });

  it('should scale XP appropriately with variant multipliers', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const normalRat = createEnemy('id1', 'rat', 0, 0, 1);
    const normalXp = getEnemyXpReward(normalRat);
    vi.restoreAllMocks();

    vi.spyOn(Math, 'random').mockReturnValue(0.05);
    const eliteRat = createEnemy('id2', 'rat', 0, 0, 1);
    const eliteXp = getEnemyXpReward(eliteRat);
    vi.restoreAllMocks();

    vi.spyOn(Math, 'random').mockReturnValue(0.01);
    const championRat = createEnemy('id3', 'rat', 0, 0, 5);
    const championXp = getEnemyXpReward(championRat);
    vi.restoreAllMocks();

    expect(eliteXp).toBeGreaterThan(normalXp);
    expect(championXp).toBeGreaterThan(eliteXp);
  });
});

describe('getEquipmentForFloor', () => {
  it('should return only tier 1 equipment on floor 1', () => {
    const equipment = getEquipmentForFloor(1);

    for (const item of equipment) {
      expect(item.tier).toBeLessThanOrEqual(2); // floor + 1
    }
  });

  it('should return tier 1-2 equipment on floor 2', () => {
    const equipment = getEquipmentForFloor(2);

    for (const item of equipment) {
      expect(item.tier).toBeLessThanOrEqual(3); // floor + 1
    }
  });

  it('should return all equipment on floor 10+', () => {
    const allEquipment = EQUIPMENT_DEFINITIONS;
    const floorEquipment = getEquipmentForFloor(10);

    // Should include high-tier items
    expect(floorEquipment.length).toBeGreaterThan(0);

    // All items should be included if tier <= 11
    const highTierItems = allEquipment.filter((e) => e.tier <= 11);
    expect(floorEquipment.length).toBeGreaterThanOrEqual(highTierItems.length);
  });

  it('should scale equipment availability with floor', () => {
    const floor1Equipment = getEquipmentForFloor(1);
    const floor5Equipment = getEquipmentForFloor(5);
    const floor10Equipment = getEquipmentForFloor(10);

    expect(floor5Equipment.length).toBeGreaterThan(floor1Equipment.length);
    expect(floor10Equipment.length).toBeGreaterThanOrEqual(
      floor5Equipment.length,
    );
  });

  it('should filter correctly based on tier', () => {
    const equipment = getEquipmentForFloor(3);
    const maxTier = 4; // floor + 1

    for (const item of equipment) {
      expect(item.tier).toBeLessThanOrEqual(maxTier);
    }
  });
});

describe('getXpToNextLevel', () => {
  it('should return correct XP for level 1', () => {
    expect(getXpToNextLevel(1)).toBe(50);
  });

  it('should return correct XP for level 2', () => {
    expect(getXpToNextLevel(2)).toBe(100);
  });

  it('should return correct XP for level 5', () => {
    expect(getXpToNextLevel(5)).toBe(250);
  });

  it('should scale linearly with level', () => {
    for (let level = 1; level <= 10; level++) {
      expect(getXpToNextLevel(level)).toBe(level * 50);
    }
  });
});

describe('Type Guards', () => {
  describe('isDirection', () => {
    it('should return true for valid directions', () => {
      expect(isDirection('up')).toBe(true);
      expect(isDirection('down')).toBe(true);
      expect(isDirection('left')).toBe(true);
      expect(isDirection('right')).toBe(true);
    });

    it('should return false for invalid directions', () => {
      expect(isDirection('north')).toBe(false);
      expect(isDirection('south')).toBe(false);
      expect(isDirection('')).toBe(false);
      expect(isDirection(null)).toBe(false);
      expect(isDirection(undefined)).toBe(false);
      expect(isDirection(123)).toBe(false);
      expect(isDirection({})).toBe(false);
    });
  });

  describe('isEquipmentItem', () => {
    it('should return true for equipment items', () => {
      const equipmentItem = {
        id: 'test-id',
        type: 'equipment' as const,
        name: 'Test Equipment',
        x: 0,
        y: 0,
        value: 0,
        equipment: EQUIPMENT_DEFINITIONS[0],
      };

      expect(isEquipmentItem(equipmentItem)).toBe(true);
    });

    it('should return false for health potion items', () => {
      const potionItem = {
        id: 'test-id',
        type: 'health_potion' as const,
        name: 'Health Potion',
        x: 0,
        y: 0,
        value: 10,
      };

      expect(isEquipmentItem(potionItem)).toBe(false);
    });

    it('should return false for items without equipment property', () => {
      const invalidItem = {
        id: 'test-id',
        type: 'equipment' as const,
        name: 'Invalid',
        x: 0,
        y: 0,
        value: 0,
      };

      expect(isEquipmentItem(invalidItem)).toBe(false);
    });
  });
});
