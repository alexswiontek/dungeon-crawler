import {
  calculateEnemyDamage,
  calculatePlayerMeleeDamage,
  calculatePlayerRangedDamage,
} from './combat.js';
import { createVisibilityMask, generateDungeon } from './dungeon-generation.js';
import {
  CHARACTER_STATS,
  type CharacterType,
  type Coordinate,
  type Direction,
  type Enemy,
  type Equipment,
  type EquipmentItem,
  type GameCommand,
  type GameEvent,
  type GameState,
  type GameTransition,
  getEnemyXpReward,
  getXpToNextLevel,
  isEquipmentItem,
  type Player,
} from './model.js';
import type { GameCommandContext } from './random.js';
import {
  ENEMY_SCORES,
  FLEE_HP_THRESHOLD,
  FLOOR_DESCEND_SCORE_BONUS,
  getAttackType,
  getAttackVerb,
  getMissMessage,
  LEVEL_UP_ATTACK_GAIN,
  LEVEL_UP_DEFENSE_GAIN,
  LEVEL_UP_HEAL_PERCENTAGE,
  LEVEL_UP_HP_GAIN,
  MAX_FLOOR,
  MAX_PATHFINDING_ENEMIES,
  VICTORY_SCORE_BONUS,
} from './rules.js';
import {
  findPathToTarget,
  hasLineOfSight,
  recalculateVisibility,
} from './visibility.js';

type EventInput = GameEvent extends infer TEvent
  ? TEvent extends GameEvent
    ? Omit<TEvent, 'id'>
    : never
  : never;

function createEvent(
  context: GameCommandContext,
  event: EventInput,
): GameEvent {
  return { id: context.random.id('event'), ...event } as GameEvent;
}

export interface CreateGameInput {
  gameId: string;
  playerId: string;
  playerName: string;
  character?: CharacterType;
}

export function createGame(
  input: CreateGameInput,
  context: GameCommandContext,
): GameState {
  const character = input.character ?? 'dwarf';
  const dungeon = generateDungeon(1, character, context.random);
  const explored = createVisibilityMask();
  const visibleNow = createVisibilityMask();
  const stats = CHARACTER_STATS[character];
  const now = context.clock.now();
  const player: Player = {
    x: dungeon.playerStart.x,
    y: dungeon.playerStart.y,
    hp: stats.hp,
    maxHp: stats.maxHp,
    attack: stats.attack,
    defense: stats.defense,
    inventory: [],
    xp: 0,
    level: 1,
    xpToNextLevel: getXpToNextLevel(1),
    equipment: {
      weapon: null,
      shield: null,
      armor: null,
      ranged: null,
    },
    character,
    facingDirection: 'left',
  };
  const state: GameState = {
    _id: input.gameId,
    playerId: input.playerId,
    playerName: input.playerName,
    floor: 1,
    player,
    map: dungeon.map,
    enemies: dungeon.enemies,
    items: dungeon.items,
    explored,
    visibleNow,
    status: 'active',
    score: 0,
    createdAt: now,
    updatedAt: now,
  };
  recalculateVisibility(state);
  return state;
}

export function reduceGame(
  state: GameState,
  command: GameCommand,
  context: GameCommandContext,
): GameTransition {
  if (state.status !== 'active') return { state, events: [], accepted: false };

  switch (command.type) {
    case 'move':
      return movePlayer(state, command.direction, context);
    case 'attack':
      return attackAtRange(state, context);
    case 'descend':
      return descendFloor(state, context);
  }
}

export function movePlayer(
  state: GameState,
  direction: Direction,
  context: GameCommandContext,
): GameTransition {
  if (state.status !== 'active') return { state, events: [], accepted: false };

  const offset = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 },
  }[direction];
  const x = state.player.x + offset.x;
  const y = state.player.y + offset.y;
  if (!state.map[y]?.[x] || state.map[y][x].type === 'wall') {
    return { state, events: [], accepted: false };
  }

  const events: GameEvent[] = [];
  const enemy = state.enemies.find(
    (candidate) => candidate.hp > 0 && candidate.x === x && candidate.y === y,
  );
  if (direction === 'left' || direction === 'right') {
    state.player.facingDirection = direction;
  }

  if (enemy) {
    events.push(...attackEnemy(state, enemy, context));
  } else {
    state.player.x = x;
    state.player.y = y;
    events.push(
      createEvent(context, {
        type: 'player_moved',
        message: `Moved ${direction}`,
        data: { direction },
      }),
    );
    events.push(...pickUpItem(state, x, y, context));

    if (state.map[y][x].type === 'stairs') {
      const transition = descendFloor(state, context);
      return {
        state,
        events: [...events, ...transition.events],
        accepted: true,
      };
    }
  }

  if (state.status === 'active') events.push(...runEnemyTurn(state, context));
  recalculateVisibility(state);
  state.updatedAt = context.clock.now();
  return { state, events, accepted: true };
}

export function attackAtRange(
  state: GameState,
  context: GameCommandContext,
): GameTransition {
  if (state.status !== 'active') return { state, events: [], accepted: false };

  const events: GameEvent[] = [];
  const stats = CHARACTER_STATS[state.player.character];
  const range =
    stats.rangedRange + (state.player.equipment.ranged?.rangedRangeBonus ?? 0);
  const direction = state.player.facingDirection === 'right' ? 1 : -1;
  let targetX = state.player.x;
  const targetY = state.player.y;
  let hitEnemy: Enemy | undefined;

  for (let distance = 1; distance <= range; distance++) {
    const x = state.player.x + direction * distance;
    if (!state.map[targetY]?.[x]) {
      targetX = state.player.x + direction * (distance - 1);
      break;
    }
    targetX = x;
    if (state.map[targetY][x].type === 'wall') break;
    hitEnemy = state.enemies.find(
      (enemy) => enemy.hp > 0 && enemy.x === x && enemy.y === targetY,
    );
    if (hitEnemy) break;
  }

  const attackType = getAttackType(state.player.character);
  if (hitEnemy) {
    const damage = calculatePlayerRangedDamage(state.player, hitEnemy);
    hitEnemy.hp -= damage;
    events.push(
      createEvent(context, {
        type: 'ranged_attack',
        message: `${getAttackVerb(state.player.character)} the ${hitEnemy.displayName} for ${damage} damage!`,
        data: {
          targetX,
          targetY,
          damage,
          enemyId: hitEnemy.id,
          attackType,
        },
      }),
    );
    if (hitEnemy.hp <= 0) events.push(...killEnemy(state, hitEnemy, context));
  } else {
    events.push(
      createEvent(context, {
        type: 'ranged_missed',
        message: getMissMessage(state.player.character),
        data: { targetX, targetY, damage: 0, attackType },
      }),
    );
  }

  if (state.status === 'active') events.push(...runEnemyTurn(state, context));
  recalculateVisibility(state);
  state.updatedAt = context.clock.now();
  return { state, events, accepted: true };
}

export function descendFloor(
  state: GameState,
  context: GameCommandContext,
): GameTransition {
  if (state.status !== 'active') return { state, events: [], accepted: false };
  if (state.map[state.player.y]?.[state.player.x]?.type !== 'stairs') {
    return { state, events: [], accepted: false };
  }

  state.floor += 1;
  const dungeon = generateDungeon(
    state.floor,
    state.player.character,
    context.random,
  );
  state.map = dungeon.map;
  state.player.x = dungeon.playerStart.x;
  state.player.y = dungeon.playerStart.y;
  state.enemies = dungeon.enemies;
  state.items = dungeon.items;
  state.explored = createVisibilityMask();
  state.visibleNow = createVisibilityMask();
  state.score += FLOOR_DESCEND_SCORE_BONUS;
  state.updatedAt = context.clock.now();
  recalculateVisibility(state);

  const events: GameEvent[] = [
    createEvent(context, {
      type: 'floor_descended',
      message: `Descended to floor ${state.floor}!`,
      data: { floor: state.floor },
    }),
  ];
  if (state.floor >= MAX_FLOOR) {
    state.status = 'won';
    state.score += VICTORY_SCORE_BONUS;
    events.push(
      createEvent(context, {
        type: 'game_won',
        message: 'You escaped the dungeon! You win!',
      }),
    );
  }
  return { state, events, accepted: true };
}

function attackEnemy(
  state: GameState,
  enemy: Enemy,
  context: GameCommandContext,
): GameEvent[] {
  const damage = calculatePlayerMeleeDamage(state.player.attack, enemy);
  enemy.hp -= damage;
  const events: GameEvent[] = [
    createEvent(context, {
      type: 'player_attacked',
      message: `You hit the ${enemy.displayName} for ${damage} damage!`,
      data: {
        targetX: enemy.x,
        targetY: enemy.y,
        damage,
        enemyId: enemy.id,
      },
    }),
  ];
  if (enemy.hp <= 0) events.push(...killEnemy(state, enemy, context));
  return events;
}

function killEnemy(
  state: GameState,
  enemy: Enemy,
  context: GameCommandContext,
): GameEvent[] {
  state.score += ENEMY_SCORES[enemy.type];
  const events: GameEvent[] = [
    createEvent(context, {
      type: 'enemy_killed',
      message: `You killed the ${enemy.displayName}!`,
      data: { enemyId: enemy.id, enemyType: enemy.type },
    }),
  ];
  events.push(...grantXp(state, enemy, context));
  return events;
}

function grantXp(
  state: GameState,
  enemy: Enemy,
  context: GameCommandContext,
): GameEvent[] {
  const amount = getEnemyXpReward(enemy);
  state.player.xp += amount;
  const events: GameEvent[] = [
    createEvent(context, {
      type: 'xp_gained',
      message: `+${amount} XP`,
      data: { amount, totalXp: state.player.xp },
    }),
  ];

  while (state.player.xp >= state.player.xpToNextLevel) {
    state.player.xp -= state.player.xpToNextLevel;
    state.player.level += 1;
    state.player.maxHp += LEVEL_UP_HP_GAIN;
    state.player.hp = Math.min(
      state.player.maxHp,
      state.player.hp +
        Math.floor(state.player.maxHp * LEVEL_UP_HEAL_PERCENTAGE),
    );
    state.player.attack += LEVEL_UP_ATTACK_GAIN;
    state.player.defense += LEVEL_UP_DEFENSE_GAIN;
    state.player.xpToNextLevel = getXpToNextLevel(state.player.level);
    events.push(
      createEvent(context, {
        type: 'level_up',
        message: `Level up! You are now Level ${state.player.level}!`,
        data: {
          newLevel: state.player.level,
          hpGained: LEVEL_UP_HP_GAIN,
          attackGained: LEVEL_UP_ATTACK_GAIN,
          defenseGained: LEVEL_UP_DEFENSE_GAIN,
        },
      }),
    );
  }
  return events;
}

function getEquipmentTotalBonus(equipment: Equipment): number {
  return (
    equipment.attackBonus +
    equipment.defenseBonus +
    equipment.hpBonus +
    equipment.rangedDamageBonus +
    equipment.rangedRangeBonus
  );
}

function pickUpItem(
  state: GameState,
  x: number,
  y: number,
  context: GameCommandContext,
): GameEvent[] {
  const itemIndex = state.items.findIndex(
    (item) => item.x === x && item.y === y,
  );
  if (itemIndex < 0) return [];
  const item = state.items[itemIndex];

  if (item.type === 'health_potion') {
    if (state.player.hp >= state.player.maxHp) {
      return [
        createEvent(context, {
          type: 'potion_refused',
          message: 'Already at full health!',
        }),
      ];
    }
    state.items.splice(itemIndex, 1);
    const healAmount = Math.min(
      item.value,
      state.player.maxHp - state.player.hp,
    );
    state.player.hp += healAmount;
    return [
      createEvent(context, {
        type: 'player_healed',
        message: `Picked up ${item.name}! Healed for ${healAmount} HP.`,
        data: { itemId: item.id, healAmount },
      }),
    ];
  }

  if (isEquipmentItem(item)) {
    return equipItem(state, item, itemIndex, context);
  }

  state.items.splice(itemIndex, 1);
  state.player.inventory.push(item);
  return [
    createEvent(context, {
      type: 'item_picked_up',
      message: `Picked up ${item.name}`,
      data: { itemId: item.id, itemName: item.name },
    }),
  ];
}

function equipItem(
  state: GameState,
  item: EquipmentItem,
  itemIndex: number,
  context: GameCommandContext,
): GameEvent[] {
  const equipment = item.equipment;
  const current = state.player.equipment[equipment.slot];
  if (
    current &&
    getEquipmentTotalBonus(equipment) <= getEquipmentTotalBonus(current)
  ) {
    return [
      createEvent(context, {
        type: 'equipment_ignored',
        message: `Found ${equipment.name}, but your current gear is better.`,
        data: { equipment, notBetter: true },
      }),
    ];
  }

  state.items.splice(itemIndex, 1);
  if (current) {
    state.player.attack -= current.attackBonus;
    state.player.defense -= current.defenseBonus;
    state.player.maxHp -= current.hpBonus;
  }
  state.player.equipment[equipment.slot] = equipment;
  state.player.attack += equipment.attackBonus;
  state.player.defense += equipment.defenseBonus;
  state.player.maxHp += equipment.hpBonus;
  state.player.hp = Math.min(state.player.hp, state.player.maxHp);

  const bonuses = [
    equipment.attackBonus > 0 ? `+${equipment.attackBonus} ATK` : '',
    equipment.defenseBonus > 0 ? `+${equipment.defenseBonus} DEF` : '',
    equipment.hpBonus > 0 ? `+${equipment.hpBonus} HP` : '',
    equipment.rangedDamageBonus > 0
      ? `+${equipment.rangedDamageBonus} RAN`
      : '',
    equipment.rangedRangeBonus > 0 ? `+${equipment.rangedRangeBonus} RNG` : '',
  ].filter(Boolean);
  return [
    createEvent(context, {
      type: 'equipment_equipped',
      message: `Equipped ${equipment.name}! (${bonuses.join(', ')})`,
      data: { itemId: item.id, equipment, slot: equipment.slot },
    }),
  ];
}

function canMoveToTile(
  state: GameState,
  enemy: Enemy,
  x: number,
  y: number,
): boolean {
  if (!state.map[y]?.[x] || state.map[y][x].type === 'wall') return false;
  if (state.player.x === x && state.player.y === y) return false;
  return !state.enemies.some(
    (candidate) =>
      candidate !== enemy &&
      candidate.hp > 0 &&
      candidate.x === x &&
      candidate.y === y,
  );
}

function isAdjacent(enemy: Enemy, playerX: number, playerY: number): boolean {
  return Math.abs(enemy.x - playerX) + Math.abs(enemy.y - playerY) === 1;
}

function enemyAttack(
  state: GameState,
  enemy: Enemy,
  context: GameCommandContext,
): GameEvent[] {
  const damage = calculateEnemyDamage(enemy, state.player.defense);
  state.player.hp -= damage;
  const events: GameEvent[] = [
    createEvent(context, {
      type: 'player_damaged',
      message: `The ${enemy.displayName} hits you for ${damage} damage!`,
      data: { damage, enemyId: enemy.id },
    }),
  ];
  if (state.player.hp <= 0) {
    state.status = 'dead';
    events.push(
      createEvent(context, {
        type: 'player_died',
        message: `You were killed by a ${enemy.displayName}!`,
        data: {
          killedBy: enemy.displayName,
          killedByType: enemy.type,
          killedByVariant: enemy.variant,
        },
      }),
    );
  }
  return events;
}

function moveFleeingEnemy(state: GameState, enemy: Enemy): boolean {
  const dx = enemy.x > state.player.x ? 1 : enemy.x < state.player.x ? -1 : 0;
  const dy = enemy.y > state.player.y ? 1 : enemy.y < state.player.y ? -1 : 0;
  const candidates = [
    { x: enemy.x + dx, y: enemy.y + dy },
    { x: enemy.x + dx, y: enemy.y },
    { x: enemy.x, y: enemy.y + dy },
    { x: enemy.x + 1, y: enemy.y },
    { x: enemy.x - 1, y: enemy.y },
    { x: enemy.x, y: enemy.y + 1 },
    { x: enemy.x, y: enemy.y - 1 },
  ];
  const target = candidates.find(
    (candidate) =>
      (candidate.x !== enemy.x || candidate.y !== enemy.y) &&
      canMoveToTile(state, enemy, candidate.x, candidate.y),
  );
  if (!target) return false;
  enemy.x = target.x;
  enemy.y = target.y;
  return true;
}

function runEnemyTurn(
  state: GameState,
  context: GameCommandContext,
): GameEvent[] {
  const events: GameEvent[] = [];
  const { x: playerX, y: playerY } = state.player;
  const activeEnemies = state.enemies
    .filter((enemy) => enemy.hp > 0)
    .map((enemy) => ({
      enemy,
      distance: Math.abs(enemy.x - playerX) + Math.abs(enemy.y - playerY),
    }))
    .sort((left, right) => left.distance - right.distance);
  let pathfinds = 0;

  for (const { enemy, distance } of activeEnemies) {
    if (distance > 7) continue;
    const canSeePlayer = hasLineOfSight(
      state,
      enemy.x,
      enemy.y,
      playerX,
      playerY,
    );
    if (canSeePlayer) enemy.lastSeenPlayer = { x: playerX, y: playerY };

    if (enemy.behavior === 'stationary') {
      if (isAdjacent(enemy, playerX, playerY))
        events.push(...enemyAttack(state, enemy, context));
      if (state.status === 'dead') return events;
      continue;
    }

    if (
      enemy.behavior === 'flee' &&
      enemy.hp / enemy.maxHp < FLEE_HP_THRESHOLD &&
      canSeePlayer
    ) {
      moveFleeingEnemy(state, enemy);
      continue;
    }

    if (enemy.behavior === 'patrol' && !canSeePlayer) continue;
    if (!canSeePlayer && !enemy.lastSeenPlayer) continue;
    if (isAdjacent(enemy, playerX, playerY)) {
      events.push(...enemyAttack(state, enemy, context));
      if (state.status === 'dead') return events;
      continue;
    }

    if (pathfinds >= MAX_PATHFINDING_ENEMIES) continue;
    pathfinds += 1;
    const target: Coordinate = canSeePlayer
      ? { x: playerX, y: playerY }
      : (enemy.lastSeenPlayer ?? { x: playerX, y: playerY });
    const step = findPathToTarget(state, enemy.x, enemy.y, target.x, target.y);
    if (step && step.x === playerX && step.y === playerY) {
      events.push(...enemyAttack(state, enemy, context));
    } else if (step && canMoveToTile(state, enemy, step.x, step.y)) {
      enemy.x = step.x;
      enemy.y = step.y;
      if (isAdjacent(enemy, playerX, playerY))
        events.push(...enemyAttack(state, enemy, context));
    }
    if (state.status === 'dead') return events;
  }
  return events;
}
