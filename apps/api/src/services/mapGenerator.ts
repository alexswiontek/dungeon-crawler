import { randomUUID } from 'node:crypto';
import {
  type CharacterType,
  createSeededRandom,
  createVisibilityMask,
  generateDungeon,
} from '@dungeon-crawler/domain';

export function generateMap(floor: number, character: CharacterType = 'dwarf') {
  return generateDungeon(floor, character, createSeededRandom(randomUUID()));
}

export function initializeFog(): boolean[][] {
  return createVisibilityMask();
}
