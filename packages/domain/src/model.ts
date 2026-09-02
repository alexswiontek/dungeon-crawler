export interface Coordinate {
  x: number;
  y: number;
}

export type CharacterType = 'dwarf' | 'elf' | 'bandit' | 'wizard';
export type FacingDirection = 'left' | 'right';
export type Direction = 'up' | 'down' | 'left' | 'right';
export type TileType = 'floor' | 'wall' | 'stairs' | 'door';
export type ItemType = 'health_potion' | 'equipment';
export type EquipmentSlot = 'weapon' | 'shield' | 'armor' | 'ranged';
export type EnemyType = 'rat' | 'skeleton' | 'orc' | 'dragon';
export type EnemyVariant = 'normal' | 'elite' | 'champion';
export type AIBehavior = 'aggressive' | 'patrol' | 'flee' | 'stationary';
export type GameStatus = 'active' | 'dead' | 'won';
export type AttackType = 'bolt' | 'dagger' | 'magic_dagger' | 'spell';

export interface CharacterStats {
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  rangedDamage: number;
  rangedRange: number;
}

export const CHARACTER_STATS: Record<CharacterType, CharacterStats> = {
  dwarf: {
    hp: 28,
    maxHp: 28,
    attack: 6,
    defense: 3,
    rangedDamage: 3,
    rangedRange: 2,
  },
  bandit: {
    hp: 24,
    maxHp: 24,
    attack: 4,
    defense: 4,
    rangedDamage: 6,
    rangedRange: 3,
  },
  elf: {
    hp: 22,
    maxHp: 22,
    attack: 5,
    defense: 3,
    rangedDamage: 6,
    rangedRange: 3,
  },
  wizard: {
    hp: 20,
    maxHp: 20,
    attack: 4,
    defense: 2,
    rangedDamage: 7,
    rangedRange: 4,
  },
};

export interface Tile {
  type: TileType;
  x: number;
  y: number;
}

export interface Item {
  id: string;
  type: ItemType;
  name: string;
  x: number;
  y: number;
  value: number;
}

export interface Equipment {
  id: string;
  slot: EquipmentSlot;
  name: string;
  attackBonus: number;
  defenseBonus: number;
  hpBonus: number;
  rangedDamageBonus: number;
  rangedRangeBonus: number;
  tier: number;
}

export interface EquipmentItem extends Item {
  type: 'equipment';
  equipment: Equipment;
}

export function isEquipmentItem(item: Item): item is EquipmentItem {
  return item.type === 'equipment' && 'equipment' in item;
}

export const EQUIPMENT_DEFINITIONS: Equipment[] = [
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

export function getEquipmentForFloor(floor: number): Equipment[] {
  return EQUIPMENT_DEFINITIONS.filter(
    (equipment) => equipment.tier <= floor + 1,
  );
}

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
  lastSeenPlayer?: Coordinate;
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
  xp: number;
  level: number;
  xpToNextLevel: number;
  equipment: PlayerEquipment;
  character: CharacterType;
  facingDirection: FacingDirection;
}

export interface GameState {
  _id: string;
  playerId: string;
  playerName: string;
  floor: number;
  player: Player;
  map: Tile[][];
  enemies: Enemy[];
  items: Item[];
  explored: boolean[][];
  visibleNow: boolean[][];
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
  killedByType: EnemyType | null;
  killedByVariant: EnemyVariant | null;
  createdAt: Date;
}

export interface PlayerAttackedEventData {
  targetX: number;
  targetY: number;
  damage: number;
  enemyId: string;
}

export interface PlayerDiedEventData {
  killedBy: string;
  killedByType: EnemyType;
  killedByVariant: EnemyVariant;
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
  notBetter: boolean;
}

export interface RangedAttackEventData {
  targetX: number;
  targetY: number;
  damage: number;
  enemyId?: string;
  attackType: AttackType;
}

type DomainEventBase<TType extends string, TData = undefined> = {
  id: string;
  type: TType;
  message: string;
  data?: TData;
};

export type GameEvent =
  | DomainEventBase<'player_moved', { direction: Direction }>
  | DomainEventBase<'player_attacked', PlayerAttackedEventData>
  | DomainEventBase<'player_damaged', { damage: number; enemyId: string }>
  | DomainEventBase<'player_healed', PlayerHealedEventData>
  | DomainEventBase<'potion_refused'>
  | DomainEventBase<'attack_missed'>
  | DomainEventBase<'ranged_attack', RangedAttackEventData>
  | DomainEventBase<'ranged_missed', RangedAttackEventData>
  | DomainEventBase<'enemy_killed', EnemyKilledEventData>
  | DomainEventBase<'item_picked_up', ItemPickedUpEventData>
  | DomainEventBase<'floor_descended', { floor: number }>
  | DomainEventBase<'player_died', PlayerDiedEventData>
  | DomainEventBase<'game_won'>
  | DomainEventBase<'xp_gained', XpGainedEventData>
  | DomainEventBase<'level_up', LevelUpEventData>
  | DomainEventBase<'equipment_equipped', EquipmentEquippedEventData>
  | DomainEventBase<'equipment_found', EquipmentFoundEventData>
  | DomainEventBase<'equipment_ignored', EquipmentFoundEventData>;

export type GameEventType = GameEvent['type'];
export type GameEventData = NonNullable<GameEvent['data']>;

export type GameCommand =
  | { type: 'move'; direction: Direction }
  | { type: 'attack' }
  | { type: 'descend' };

export interface GameTransition {
  state: GameState;
  events: GameEvent[];
  accepted: boolean;
}

export function isDirection(value: unknown): value is Direction {
  return (
    value === 'up' || value === 'down' || value === 'left' || value === 'right'
  );
}

export function isPlayerDiedEvent(event: GameEvent): event is Extract<
  GameEvent,
  { type: 'player_died' }
> & {
  data: PlayerDiedEventData;
} {
  return event.type === 'player_died' && event.data !== undefined;
}

export function isPlayerHealedEvent(event: GameEvent): event is Extract<
  GameEvent,
  { type: 'player_healed' }
> & {
  data: PlayerHealedEventData;
} {
  return event.type === 'player_healed' && event.data !== undefined;
}

export function isItemPickedUpEvent(event: GameEvent): event is Extract<
  GameEvent,
  { type: 'item_picked_up' }
> & {
  data: ItemPickedUpEventData;
} {
  return event.type === 'item_picked_up' && event.data !== undefined;
}

export function isItemPickupEvent(event: GameEvent): event is Extract<
  GameEvent,
  { type: 'player_healed' | 'item_picked_up' }
> & {
  data: PlayerHealedEventData | ItemPickedUpEventData;
} {
  return (
    (event.type === 'player_healed' || event.type === 'item_picked_up') &&
    event.data !== undefined
  );
}

export function isEquipmentEquippedEvent(event: GameEvent): event is Extract<
  GameEvent,
  { type: 'equipment_equipped' }
> & {
  data: EquipmentEquippedEventData;
} {
  return event.type === 'equipment_equipped' && event.data !== undefined;
}

export function isRangedAttackEvent(event: GameEvent): event is Extract<
  GameEvent,
  { type: 'ranged_attack' | 'ranged_missed' }
> & {
  data: RangedAttackEventData;
} {
  return (
    (event.type === 'ranged_attack' || event.type === 'ranged_missed') &&
    event.data !== undefined
  );
}

export function isPlayerAttackedEvent(event: GameEvent): event is Extract<
  GameEvent,
  { type: 'player_attacked' }
> & {
  data: PlayerAttackedEventData;
} {
  return event.type === 'player_attacked' && event.data !== undefined;
}

export const MAP_WIDTH = 40;
export const MAP_HEIGHT = 24;
export const VISION_RADIUS = 5;

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

export function getEnemyXpReward(enemy: Enemy): number {
  return Math.floor(
    ENEMY_STATS[enemy.type].xpReward *
      VARIANT_MULTIPLIERS[enemy.variant].xpMult,
  );
}

export function getXpToNextLevel(level: number): number {
  return level * 50;
}

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
  xpToNextLevel: 50,
  equipment: {
    weapon: null,
    shield: null,
    armor: null,
    ranged: null,
  },
};
