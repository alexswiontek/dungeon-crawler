// Sprite configuration for the dungeon crawler game
// All sprites are 32x32 pixels from the 32rogues asset pack

import type { CharacterType, Coordinate } from '@dungeon-crawler/shared';

export const TILE_SIZE = 32;

// Helper to convert row.col notation to pixel coordinates
// Row numbers are 1-indexed, columns are letters (a=0, b=1, etc.)
function pos(row: number, col: number): Coordinate {
  return { x: col * TILE_SIZE, y: (row - 1) * TILE_SIZE };
}

// Character sprites from rogues.png (224x224, 7x7 grid)
export const CHARACTER_SPRITES = {
  dwarf: pos(1, 0), // 1.a
  elf: pos(1, 1), // 1.b
  bandit: pos(1, 4), // 1.e
  wizard: pos(5, 1), // 5.a
} as const;

// CharacterType is imported from @dungeon-crawler/shared

// Monster sprites from monsters.png (384x416, 12x13 grid)
export const MONSTER_SPRITES = {
  // Rats
  rat: pos(7, 11), // 7.l. giant rat

  // Skeletons (row 5)
  skeleton: pos(5, 0), // 5.a. skeleton
  skeleton_archer: pos(5, 1), // 5.b. skeleton archer
  lich: pos(5, 2), // 5.c. lich

  // Orcs (row 1)
  orc: pos(1, 0), // 1.a. orc
  orc_wizard: pos(1, 1), // 1.b. orc wizard
  orc_warchief: pos(1, 4), // 1.e. orc warchief

  // Dragons (row 9)
  dragon: pos(9, 2), // 9.c. dragon
} as const;

// Map game enemy types to sprite keys based on variant
type MonsterSpriteKey = keyof typeof MONSTER_SPRITES;

export const ENEMY_SPRITE_MAPPING: Record<
  string,
  Record<'normal' | 'elite' | 'champion', MonsterSpriteKey>
> = {
  rat: {
    normal: 'rat',
    elite: 'rat',
    champion: 'rat',
  },
  skeleton: {
    normal: 'skeleton',
    elite: 'skeleton_archer',
    champion: 'lich',
  },
  orc: {
    normal: 'orc',
    elite: 'orc_wizard',
    champion: 'orc_warchief',
  },
  dragon: {
    normal: 'dragon',
    elite: 'dragon',
    champion: 'dragon',
  },
} as const;

// Tile sprites from tiles.png (544x832, 17x26 grid)
export const TILE_SPRITES = {
  // Fog of war
  fog: pos(7, 0), // 7.a. blank floor (dark grey)

  // === THEMED FLOORS ===
  // Blue theme (floors 1-5) - row 13
  blue_floor1: pos(13, 1), // 13.b. blue stone floor 1
  blue_floor2: pos(13, 2), // 13.c. blue stone floor 2
  blue_floor3: pos(13, 3), // 13.d. blue stone floor 3

  // Stone theme (floors 6-10) - row 7
  stone_floor1: pos(7, 1), // 7.b. floor stone 1
  stone_floor2: pos(7, 2), // 7.c. floor stone 2
  stone_floor3: pos(7, 3), // 7.d. floor stone 3

  // Bone theme (floors 11-15) - row 11
  bone_floor1: pos(11, 1), // 11.b. bone 1
  bone_floor2: pos(11, 2), // 11.c. bone 2
  bone_floor3: pos(11, 3), // 11.d. bone 3

  // Red theme (floors 16-20) - row 12
  red_floor1: pos(12, 1), // 12.b. red stone floor 1
  red_floor2: pos(12, 2), // 12.c. red stone floor 2
  red_floor3: pos(12, 3), // 12.d. red stone floor 3

  // === THEMED WALLS ===
  // Stone brick walls (blue & stone themes) - row 3
  stone_wall: pos(3, 1), // 3.b. stone brick wall (side)

  // Skull/catacombs walls (bone theme) - row 6
  skull_wall: pos(6, 1), // 6.b. catacombs / skull walls (side)

  // Igneous walls (red theme) - row 4
  igneous_wall: pos(4, 1), // 4.b. igneous wall (side)

  // Legacy aliases
  floor1: pos(7, 1),
  floor2: pos(7, 2),
  floor3: pos(7, 3),
  wall_top: pos(3, 0),
  wall_side: pos(3, 1),

  // Doors and stairs (row 17)
  door_closed: pos(17, 0), // 17.a. door 1
  door_open: pos(17, 3), // 17.d. framed door 1 (open)
  stairs_down: pos(17, 7), // 17.h. staircase down
  stairs_up: pos(17, 8), // 17.i. staircase up

  // Containers (row 18)
  chest_closed: pos(18, 0), // 18.a. chest (closed)
  chest_open: pos(18, 1), // 18.b. chest (open)
} as const;

// Floor themes based on dungeon depth
export type FloorTheme = 'blue' | 'stone' | 'bone' | 'red';

export function getFloorTheme(floor: number): FloorTheme {
  if (floor <= 5) return 'blue';
  if (floor <= 10) return 'stone';
  if (floor <= 15) return 'bone';
  return 'red';
}

// Item sprites from items.png (352x832, 11x26 grid)
export const ITEM_SPRITES = {
  // Potions (row 20)
  health_potion: pos(20, 1), // 20.b. red potion

  // Weapons - swords (row 1)
  weapon_dagger: pos(1, 0), // 1.a. dagger
  weapon_short_sword: pos(1, 1), // 1.b. short sword
  weapon_long_sword: pos(1, 3), // 1.d. long sword
  weapon_bastard_sword: pos(1, 4), // 1.e. bastard sword

  // Weapons - axes (row 4)
  weapon_hand_axe: pos(4, 0), // 4.a. hand axe
  weapon_battle_axe: pos(4, 1), // 4.b. battle axe

  // Shields (row 12)
  shield_buckler: pos(12, 0), // 12.a. buckler
  shield_kite: pos(12, 1), // 12.b. kite shield
  shield_round: pos(12, 4), // 12.e. round shield

  // Armor (row 13)
  armor_cloth: pos(13, 0), // 13.a. cloth armor
  armor_leather: pos(13, 1), // 13.b. leather armor
  armor_chain: pos(13, 3), // 13.d. chain mail
  armor_plate: pos(13, 5), // 13.f. chest plate

  // Ranged weapons - throwing daggers (row 1)
  ranged_throwing_daggers: pos(1, 0), // 1.a. dagger
  ranged_magic_daggers: pos(1, 7), // 1.h. magic dagger

  // Ranged weapons - crossbows (row 10)
  ranged_crossbow: pos(10, 0), // 10.a. crossbow
  ranged_large_crossbow: pos(10, 4), // 10.e. large crossbow

  // Ranged weapons - staffs (row 11)
  ranged_crystal_staff: pos(11, 0), // 11.a. crystal staff
  ranged_flame_staff: pos(11, 6), // 11.g. flame staff
} as const;

// Projectile type matching the server-side definition
export type ProjectileType = 'bolt' | 'dagger' | 'magic_dagger' | 'spell';

// Comprehensive projectile configuration
export interface ProjectileConfig {
  type: ProjectileType;
  sprite: Coordinate | null; // null for spell (uses CSS effect)
  buttonIcon: Coordinate; // Icon to show in D-pad button
  buttonScale: number; // Scale factor for button icon (1 = 32px, 2 = 64px, etc.)
  buttonRotation: number; // Rotation for button icon in degrees
  buttonOffset?: Coordinate; // Optional offset for button icon centering (in pixels at scale 1)
  getRotation: (direction: 'left' | 'right') => number; // Calculate rotation based on direction
  shouldFlip: (direction: 'left' | 'right') => boolean; // Whether to flip sprite
}

// All projectile rendering information by type
const PROJECTILE_CONFIGS: Record<ProjectileType, ProjectileConfig> = {
  bolt: {
    type: 'bolt',
    sprite: pos(24, 2), // 24.c. crossbow bolt (diagonal, points down-right at 45°)
    buttonIcon: pos(24, 2),
    buttonScale: 2.3, // Bolt is small, scale up
    buttonRotation: 90, // Point right in button
    buttonOffset: { x: 2, y: 0 }, // Manual centering offset
    // Right: rotate -45° to point horizontally right (0°)
    // Left: rotate 135° to point horizontally left (180°)
    getRotation: (direction) => (direction === 'right' ? -45 : 135),
    shouldFlip: () => false,
  },
  dagger: {
    type: 'dagger',
    sprite: pos(1, 0), // 1.a. small dagger
    buttonIcon: pos(1, 0),
    buttonScale: 2, // Dagger is medium sized
    buttonRotation: 90, // Point right in button
    buttonOffset: { x: 2, y: -1 }, // Manual centering offset
    // Keep handle at top, blade at bottom - rotate 135° and flip based on direction
    getRotation: () => 135,
    shouldFlip: (direction) => direction === 'left',
  },
  magic_dagger: {
    type: 'magic_dagger',
    sprite: pos(1, 7), // 1.h. magic dagger (cyan/blue glowing)
    buttonIcon: pos(1, 7),
    buttonScale: 2, // Dagger is medium sized
    buttonRotation: 90, // Point right in button
    buttonOffset: { x: 1, y: -2 }, // Manual centering offset
    // Keep handle at top, blade at bottom - rotate 135° and flip based on direction
    getRotation: () => 135,
    shouldFlip: (direction) => direction === 'left',
  },
  spell: {
    type: 'spell',
    sprite: null, // Uses CSS effect (glowing orb)
    buttonIcon: pos(11, 0), // 11.a. crystal staff for button
    buttonScale: 1.2, // Staff is full-sized
    buttonRotation: 90, // Point top-right in button (diagonal)
    buttonOffset: { x: 2, y: -1 }, // Manual centering offset
    getRotation: () => 0,
    shouldFlip: () => false,
  },
};

// Map character to projectile type (matches server logic)
const CHARACTER_PROJECTILE_MAP: Record<CharacterType, ProjectileType> = {
  dwarf: 'dagger',
  bandit: 'bolt',
  elf: 'magic_dagger',
  wizard: 'spell',
};

// Get complete projectile configuration by character
export function getProjectileConfig(
  character: CharacterType,
): ProjectileConfig {
  const type = CHARACTER_PROJECTILE_MAP[character];
  return PROJECTILE_CONFIGS[type];
}

// Get complete projectile configuration by type
export function getProjectileConfigByType(
  type: ProjectileType,
): ProjectileConfig {
  return PROJECTILE_CONFIGS[type];
}

// Get projectile type based on character (matches server logic)
export function getProjectileType(character: CharacterType): ProjectileType {
  return CHARACTER_PROJECTILE_MAP[character];
}

// Get projectile sprite coordinates for rendering (used by Projectile component)
export function getProjectileSpriteCoords(
  type: ProjectileType,
): Coordinate | null {
  return PROJECTILE_CONFIGS[type].sprite;
}

// Get sprite position for a character
export function getCharacterSprite(character: CharacterType): {
  x: number;
  y: number;
} {
  return CHARACTER_SPRITES[character];
}

// Get sprite position for an enemy based on type and variant
export function getEnemySprite(
  enemyType: keyof typeof ENEMY_SPRITE_MAPPING,
  variant: 'normal' | 'elite' | 'champion' = 'normal',
): Coordinate {
  const spriteKey = ENEMY_SPRITE_MAPPING[enemyType][variant];
  return MONSTER_SPRITES[spriteKey];
}

// Get themed floor sprite based on position and dungeon floor
export function getFloorSprite(
  x: number,
  y: number,
  floor: number,
): Coordinate {
  const theme = getFloorTheme(floor);
  // Use position to deterministically pick a floor variant (1, 2, or 3)
  const variant = ((x * 7 + y * 13) % 3) + 1;

  switch (theme) {
    case 'blue':
      return variant === 1
        ? TILE_SPRITES.blue_floor1
        : variant === 2
          ? TILE_SPRITES.blue_floor2
          : TILE_SPRITES.blue_floor3;
    case 'stone':
      return variant === 1
        ? TILE_SPRITES.stone_floor1
        : variant === 2
          ? TILE_SPRITES.stone_floor2
          : TILE_SPRITES.stone_floor3;
    case 'bone':
      return variant === 1
        ? TILE_SPRITES.bone_floor1
        : variant === 2
          ? TILE_SPRITES.bone_floor2
          : TILE_SPRITES.bone_floor3;
    case 'red':
      return variant === 1
        ? TILE_SPRITES.red_floor1
        : variant === 2
          ? TILE_SPRITES.red_floor2
          : TILE_SPRITES.red_floor3;
  }
}

// Get themed wall sprite based on dungeon floor
export function getWallSprite(floor: number): Coordinate {
  const theme = getFloorTheme(floor);
  switch (theme) {
    case 'blue':
    case 'stone':
      return TILE_SPRITES.stone_wall;
    case 'bone':
      return TILE_SPRITES.skull_wall;
    case 'red':
      return TILE_SPRITES.igneous_wall;
  }
}

// Get sprite position for a tile type
export function getTileSprite(
  tileType: string,
  x: number,
  y: number,
  floor: number,
): Coordinate {
  switch (tileType) {
    case 'wall':
      return getWallSprite(floor);
    case 'stairs':
      return TILE_SPRITES.stairs_down;
    case 'door':
      return TILE_SPRITES.door_closed;
    default:
      return getFloorSprite(x, y, floor);
  }
}

// Get sprite position for an item based on slot and optional item ID
export function getItemSprite(slot?: string, itemId?: string): Coordinate {
  switch (slot) {
    case 'weapon':
      return ITEM_SPRITES.weapon_long_sword;
    case 'shield':
      return ITEM_SPRITES.shield_buckler;
    case 'armor':
      return ITEM_SPRITES.armor_leather;
    case 'ranged':
      // Return specific sprite based on item ID
      if (itemId?.includes('staff')) return ITEM_SPRITES.ranged_crystal_staff;
      if (itemId?.includes('crossbow')) return ITEM_SPRITES.ranged_crossbow;
      return ITEM_SPRITES.ranged_throwing_daggers;
    default:
      return ITEM_SPRITES.health_potion;
  }
}

// Sprite sheet URLs
export const SPRITE_SHEETS = {
  rogues: '/sprites/rogues.png',
  monsters: '/sprites/monsters.png',
  tiles: '/sprites/tiles.png',
  items: '/sprites/items.png',
  animatedTiles: '/sprites/animated-tiles.png',
} as const;
