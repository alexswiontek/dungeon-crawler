/**
 * Combat calculation utilities
 * Eliminates damage calculation duplication (3 occurrences)
 */
import type { Enemy } from '@dungeon-crawler/shared';

/**
 * Base damage calculation formula
 * Formula: max(1, attackPower - defense)
 * Ensures minimum damage of 1
 *
 * @param attackPower - Attack power of the attacker
 * @param defense - Defense of the defender
 * @returns Damage dealt (minimum 1)
 */
export function calculateDamage(attackPower: number, defense: number): number {
  return Math.max(1, attackPower - defense);
}

/**
 * Calculate damage for player melee attack against an enemy
 *
 * @param playerAttack - Player's attack stat
 * @param enemy - Enemy being attacked
 * @returns Damage dealt to enemy
 */
export function calculatePlayerMeleeDamage(
  playerAttack: number,
  enemy: Enemy,
): number {
  return calculateDamage(playerAttack, enemy.defense);
}

/**
 * Calculate damage for player ranged attack against an enemy
 *
 * @param rangedDamage - Player's ranged damage stat
 * @param enemy - Enemy being attacked
 * @returns Damage dealt to enemy
 */
export function calculatePlayerRangedDamage(
  rangedDamage: number,
  enemy: Enemy,
): number {
  return calculateDamage(rangedDamage, enemy.defense);
}

/**
 * Calculate damage for enemy attack against player
 *
 * @param enemy - Enemy attacking
 * @param playerDefense - Player's defense stat
 * @returns Damage dealt to player
 */
export function calculateEnemyDamage(
  enemy: Enemy,
  playerDefense: number,
): number {
  return calculateDamage(enemy.attack, playerDefense);
}
