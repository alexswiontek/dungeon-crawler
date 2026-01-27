// Game types for dungeon-crawler

// Coordinate type used throughout the game
export interface Coordinate {
  x: number;
  y: number;
}

// Character types for player selection
export type CharacterType = 'dwarf' | 'elf' | 'bandit' | 'wizard';

// Character-specific base stats
export interface CharacterStats {
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  rangedDamage: number; // Base ranged attack damage
  rangedRange: number; // How many tiles ranged attack travels
}

export const CHARACTER_STATS: Record<CharacterType, CharacterStats> = {
  // Dwarf: balanced melee fighter with sword & armor
  dwarf: {
    hp: 28,
    maxHp: 28,
    attack: 6,
    defense: 3,
    rangedDamage: 3, // Throws dagger (weak)
    rangedRange: 2,
  },
  // Bandit: ranged specialist with powerful crossbow
  bandit: {
    hp: 24,
    maxHp: 24,
    attack: 4,
    defense: 4,
    rangedDamage: 6, // Shoots crossbow bolts (strong)
    rangedRange: 3,
  },
  // Elf: balanced fighter with magic daggers
  elf: {
    hp: 22,
    maxHp: 22,
    attack: 5,
    defense: 3,
    rangedDamage: 6, // Throws magic dagger (decent)
    rangedRange: 3,
  },
  // Wizard: powerful mage with strong spells, weak melee
  wizard: {
    hp: 20,
    maxHp: 20,
    attack: 4,
    defense: 2,
    rangedDamage: 7, // Casts powerful spells (very strong)
    rangedRange: 4,
  },
};

// Player facing direction (for sprite flipping and future attack direction)
export type FacingDirection = 'left' | 'right';

export type TileType = 'floor' | 'wall' | 'stairs' | 'door';

export interface Tile {
  type: TileType;
  x: number;
  y: number;
}

export type ItemType = 'health_potion' | 'equipment';

export interface Item {
  id: string;
  type: ItemType;
  name: string;
  x: number;
  y: number;
  value: number; // healing amount for potions
}

// Equipment system
export type EquipmentSlot = 'weapon' | 'shield' | 'armor' | 'ranged';

export interface Equipment {
  id: string;
  slot: EquipmentSlot;
  name: string;
  attackBonus: number;
  defenseBonus: number;
  hpBonus: number;
  rangedDamageBonus: number;
  rangedRangeBonus: number;
  tier: number; // For floor-based spawning
}

export interface EquipmentItem extends Item {
  type: 'equipment';
  equipment: Equipment;
}

// Type guard for equipment items
export function isEquipmentItem(item: Item): item is EquipmentItem {
  return item.type === 'equipment' && 'equipment' in item;
}

// All available equipment
export const EQUIPMENT_DEFINITIONS: Equipment[] = [
  // Weapons (attack bonus)
  {
    id: 'rusty_sword',
    slot: 'weapon',
    name: 'Rusty Sword',
    attackBonus: 2,
    defenseBonus: 0,
    hpBonus: 0,
    rangedDamageBonus: 0,
    rangedRangeBonus: 0,
    tier: 1,
  },
  {
    id: 'iron_sword',
    slot: 'weapon',
    name: 'Iron Sword',
    attackBonus: 4,
    defenseBonus: 0,
    hpBonus: 0,
    rangedDamageBonus: 0,
    rangedRangeBonus: 0,
    tier: 3,
  },
  {
    id: 'steel_sword',
    slot: 'weapon',
    name: 'Steel Sword',
    attackBonus: 7,
    defenseBonus: 0,
    hpBonus: 0,
    rangedDamageBonus: 0,
    rangedRangeBonus: 0,
    tier: 6,
  },
  // Shields (defense bonus)
  {
    id: 'wooden_shield',
    slot: 'shield',
    name: 'Wooden Shield',
    attackBonus: 0,
    defenseBonus: 2,
    hpBonus: 0,
    rangedDamageBonus: 0,
    rangedRangeBonus: 0,
    tier: 1,
  },
  {
    id: 'iron_shield',
    slot: 'shield',
    name: 'Iron Shield',
    attackBonus: 0,
    defenseBonus: 4,
    hpBonus: 0,
    rangedDamageBonus: 0,
    rangedRangeBonus: 0,
    tier: 4,
  },
  // Armor (defense + HP bonus)
  {
    id: 'leather_armor',
    slot: 'armor',
    name: 'Leather Armor',
    attackBonus: 0,
    defenseBonus: 1,
    hpBonus: 10,
    rangedDamageBonus: 0,
    rangedRangeBonus: 0,
    tier: 1,
  },
  {
    id: 'chain_mail',
    slot: 'armor',
    name: 'Chain Mail',
    attackBonus: 0,
    defenseBonus: 3,
    hpBonus: 15,
    rangedDamageBonus: 0,
    rangedRangeBonus: 0,
    tier: 3,
  },
  {
    id: 'plate_armor',
    slot: 'armor',
    name: 'Plate Armor',
    attackBonus: 0,
    defenseBonus: 5,
    hpBonus: 25,
    rangedDamageBonus: 0,
    rangedRangeBonus: 0,
    tier: 6,
  },
  // Ranged weapons (ranged damage + range bonus)
  // Throwing daggers (for dwarf/elf)
  {
    id: 'throwing_daggers',
    slot: 'ranged',
    name: 'Throwing Daggers',
    attackBonus: 0,
    defenseBonus: 0,
    hpBonus: 0,
    rangedDamageBonus: 2,
    rangedRangeBonus: 0,
    tier: 1,
  },
  {
    id: 'magic_daggers',
    slot: 'ranged',
    name: 'Magic Daggers',
    attackBonus: 0,
    defenseBonus: 0,
    hpBonus: 0,
    rangedDamageBonus: 4,
    rangedRangeBonus: 1,
    tier: 4,
  },
  // Crossbows (for bandit)
  {
    id: 'crossbow',
    slot: 'ranged',
    name: 'Crossbow',
    attackBonus: 0,
    defenseBonus: 0,
    hpBonus: 0,
    rangedDamageBonus: 2,
    rangedRangeBonus: 0,
    tier: 1,
  },
  {
    id: 'large_crossbow',
    slot: 'ranged',
    name: 'Large Crossbow',
    attackBonus: 0,
    defenseBonus: 0,
    hpBonus: 0,
    rangedDamageBonus: 4,
    rangedRangeBonus: 1,
    tier: 4,
  },
  // Staffs (for wizard/elf)
  {
    id: 'crystal_staff',
    slot: 'ranged',
    name: 'Crystal Staff',
    attackBonus: 0,
    defenseBonus: 0,
    hpBonus: 0,
    rangedDamageBonus: 2,
    rangedRangeBonus: 0,
    tier: 1,
  },
  {
    id: 'flame_staff',
    slot: 'ranged',
    name: 'Flame Staff',
    attackBonus: 0,
    defenseBonus: 0,
    hpBonus: 0,
    rangedDamageBonus: 5,
    rangedRangeBonus: 1,
    tier: 5,
  },
];

// Get equipment appropriate for a floor
export function getEquipmentForFloor(floor: number): Equipment[] {
  return EQUIPMENT_DEFINITIONS.filter((e) => e.tier <= floor + 1);
}

export type EnemyType = 'rat' | 'skeleton' | 'orc' | 'dragon';
export type EnemyVariant = 'normal' | 'elite' | 'champion';

// AI behavior types for enemies
export type AIBehavior = 'aggressive' | 'patrol' | 'flee' | 'stationary';

export interface VariantMultipliers {
  hpMult: number;
  attackMult: number;
  defenseMult: number;
  xpMult: number;
  namePrefix: string;
}

export const VARIANT_MULTIPLIERS: Record<EnemyVariant, VariantMultipliers> = {
  normal: {
    hpMult: 1,
    attackMult: 1,
    defenseMult: 1,
    xpMult: 1,
    namePrefix: '',
  },
  elite: {
    hpMult: 1.5,
    attackMult: 1.5,
    defenseMult: 1.2,
    xpMult: 2.5,
    namePrefix: 'Elite ',
  },
  champion: {
    hpMult: 2.5,
    attackMult: 1.8,
    defenseMult: 1.5,
    xpMult: 4,
    namePrefix: 'Champion ',
  },
};

export interface Enemy {
  id: string;
  type: EnemyType;
  variant: EnemyVariant;
  displayName: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  behavior: AIBehavior;
  lastSeenPlayer?: Coordinate; // For memory when player leaves LOS
}

export interface PlayerEquipment {
  weapon: Equipment | null;
  shield: Equipment | null;
  armor: Equipment | null;
  ranged: Equipment | null;
}

export interface Player {
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  inventory: Item[];
  // XP and leveling
  xp: number;
  level: number;
  xpToNextLevel: number;
  // Equipment
  equipment: PlayerEquipment;
  // Character appearance
  character: CharacterType;
  // Direction player is facing (for sprite and attacks)
  facingDirection: FacingDirection;
}

export type GameStatus = 'active' | 'dead' | 'won';

export interface GameState {
  _id: string;
  playerId: string;
  playerName: string;
  floor: number;
  player: Player;
  map: Tile[][];
  enemies: Enemy[];
  items: Item[];
  fog: boolean[][]; // what's been revealed
  status: GameStatus;
  score: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface LeaderboardEntry {
  _id: string;
  playerName: string;
  score: number;
  floor: number;
  killedBy: string | null;
  createdAt: Date;
}

// API request/response types
export type Direction = 'up' | 'down' | 'left' | 'right';

// Type guard for Direction (runtime validation)
export function isDirection(value: unknown): value is Direction {
  return (
    value === 'up' || value === 'down' || value === 'left' || value === 'right'
  );
}

export interface MoveRequest {
  direction: Direction;
}

export interface NewGameRequest {
  playerName: string;
  character: CharacterType;
}

export interface NewGameResponse {
  gameId: string;
  state: GameState;
}

export interface MoveResponse {
  state: GameState;
  events: GameEvent[];
}

export type GameEventType =
  | 'player_moved'
  | 'player_attacked'
  | 'player_damaged'
  | 'player_healed'
  | 'potion_refused'
  | 'attack_missed' // Slashed at air (no enemy)
  | 'ranged_attack' // Ranged attack hit an enemy
  | 'ranged_missed' // Ranged attack hit nothing
  | 'enemy_killed'
  | 'item_picked_up'
  | 'floor_descended'
  | 'player_died'
  | 'game_won'
  | 'xp_gained'
  | 'level_up'
  | 'equipment_equipped'
  | 'equipment_found';

// Typed event data for specific event types
export interface PlayerAttackedEventData {
  targetX: number; // Where the melee attack hit
  targetY: number;
  damage: number;
  enemyId: string;
}

export interface PlayerDiedEventData {
  killedBy: string;
}

export interface PlayerHealedEventData {
  itemId: string;
  healAmount: number;
}

export interface ItemPickedUpEventData {
  itemId: string;
  itemName: string;
}

export interface EnemyKilledEventData {
  enemyId: string;
  enemyType: EnemyType;
}

export interface XpGainedEventData {
  amount: number;
  totalXp: number;
}

export interface LevelUpEventData {
  newLevel: number;
  hpGained: number;
  attackGained: number;
  defenseGained: number;
}

export interface EquipmentEquippedEventData {
  itemId: string;
  equipment: Equipment;
  slot: EquipmentSlot;
}

export interface EquipmentFoundEventData {
  equipment: Equipment;
  notBetter: boolean; // True if found equipment is not better than current
}

export interface RangedAttackEventData {
  targetX: number; // Where the projectile hit (for damage number positioning)
  targetY: number;
  damage: number;
  enemyId?: string; // If an enemy was hit
  attackType: 'bolt' | 'dagger' | 'magic_dagger' | 'spell'; // Visual indicator
}

export type GameEventData =
  | PlayerAttackedEventData
  | PlayerDiedEventData
  | PlayerHealedEventData
  | ItemPickedUpEventData
  | EnemyKilledEventData
  | XpGainedEventData
  | LevelUpEventData
  | EquipmentEquippedEventData
  | EquipmentFoundEventData
  | RangedAttackEventData;

export interface GameEvent {
  id: string; // Unique identifier for deduplication (timestamp-based)
  type: GameEventType;
  message: string;
  data?: GameEventData;
}

// Type guards for event data
export function isPlayerDiedEvent(
  event: GameEvent,
): event is GameEvent & { data: PlayerDiedEventData } {
  return (
    event.type === 'player_died' &&
    event.data !== undefined &&
    'killedBy' in event.data
  );
}

export function isPlayerHealedEvent(
  event: GameEvent,
): event is GameEvent & { data: PlayerHealedEventData } {
  return (
    event.type === 'player_healed' &&
    event.data !== undefined &&
    'itemId' in event.data
  );
}

export function isItemPickedUpEvent(
  event: GameEvent,
): event is GameEvent & { data: ItemPickedUpEventData } {
  return (
    event.type === 'item_picked_up' &&
    event.data !== undefined &&
    'itemId' in event.data
  );
}

// Helper to check if an event involves picking up an item (healed or item_picked_up)
export function isItemPickupEvent(
  event: GameEvent,
): event is GameEvent & { data: { itemId: string } } {
  return isPlayerHealedEvent(event) || isItemPickedUpEvent(event);
}

export function isEquipmentEquippedEvent(
  event: GameEvent,
): event is GameEvent & { data: EquipmentEquippedEventData } {
  return (
    event.type === 'equipment_equipped' &&
    event.data !== undefined &&
    'itemId' in event.data
  );
}

export function isRangedAttackEvent(
  event: GameEvent,
): event is GameEvent & { data: RangedAttackEventData } {
  return (
    (event.type === 'ranged_attack' || event.type === 'ranged_missed') &&
    event.data !== undefined &&
    'targetX' in event.data
  );
}

export function isPlayerAttackedEvent(
  event: GameEvent,
): event is GameEvent & { data: PlayerAttackedEventData } {
  return (
    event.type === 'player_attacked' &&
    event.data !== undefined &&
    'targetX' in event.data
  );
}

// Map generation constants
export const MAP_WIDTH = 40;
export const MAP_HEIGHT = 24;
export const VISION_RADIUS = 5;

// Base enemy stats by type (before variant multipliers)
export interface BaseEnemyStats {
  hp: number;
  attack: number;
  defense: number;
  xpReward: number;
}

export const ENEMY_STATS: Record<EnemyType, BaseEnemyStats> = {
  rat: { hp: 6, attack: 4, defense: 0, xpReward: 8 },
  skeleton: { hp: 15, attack: 8, defense: 2, xpReward: 30 },
  orc: { hp: 25, attack: 13, defense: 4, xpReward: 60 },
  dragon: { hp: 45, attack: 20, defense: 8, xpReward: 200 },
};

// Helper to determine enemy variant based on floor
export function getEnemyVariant(floor: number): EnemyVariant {
  const roll = Math.random();
  const eliteChance = Math.min(0.1 + floor * 0.05, 0.4); // 10% floor 1, up to 40%
  const championChance = Math.min(Math.max(0, (floor - 1) * 0.04), 0.2); // 0% floor 1, 4% floor 2, up to 20%

  if (roll < championChance) return 'champion';
  if (roll < championChance + eliteChance) return 'elite';
  return 'normal';
}

// Helper to format enemy name (e.g., "rat" -> "Rat", "orc" -> "Orc")
function capitalizeEnemyType(type: EnemyType): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

// Helper to determine AI behavior based on enemy type
function getEnemyBehavior(type: EnemyType): AIBehavior {
  switch (type) {
    case 'rat':
      return 'flee'; // Rats flee when low HP
    case 'dragon':
      return 'aggressive'; // Dragons always aggressive
    default:
      // 70% aggressive, 30% patrol for skeletons and orcs
      return Math.random() < 0.7 ? 'aggressive' : 'patrol';
  }
}

// Helper to create an enemy with variant-scaled stats
export function createEnemy(
  id: string,
  type: EnemyType,
  x: number,
  y: number,
  floor: number,
): Enemy {
  const variant = getEnemyVariant(floor);
  const mult = VARIANT_MULTIPLIERS[variant];
  const base = ENEMY_STATS[type];

  return {
    id,
    type,
    variant,
    displayName: `${mult.namePrefix}${capitalizeEnemyType(type)}`,
    x,
    y,
    hp: Math.floor(base.hp * mult.hpMult),
    maxHp: Math.floor(base.hp * mult.hpMult),
    attack: Math.floor(base.attack * mult.attackMult),
    defense: Math.floor(base.defense * mult.defenseMult),
    behavior: getEnemyBehavior(type),
  };
}

// Get XP reward for an enemy (includes variant multiplier)
export function getEnemyXpReward(enemy: Enemy): number {
  const base = ENEMY_STATS[enemy.type].xpReward;
  const mult = VARIANT_MULTIPLIERS[enemy.variant];
  return Math.floor(base * mult.xpMult);
}

// XP required for next level: level * 50
export function getXpToNextLevel(level: number): number {
  return level * 50;
}

// Starting player stats
export const STARTING_PLAYER: Omit<
  Player,
  'x' | 'y' | 'character' | 'facingDirection'
> = {
  hp: 25,
  maxHp: 25,
  attack: 5,
  defense: 2,
  inventory: [],
  xp: 0,
  level: 1,
  xpToNextLevel: 50, // Level 1 needs 50 XP to reach level 2
  equipment: {
    weapon: null,
    shield: null,
    armor: null,
    ranged: null,
  },
};

// ============================================
// WebSocket + Delta Types
// ============================================

// Visible game state (only what player can see - anti-cheat)
export interface VisibleGameState {
  _id: string;
  playerName: string;
  floor: number;
  player: Player;
  visibleTiles: Tile[]; // Only revealed tiles
  visibleEnemies: Enemy[]; // Only enemies in fog
  visibleItems: Item[]; // Only items in fog
  fog: boolean[][]; // What's been revealed
  status: GameStatus;
  score: number;
}

// Delta types for incremental updates
export type GameDelta =
  | {
      type: 'player_pos';
      x: number;
      y: number;
      facingDirection: FacingDirection;
    }
  | {
      type: 'player_stats';
      hp?: number;
      maxHp?: number;
      attack?: number;
      defense?: number;
      xp?: number;
      level?: number;
      xpToNextLevel?: number;
    }
  | { type: 'player_equipment'; equipment: PlayerEquipment }
  | { type: 'score'; score: number }
  | { type: 'floor'; floor: number }
  | { type: 'enemy_visible'; enemy: Enemy }
  | { type: 'enemy_moved'; enemyId: string; x: number; y: number }
  | { type: 'enemy_damaged'; enemyId: string; hp: number }
  | { type: 'enemy_killed'; enemyId: string }
  | { type: 'enemy_hidden'; enemyId: string }
  | { type: 'item_visible'; item: Item }
  | { type: 'item_removed'; itemId: string }
  | { type: 'fog_reveal'; cells: [number, number][] }
  | { type: 'tiles_reveal'; tiles: Tile[] }
  | { type: 'game_status'; status: GameStatus }
  | { type: 'event'; event: GameEvent }
  | { type: 'new_floor'; visibleState: VisibleGameState };

// WebSocket message types
export type ClientMessage =
  | { type: 'move'; direction: Direction }
  | { type: 'attack' } // Attack in facing direction
  | { type: 'descend' }
  | { type: 'pause' } // Pause real-time enemy movement
  | { type: 'resume' }; // Resume real-time enemy movement

export type ServerMessage =
  | { type: 'init'; state: VisibleGameState }
  | { type: 'update'; deltas: GameDelta[] }
  | { type: 'enemy_tick'; deltas: GameDelta[] } // Real-time enemy movement
  | { type: 'error'; message: string };
