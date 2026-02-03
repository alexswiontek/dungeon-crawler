/**
 * Character attack configuration
 * Eliminates 3 duplicate switch statements for character attack config
 */
import type { CharacterType } from '@dungeon-crawler/shared';

/**
 * Attack types for different character classes
 */
export type AttackType = 'bolt' | 'dagger' | 'magic_dagger' | 'spell';

/**
 * Configuration for character attack behavior
 */
interface CharacterAttackConfig {
  attackType: AttackType;
  hitVerb: string;
  missMessage: string;
}

/**
 * Complete attack configuration for all character types
 */
const CHARACTER_ATTACK_CONFIG: Record<CharacterType, CharacterAttackConfig> = {
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

/**
 * Get the attack type for a character
 *
 * @param character - Character type
 * @returns Attack animation type
 */
export function getAttackType(character: CharacterType): AttackType {
  return CHARACTER_ATTACK_CONFIG[character].attackType;
}

/**
 * Get the hit message verb for a character's attack
 *
 * @param character - Character type
 * @returns Hit verb (e.g., "Your bolt hits", "Your spell blasts")
 */
export function getAttackVerb(character: CharacterType): string {
  return CHARACTER_ATTACK_CONFIG[character].hitVerb;
}

/**
 * Get the miss message for a character's attack
 *
 * @param character - Character type
 * @returns Miss message (e.g., "Your bolt missed!")
 */
export function getMissMessage(character: CharacterType): string {
  return CHARACTER_ATTACK_CONFIG[character].missMessage;
}
