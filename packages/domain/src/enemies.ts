import {
  type AIBehavior,
  ENEMY_STATS,
  type Enemy,
  type EnemyType,
  type EnemyVariant,
  VARIANT_MULTIPLIERS,
} from './model.js';
import type { RandomSource } from './random.js';

export function getEnemyVariant(
  floor: number,
  random: RandomSource,
): EnemyVariant {
  const roll = random.next();
  const eliteChance = Math.min(0.1 + floor * 0.05, 0.4);
  const championChance = Math.min(Math.max(0, (floor - 1) * 0.04), 0.2);

  if (roll < championChance) return 'champion';
  if (roll < championChance + eliteChance) return 'elite';
  return 'normal';
}

function getEnemyBehavior(type: EnemyType, random: RandomSource): AIBehavior {
  if (type === 'rat') return 'flee';
  if (type === 'dragon') return 'aggressive';
  return random.next() < 0.7 ? 'aggressive' : 'patrol';
}

export function createEnemy(
  id: string,
  type: EnemyType,
  x: number,
  y: number,
  floor: number,
  random: RandomSource,
): Enemy {
  const variant = getEnemyVariant(floor, random);
  const multiplier = VARIANT_MULTIPLIERS[variant];
  const base = ENEMY_STATS[type];

  return {
    id,
    type,
    variant,
    displayName: `${multiplier.namePrefix}${type.charAt(0).toUpperCase()}${type.slice(1)}`,
    x,
    y,
    hp: Math.floor(base.hp * multiplier.hpMult),
    maxHp: Math.floor(base.hp * multiplier.hpMult),
    attack: Math.floor(base.attack * multiplier.attackMult),
    defense: Math.floor(base.defense * multiplier.defenseMult),
    behavior: getEnemyBehavior(type, random),
  };
}
