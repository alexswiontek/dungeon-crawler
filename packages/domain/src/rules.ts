import type { CharacterType, EnemyType } from './model.js';

export const LEVEL_UP_HP_GAIN = 3;
export const LEVEL_UP_ATTACK_GAIN = 1;
export const LEVEL_UP_DEFENSE_GAIN = 1;
export const LEVEL_UP_HEAL_PERCENTAGE = 0.5;
export const MAX_FLOOR = 20;
export const FLOOR_DESCEND_SCORE_BONUS = 100;
export const VICTORY_SCORE_BONUS = 1000;
export const MAX_PATHFINDING_ENEMIES = 5;
export const FLEE_HP_THRESHOLD = 0.3;

export const ENEMY_SCORES: Record<EnemyType, number> = {
  rat: 10,
  skeleton: 25,
  orc: 50,
  dragon: 200,
};

const ATTACK_CONFIG: Record<
  CharacterType,
  {
    attackType: 'bolt' | 'dagger' | 'magic_dagger' | 'spell';
    hitVerb: string;
    missMessage: string;
  }
> = {
  bandit: {
    attackType: 'bolt',
    hitVerb: 'Your bolt hits',
    missMessage: 'Your bolt missed!',
  },
  wizard: {
    attackType: 'spell',
    hitVerb: 'Your spell blasts',
    missMessage: 'Your spell missed!',
  },
  elf: {
    attackType: 'magic_dagger',
    hitVerb: 'Your magic dagger strikes',
    missMessage: 'Your magic dagger missed!',
  },
  dwarf: {
    attackType: 'dagger',
    hitVerb: 'Your dagger strikes',
    missMessage: 'Your dagger missed!',
  },
};

export function getAttackType(character: CharacterType) {
  return ATTACK_CONFIG[character].attackType;
}

export function getAttackVerb(character: CharacterType): string {
  return ATTACK_CONFIG[character].hitVerb;
}

export function getMissMessage(character: CharacterType): string {
  return ATTACK_CONFIG[character].missMessage;
}
