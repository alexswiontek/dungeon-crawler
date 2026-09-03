import { z } from 'zod';

export const GAMEPLAY_PROTOCOL_VERSION = '2' as const;
export const GAMEPLAY_PROTOCOL_HEADER = 'x-dungeon-crawler-protocol-version';
export const GameplayProtocolVersionSchema = z.literal(
  GAMEPLAY_PROTOCOL_VERSION,
);

export const DirectionSchema = z.enum(['up', 'down', 'left', 'right']);
export const CharacterTypeSchema = z.enum(['dwarf', 'elf', 'bandit', 'wizard']);
export const FacingDirectionSchema = z.enum(['left', 'right']);
export const GameStatusSchema = z.enum(['active', 'dead', 'won']);
export const EnemyTypeSchema = z.enum(['rat', 'skeleton', 'orc', 'dragon']);
export const EnemyVariantSchema = z.enum(['normal', 'elite', 'champion']);
export const AIBehaviorSchema = z.enum([
  'aggressive',
  'patrol',
  'flee',
  'stationary',
]);

export const EquipmentSchema = z.object({
  id: z.string(),
  slot: z.enum(['weapon', 'shield', 'armor', 'ranged']),
  name: z.string(),
  attackBonus: z.number(),
  defenseBonus: z.number(),
  hpBonus: z.number(),
  rangedDamageBonus: z.number(),
  rangedRangeBonus: z.number(),
  tier: z.number(),
});

export const ItemSchema = z.object({
  id: z.string(),
  type: z.enum(['health_potion', 'equipment']),
  name: z.string(),
  x: z.number().int(),
  y: z.number().int(),
  value: z.number(),
  equipment: EquipmentSchema.optional(),
});

export const PlayerEquipmentSchema = z.object({
  weapon: EquipmentSchema.nullable(),
  shield: EquipmentSchema.nullable(),
  armor: EquipmentSchema.nullable(),
  ranged: EquipmentSchema.nullable(),
});

export const PlayerSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
  hp: z.number(),
  maxHp: z.number(),
  attack: z.number(),
  defense: z.number(),
  inventory: z.array(ItemSchema),
  xp: z.number(),
  level: z.number().int(),
  xpToNextLevel: z.number(),
  equipment: PlayerEquipmentSchema,
  character: CharacterTypeSchema,
  facingDirection: FacingDirectionSchema,
});

export const EnemySchema = z.object({
  id: z.string(),
  type: EnemyTypeSchema,
  variant: EnemyVariantSchema,
  displayName: z.string(),
  x: z.number().int(),
  y: z.number().int(),
  hp: z.number(),
  maxHp: z.number(),
  attack: z.number(),
  defense: z.number(),
  behavior: AIBehaviorSchema,
  lastSeenPlayer: z.object({ x: z.number(), y: z.number() }).optional(),
});

export const TileSchema = z.object({
  type: z.enum(['floor', 'wall', 'stairs', 'door']),
  x: z.number().int(),
  y: z.number().int(),
});

const VisibilityMaskSchema = z.array(z.array(z.boolean()));

export const GameEventSchema = z.object({
  id: z.string(),
  type: z.enum([
    'player_moved',
    'player_attacked',
    'player_damaged',
    'player_healed',
    'potion_refused',
    'attack_missed',
    'ranged_attack',
    'ranged_missed',
    'enemy_killed',
    'item_picked_up',
    'floor_descended',
    'player_died',
    'game_won',
    'xp_gained',
    'level_up',
    'equipment_equipped',
    'equipment_found',
    'equipment_ignored',
  ]),
  message: z.string(),
  data: z.unknown().optional(),
});

export const VisibleGameStateSchema = z.strictObject({
  _id: z.string(),
  revision: z.number().int().nonnegative(),
  playerName: z.string(),
  floor: z.number().int(),
  player: PlayerSchema,
  visibleTiles: z.array(TileSchema),
  visibleEnemies: z.array(EnemySchema),
  visibleItems: z.array(ItemSchema),
  explored: VisibilityMaskSchema,
  visibleNow: VisibilityMaskSchema,
  status: GameStatusSchema,
  score: z.number(),
});

export const GameCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('move'), direction: DirectionSchema }),
  z.strictObject({ type: z.literal('attack') }),
  z.strictObject({ type: z.literal('descend') }),
]);

export const ActionIdSchema = z.string().min(1).max(128);

export const GameActionRequestSchema = z.strictObject({
  actionId: ActionIdSchema,
  expectedRevision: z.number().int().nonnegative(),
  command: GameCommandSchema,
});

export const ExecuteGameCommandRequestSchema = GameActionRequestSchema.extend({
  gameId: z.string().min(1),
  sessionToken: z.string().min(1),
});

export const NewGameRequestSchema = z.strictObject({
  playerName: z.string().min(1, 'Name is required'),
  character: CharacterTypeSchema,
});

export const GameDeltaSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('player_pos'),
    x: z.number(),
    y: z.number(),
    facingDirection: FacingDirectionSchema,
  }),
  z.object({
    type: z.literal('player_stats'),
    hp: z.number().optional(),
    maxHp: z.number().optional(),
    attack: z.number().optional(),
    defense: z.number().optional(),
    xp: z.number().optional(),
    level: z.number().optional(),
    xpToNextLevel: z.number().optional(),
  }),
  z.object({
    type: z.literal('player_equipment'),
    equipment: PlayerEquipmentSchema,
  }),
  z.object({ type: z.literal('score'), score: z.number() }),
  z.object({ type: z.literal('floor'), floor: z.number() }),
  z.object({ type: z.literal('enemy_visible'), enemy: EnemySchema }),
  z.object({
    type: z.literal('enemy_moved'),
    enemyId: z.string(),
    x: z.number(),
    y: z.number(),
  }),
  z.object({
    type: z.literal('enemy_damaged'),
    enemyId: z.string(),
    hp: z.number(),
  }),
  z.object({ type: z.literal('enemy_killed'), enemyId: z.string() }),
  z.object({ type: z.literal('enemy_hidden'), enemyId: z.string() }),
  z.object({ type: z.literal('item_visible'), item: ItemSchema }),
  z.object({ type: z.literal('item_removed'), itemId: z.string() }),
  z.object({
    type: z.literal('fog_reveal'),
    cells: z.array(z.tuple([z.number(), z.number()])),
  }),
  z.object({ type: z.literal('visibility'), visibleNow: VisibilityMaskSchema }),
  z.object({ type: z.literal('tiles_reveal'), tiles: z.array(TileSchema) }),
  z.object({ type: z.literal('game_status'), status: GameStatusSchema }),
  z.object({ type: z.literal('event'), event: GameEventSchema }),
  z.object({
    type: z.literal('new_floor'),
    visibleState: VisibleGameStateSchema,
  }),
]);

export const GameCommandResultSchema = z.strictObject({
  actionId: ActionIdSchema,
  revision: z.number().int().nonnegative(),
  state: VisibleGameStateSchema,
  events: z.array(GameEventSchema),
  deltas: z.array(GameDeltaSchema),
});

export const GameErrorCodeSchema = z.enum([
  'UNAUTHORIZED',
  'GAME_NOT_FOUND',
  'INVALID_COMMAND',
  'REVISION_CONFLICT',
  'ACTION_ID_REUSED',
  'GAME_FINISHED',
  'DATABASE_UNAVAILABLE',
  'DATABASE_ERROR',
  'SERVICE_UNAVAILABLE',
  'RATE_LIMITED',
  'INVALID_PLAYER_NAME',
  'PROTOCOL_MISMATCH',
]);

export const GameErrorResponseSchema = z.strictObject({
  error: z.string(),
  code: GameErrorCodeSchema,
  actionId: ActionIdSchema.optional(),
  revision: z.number().int().nonnegative().optional(),
  state: VisibleGameStateSchema.optional(),
});

export const NewGameResponseSchema = z.strictObject({
  gameId: z.string(),
  sessionToken: z.string(),
  revision: z.number().int().nonnegative(),
  state: VisibleGameStateSchema,
});

export const GameStateResponseSchema = z.strictObject({
  revision: z.number().int().nonnegative(),
  state: VisibleGameStateSchema,
});

export type NewGameRequest = z.infer<typeof NewGameRequestSchema>;
export type GameCommandWire = z.infer<typeof GameCommandSchema>;
export type ExecuteGameCommandRequest = z.infer<
  typeof ExecuteGameCommandRequestSchema
>;
export type GameActionRequest = z.infer<typeof GameActionRequestSchema>;
export type GameEventWire = z.infer<typeof GameEventSchema>;
export type VisibleGameState = z.infer<typeof VisibleGameStateSchema>;
export type GameDelta = z.infer<typeof GameDeltaSchema>;
export type GameCommandResult = z.infer<typeof GameCommandResultSchema>;
export type GameErrorCode = z.infer<typeof GameErrorCodeSchema>;
export type GameErrorResponse = z.infer<typeof GameErrorResponseSchema>;
export type NewGameResponse = z.infer<typeof NewGameResponseSchema>;
export type GameStateResponse = z.infer<typeof GameStateResponseSchema>;
