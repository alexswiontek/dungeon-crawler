import { CHARACTER_STATS, type Enemy, type Player } from './model.js';

export function calculateDamage(attackPower: number, defense: number): number {
  return Math.max(1, attackPower - defense);
}

export function calculatePlayerMeleeDamage(
  playerAttack: number,
  enemy: Enemy,
): number {
  return calculateDamage(playerAttack, enemy.defense);
}

export function calculateRangedAttackPower(player: Player): number {
  const baseDamage = CHARACTER_STATS[player.character].rangedDamage;
  const equipmentBonus = player.equipment.ranged?.rangedDamageBonus ?? 0;
  return baseDamage + equipmentBonus + Math.max(0, player.level - 1);
}

export function calculatePlayerRangedDamage(
  player: Player,
  enemy: Enemy,
): number {
  return calculateDamage(calculateRangedAttackPower(player), enemy.defense);
}

export function calculateEnemyDamage(
  enemy: Enemy,
  playerDefense: number,
): number {
  return calculateDamage(enemy.attack, playerDefense);
}
