import { randomUUID } from 'node:crypto';
import {
  CHARACTER_STATS,
  type CharacterType,
  type Coordinate,
  type Direction,
  type Enemy,
  type Equipment,
  type GameDelta,
  type GameEvent,
  type GameState,
  getEnemyXpReward,
  getXpToNextLevel,
  type Item,
  isEquipmentEquippedEvent,
  isEquipmentItem,
  isItemPickupEvent,
  MAP_HEIGHT,
  MAP_WIDTH,
  type RangedAttackEventData,
  type Tile,
  VISION_RADIUS,
  type VisibleGameState,
} from '@dungeon-crawler/shared';
import { generateMap, initializeFog } from '@/services/mapGenerator.js';

// Event ID generation - uses timestamp + counter for uniqueness
let eventIdCounter = 0;
function generateEventId(): string {
  return `${Date.now()}-${eventIdCounter++}`;
}

// ============================================
// Visibility Filtering (Anti-Cheat)
// ============================================

export function getVisibleEnemies(state: GameState): Enemy[] {
  return state.enemies.filter(
    (e) => e.hp > 0 && state.fog[e.y]?.[e.x] === true,
  );
}

export function getVisibleItems(state: GameState): Item[] {
  return state.items.filter((i) => state.fog[i.y]?.[i.x] === true);
}

export function getVisibleTiles(state: GameState): Tile[] {
  const tiles: Tile[] = [];
  for (let y = 0; y < state.map.length; y++) {
    for (let x = 0; x < state.map[0].length; x++) {
      if (state.fog[y][x]) {
        tiles.push(state.map[y][x]);
      }
    }
  }
  return tiles;
}

export function getVisibleState(state: GameState): VisibleGameState {
  return {
    _id: state._id,
    playerName: state.playerName,
    floor: state.floor,
    player: state.player,
    visibleTiles: getVisibleTiles(state),
    visibleEnemies: getVisibleEnemies(state),
    visibleItems: getVisibleItems(state),
    fog: state.fog,
    status: state.status,
    score: state.score,
  };
}

// ============================================
// Delta Generation
// ============================================

interface MoveResult {
  events: GameEvent[];
  deltas: GameDelta[];
}

export function processMoveWithDeltas(
  state: GameState,
  direction: Direction,
): MoveResult {
  const deltas: GameDelta[] = [];

  // Capture state before move
  const prevPlayerX = state.player.x;
  const prevPlayerY = state.player.y;
  const prevFacingDirection = state.player.facingDirection;
  const prevPlayerHp = state.player.hp;
  const prevPlayerMaxHp = state.player.maxHp;
  const prevPlayerAttack = state.player.attack;
  const prevPlayerDefense = state.player.defense;
  const prevPlayerXp = state.player.xp;
  const prevPlayerLevel = state.player.level;
  const prevPlayerXpToNextLevel = state.player.xpToNextLevel;
  const prevPlayerEquipment = { ...state.player.equipment };
  const prevScore = state.score;
  const prevFog = state.fog.map((row) => [...row]); // Deep copy
  const prevVisibleEnemyIds = new Set(
    getVisibleEnemies(state).map((e) => e.id),
  );
  const prevVisibleItemIds = new Set(getVisibleItems(state).map((i) => i.id));
  const prevEnemyPositions = new Map(
    state.enemies.map((e) => [e.id, { x: e.x, y: e.y, hp: e.hp }]),
  );

  // Process the move (mutates state)
  const events = processMove(state, direction);

  // Generate deltas by comparing before/after

  // Player position delta (includes facing direction)
  if (
    state.player.x !== prevPlayerX ||
    state.player.y !== prevPlayerY ||
    state.player.facingDirection !== prevFacingDirection
  ) {
    deltas.push({
      type: 'player_pos',
      x: state.player.x,
      y: state.player.y,
      facingDirection: state.player.facingDirection,
    });
  }

  // Player stats delta (HP, maxHP, attack, defense, XP, level)
  const statsChanged =
    state.player.hp !== prevPlayerHp ||
    state.player.maxHp !== prevPlayerMaxHp ||
    state.player.attack !== prevPlayerAttack ||
    state.player.defense !== prevPlayerDefense ||
    state.player.xp !== prevPlayerXp ||
    state.player.level !== prevPlayerLevel ||
    state.player.xpToNextLevel !== prevPlayerXpToNextLevel;

  if (statsChanged) {
    deltas.push({
      type: 'player_stats',
      ...(state.player.hp !== prevPlayerHp && { hp: state.player.hp }),
      ...(state.player.maxHp !== prevPlayerMaxHp && {
        maxHp: state.player.maxHp,
      }),
      ...(state.player.attack !== prevPlayerAttack && {
        attack: state.player.attack,
      }),
      ...(state.player.defense !== prevPlayerDefense && {
        defense: state.player.defense,
      }),
      ...(state.player.xp !== prevPlayerXp && { xp: state.player.xp }),
      ...(state.player.level !== prevPlayerLevel && {
        level: state.player.level,
      }),
      ...(state.player.xpToNextLevel !== prevPlayerXpToNextLevel && {
        xpToNextLevel: state.player.xpToNextLevel,
      }),
    });
  }

  // Equipment delta
  const equipmentChanged =
    state.player.equipment.weapon !== prevPlayerEquipment.weapon ||
    state.player.equipment.shield !== prevPlayerEquipment.shield ||
    state.player.equipment.armor !== prevPlayerEquipment.armor ||
    state.player.equipment.ranged !== prevPlayerEquipment.ranged;

  if (equipmentChanged) {
    deltas.push({
      type: 'player_equipment',
      equipment: state.player.equipment,
    });
  }

  // Score delta
  if (state.score !== prevScore) {
    deltas.push({ type: 'score', score: state.score });
  }

  // Fog reveal delta - find newly revealed cells
  const newlyRevealedCells: [number, number][] = [];
  const newlyRevealedTiles: Tile[] = [];
  for (let y = 0; y < state.fog.length; y++) {
    for (let x = 0; x < state.fog[0].length; x++) {
      if (state.fog[y][x] && !prevFog[y][x]) {
        newlyRevealedCells.push([x, y]);
        newlyRevealedTiles.push(state.map[y][x]);
      }
    }
  }
  if (newlyRevealedCells.length > 0) {
    deltas.push({ type: 'fog_reveal', cells: newlyRevealedCells });
    deltas.push({ type: 'tiles_reveal', tiles: newlyRevealedTiles });
  }

  // Enemy visibility deltas
  const currentVisibleEnemies = getVisibleEnemies(state);
  const currentVisibleEnemyIds = new Set(
    currentVisibleEnemies.map((e) => e.id),
  );

  // Enemies that became visible
  for (const enemy of currentVisibleEnemies) {
    if (!prevVisibleEnemyIds.has(enemy.id)) {
      deltas.push({ type: 'enemy_visible', enemy });
    }
  }

  // Enemies that are no longer visible (moved out of fog or died)
  for (const prevId of prevVisibleEnemyIds) {
    if (!currentVisibleEnemyIds.has(prevId)) {
      const enemy = state.enemies.find((e) => e.id === prevId);
      if (enemy && enemy.hp <= 0) {
        deltas.push({ type: 'enemy_killed', enemyId: prevId });
      } else {
        deltas.push({ type: 'enemy_hidden', enemyId: prevId });
      }
    }
  }

  // Enemy movement/damage deltas (for enemies that stayed visible)
  for (const enemy of currentVisibleEnemies) {
    if (prevVisibleEnemyIds.has(enemy.id)) {
      const prev = prevEnemyPositions.get(enemy.id);
      if (prev) {
        if (enemy.x !== prev.x || enemy.y !== prev.y) {
          deltas.push({
            type: 'enemy_moved',
            enemyId: enemy.id,
            x: enemy.x,
            y: enemy.y,
          });
        }
        if (enemy.hp !== prev.hp) {
          deltas.push({
            type: 'enemy_damaged',
            enemyId: enemy.id,
            hp: enemy.hp,
          });
        }
      }
    }
  }

  // Item visibility deltas
  const currentVisibleItems = getVisibleItems(state);
  for (const item of currentVisibleItems) {
    if (!prevVisibleItemIds.has(item.id)) {
      deltas.push({ type: 'item_visible', item });
    }
  }

  // Item removal deltas
  for (const event of events) {
    // Handle both regular item pickups and equipment equips
    if (isItemPickupEvent(event) || isEquipmentEquippedEvent(event)) {
      deltas.push({
        type: 'item_removed',
        itemId: event.data.itemId,
      });
    }
  }

  // Game status delta
  if (state.status !== 'active') {
    deltas.push({ type: 'game_status', status: state.status });
  }

  // Add events as deltas for HUD
  for (const event of events) {
    deltas.push({ type: 'event', event });
  }

  // Floor change is handled specially - send full visible state
  if (events.some((e) => e.type === 'floor_descended')) {
    deltas.push({
      type: 'new_floor',
      visibleState: getVisibleState(state),
    });
  }

  return { events, deltas };
}

export function createNewGame(
  playerName: string,
  playerId: string,
  character: CharacterType = 'dwarf',
): GameState {
  const { map, playerStart, enemies, items } = generateMap(1, character);
  const fog = initializeFog();

  // Get character-specific stats
  const stats = CHARACTER_STATS[character];

  const gameState: GameState = {
    _id: randomUUID(),
    playerId,
    playerName,
    floor: 1,
    player: {
      x: playerStart.x,
      y: playerStart.y,
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
      facingDirection: 'left', // Sprites face left by default
    },
    map,
    enemies,
    items,
    fog,
    status: 'active',
    score: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  // Reveal initial area around player
  updateFog(gameState);

  return gameState;
}

export function updateFog(state: GameState): void {
  const { x: px, y: py } = state.player;

  for (let dy = -VISION_RADIUS; dy <= VISION_RADIUS; dy++) {
    for (let dx = -VISION_RADIUS; dx <= VISION_RADIUS; dx++) {
      const x = px + dx;
      const y = py + dy;

      if (x >= 0 && x < state.map[0].length && y >= 0 && y < state.map.length) {
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance <= VISION_RADIUS) {
          state.fog[y][x] = true;
        }
      }
    }
  }
}

export function processMove(
  state: GameState,
  direction: Direction,
): GameEvent[] {
  const events: GameEvent[] = [];

  if (state.status !== 'active') {
    return events;
  }

  const dx = direction === 'left' ? -1 : direction === 'right' ? 1 : 0;
  const dy = direction === 'up' ? -1 : direction === 'down' ? 1 : 0;

  const newX = state.player.x + dx;
  const newY = state.player.y + dy;

  // Check bounds
  if (
    newY < 0 ||
    newY >= state.map.length ||
    newX < 0 ||
    newX >= state.map[0].length
  ) {
    return events;
  }

  // Check for wall
  if (state.map[newY][newX].type === 'wall') {
    return events;
  }

  // Check for enemy at target position
  const enemyAtTarget = state.enemies.find(
    (e) => e.x === newX && e.y === newY && e.hp > 0,
  );
  if (enemyAtTarget) {
    // Attack the enemy instead of moving
    // Update facing direction on horizontal attack
    if (direction === 'left') {
      state.player.facingDirection = 'left';
    } else if (direction === 'right') {
      state.player.facingDirection = 'right';
    }
    const attackEvents = attackEnemy(state, enemyAtTarget);
    events.push(...attackEvents);
  } else {
    // Move player
    state.player.x = newX;
    state.player.y = newY;
    // Update facing direction on horizontal movement
    if (direction === 'left') {
      state.player.facingDirection = 'left';
    } else if (direction === 'right') {
      state.player.facingDirection = 'right';
    }
    events.push({
      id: generateEventId(),
      type: 'player_moved',
      message: `Moved ${direction}`,
    });

    // Check for items
    const itemIndex = state.items.findIndex(
      (i) => i.x === newX && i.y === newY,
    );
    if (itemIndex !== -1) {
      const item = state.items[itemIndex];

      if (item.type === 'health_potion') {
        // Check if already at max HP
        if (state.player.hp >= state.player.maxHp) {
          events.push({
            id: generateEventId(),
            type: 'potion_refused',
            message: `Already at full health!`,
          });
          // Don't remove item from ground - leave it there
        } else {
          state.items.splice(itemIndex, 1);
          const healAmount = Math.min(
            item.value,
            state.player.maxHp - state.player.hp,
          );
          state.player.hp += healAmount;
          events.push({
            id: generateEventId(),
            type: 'player_healed',
            message: `Picked up ${item.name}! Healed for ${healAmount} HP.`,
            data: { itemId: item.id, healAmount },
          });
        }
      } else if (isEquipmentItem(item)) {
        const equipEvents = handleEquipmentPickup(state, item, itemIndex);
        events.push(...equipEvents);
      } else {
        state.items.splice(itemIndex, 1);
        state.player.inventory.push(item);
        events.push({
          id: generateEventId(),
          type: 'item_picked_up',
          message: `Picked up ${item.name}`,
          data: { itemId: item.id, itemName: item.name },
        });
      }
    }

    // Auto-descend if stepped on stairs
    if (state.map[newY][newX].type === 'stairs') {
      const descendEvents = descendStairs(state);
      events.push(...descendEvents);
      return events; // Skip enemy movement on floor change
    }
  }

  // Update fog of war
  updateFog(state);

  // Move enemies towards player
  if (state.status === 'active') {
    const enemyEvents = moveEnemies(state);
    events.push(...enemyEvents);
  }

  // Update timestamp
  state.updatedAt = new Date();

  return events;
}

// Get attack type based on character
function getAttackType(
  character: CharacterType,
): 'bolt' | 'dagger' | 'magic_dagger' | 'spell' {
  switch (character) {
    case 'bandit':
      return 'bolt';
    case 'wizard':
      return 'spell';
    case 'elf':
      return 'magic_dagger';
    default:
      return 'dagger';
  }
}

// Get attack verb for messages
function getAttackVerb(character: CharacterType): string {
  switch (character) {
    case 'bandit':
      return 'Your bolt hits';
    case 'wizard':
      return 'Your spell blasts';
    case 'elf':
      return 'Your magic dagger strikes';
    default:
      return 'Your dagger strikes';
  }
}

// Get miss message based on character
function getMissMessage(character: CharacterType): string {
  switch (character) {
    case 'bandit':
      return 'Your bolt missed!';
    case 'wizard':
      return 'Your spell missed!';
    case 'elf':
      return 'Your magic dagger missed!';
    default:
      return 'Your dagger missed!';
  }
}

// Process ranged attack action (spacebar - shoots in facing direction)
export function processAttack(state: GameState): GameEvent[] {
  const events: GameEvent[] = [];

  if (state.status !== 'active') {
    return events;
  }

  // Get character-specific ranged stats + equipment bonus
  const stats = CHARACTER_STATS[state.player.character];
  const rangedEquipment = state.player.equipment.ranged;
  const rangedDamage =
    stats.rangedDamage + (rangedEquipment?.rangedDamageBonus ?? 0);
  const rangedRange =
    stats.rangedRange + (rangedEquipment?.rangedRangeBonus ?? 0);
  const attackType = getAttackType(state.player.character);

  // Direction based on facing
  const dx = state.player.facingDirection === 'right' ? 1 : -1;
  const playerX = state.player.x;
  const playerY = state.player.y;

  // Scan tiles in facing direction up to range
  let hitEnemy: Enemy | null = null;
  let hitX = playerX;
  let hitY = playerY;

  for (let i = 1; i <= rangedRange; i++) {
    const checkX = playerX + dx * i;
    const checkY = playerY;

    // Check bounds
    if (checkX < 0 || checkX >= state.map[0].length) {
      hitX = playerX + dx * (i - 1);
      break;
    }

    // Check for wall
    if (state.map[checkY][checkX].type === 'wall') {
      hitX = checkX;
      hitY = checkY;
      break;
    }

    // Check for enemy
    const enemy = state.enemies.find(
      (e) => e.x === checkX && e.y === checkY && e.hp > 0,
    );

    if (enemy) {
      hitEnemy = enemy;
      hitX = checkX;
      hitY = checkY;
      break;
    }

    // Update furthest point reached
    hitX = checkX;
    hitY = checkY;
  }

  if (hitEnemy) {
    // Calculate damage (ranged damage - enemy defense, minimum 1)
    const damage = Math.max(1, rangedDamage - hitEnemy.defense);
    hitEnemy.hp -= damage;

    const eventData: RangedAttackEventData = {
      targetX: hitX,
      targetY: hitY,
      damage,
      enemyId: hitEnemy.id,
      attackType,
    };

    events.push({
      id: generateEventId(),
      type: 'ranged_attack',
      message: `${getAttackVerb(state.player.character)} the ${hitEnemy.displayName} for ${damage} damage!`,
      data: eventData,
    });

    if (hitEnemy.hp <= 0) {
      state.score += getEnemyScore(hitEnemy.type);
      events.push({
        id: generateEventId(),
        type: 'enemy_killed',
        message: `You killed the ${hitEnemy.displayName}!`,
        data: { enemyId: hitEnemy.id, enemyType: hitEnemy.type },
      });

      // Grant XP for killing the enemy
      const xpEvents = grantXp(state, hitEnemy);
      events.push(...xpEvents);
    }
  } else {
    // Missed - projectile hit wall or went max range
    const eventData: RangedAttackEventData = {
      targetX: hitX,
      targetY: hitY,
      damage: 0,
      attackType,
    };

    events.push({
      id: generateEventId(),
      type: 'ranged_missed',
      message: getMissMessage(state.player.character),
      data: eventData,
    });
  }

  // Move enemies towards player after ranged attack
  if (state.status === 'active') {
    const enemyEvents = moveEnemies(state);
    events.push(...enemyEvents);
  }

  // Update timestamp
  state.updatedAt = new Date();

  return events;
}

// Process attack with delta generation for WebSocket
export function processAttackWithDeltas(state: GameState): MoveResult {
  const deltas: GameDelta[] = [];

  // Capture state before attack
  const prevPlayerHp = state.player.hp;
  const prevPlayerMaxHp = state.player.maxHp;
  const prevPlayerAttack = state.player.attack;
  const prevPlayerDefense = state.player.defense;
  const prevPlayerXp = state.player.xp;
  const prevPlayerLevel = state.player.level;
  const prevPlayerXpToNextLevel = state.player.xpToNextLevel;
  const prevScore = state.score;
  const prevEnemyPositions = new Map(
    state.enemies.map((e) => [e.id, { x: e.x, y: e.y, hp: e.hp }]),
  );

  // Process the attack (mutates state)
  const events = processAttack(state);

  // Player stats delta (HP, XP, level may change from combat)
  const statsChanged =
    state.player.hp !== prevPlayerHp ||
    state.player.maxHp !== prevPlayerMaxHp ||
    state.player.attack !== prevPlayerAttack ||
    state.player.defense !== prevPlayerDefense ||
    state.player.xp !== prevPlayerXp ||
    state.player.level !== prevPlayerLevel ||
    state.player.xpToNextLevel !== prevPlayerXpToNextLevel;

  if (statsChanged) {
    deltas.push({
      type: 'player_stats',
      ...(state.player.hp !== prevPlayerHp && { hp: state.player.hp }),
      ...(state.player.maxHp !== prevPlayerMaxHp && {
        maxHp: state.player.maxHp,
      }),
      ...(state.player.attack !== prevPlayerAttack && {
        attack: state.player.attack,
      }),
      ...(state.player.defense !== prevPlayerDefense && {
        defense: state.player.defense,
      }),
      ...(state.player.xp !== prevPlayerXp && { xp: state.player.xp }),
      ...(state.player.level !== prevPlayerLevel && {
        level: state.player.level,
      }),
      ...(state.player.xpToNextLevel !== prevPlayerXpToNextLevel && {
        xpToNextLevel: state.player.xpToNextLevel,
      }),
    });
  }

  // Score delta
  if (state.score !== prevScore) {
    deltas.push({ type: 'score', score: state.score });
  }

  // Enemy deltas (damage, movement, death)
  for (const enemy of state.enemies) {
    const prev = prevEnemyPositions.get(enemy.id);
    if (!prev) continue;

    if (enemy.hp !== prev.hp && enemy.hp > 0) {
      deltas.push({ type: 'enemy_damaged', enemyId: enemy.id, hp: enemy.hp });
    }
    if (enemy.hp <= 0 && prev.hp > 0) {
      deltas.push({ type: 'enemy_killed', enemyId: enemy.id });
    }
    if (enemy.x !== prev.x || enemy.y !== prev.y) {
      deltas.push({
        type: 'enemy_moved',
        enemyId: enemy.id,
        x: enemy.x,
        y: enemy.y,
      });
    }
  }

  // Game status delta
  if (state.status !== 'active') {
    deltas.push({ type: 'game_status', status: state.status });
  }

  // Add events as deltas
  for (const event of events) {
    deltas.push({ type: 'event', event });
  }

  return { events, deltas };
}

function attackEnemy(state: GameState, enemy: Enemy): GameEvent[] {
  const events: GameEvent[] = [];

  // Calculate damage
  const damage = Math.max(1, state.player.attack - enemy.defense);
  enemy.hp -= damage;

  events.push({
    id: generateEventId(),
    type: 'player_attacked',
    message: `You hit the ${enemy.displayName} for ${damage} damage!`,
    data: {
      targetX: enemy.x,
      targetY: enemy.y,
      damage,
      enemyId: enemy.id,
    },
  });

  if (enemy.hp <= 0) {
    state.score += getEnemyScore(enemy.type);
    events.push({
      id: generateEventId(),
      type: 'enemy_killed',
      message: `You killed the ${enemy.displayName}!`,
      data: { enemyId: enemy.id, enemyType: enemy.type },
    });

    // Grant XP for killing the enemy
    const xpEvents = grantXp(state, enemy);
    events.push(...xpEvents);
  }

  return events;
}

// Grant XP and handle level ups
function grantXp(state: GameState, enemy: Enemy): GameEvent[] {
  const events: GameEvent[] = [];
  const xpReward = getEnemyXpReward(enemy);

  state.player.xp += xpReward;
  events.push({
    id: generateEventId(),
    type: 'xp_gained',
    message: `+${xpReward} XP`,
    data: { amount: xpReward, totalXp: state.player.xp },
  });

  // Check for level up (can level up multiple times)
  while (state.player.xp >= state.player.xpToNextLevel) {
    state.player.xp -= state.player.xpToNextLevel;
    state.player.level += 1;

    // Stat gains per level
    const hpGained = 3;
    const attackGained = 1;
    const defenseGained = 1;

    state.player.maxHp += hpGained;
    // Heal 50% of max HP on level up (not full heal)
    const healAmount = Math.floor(state.player.maxHp * 0.5);
    state.player.hp = Math.min(
      state.player.maxHp,
      state.player.hp + healAmount,
    );
    state.player.attack += attackGained;
    state.player.defense += defenseGained;
    state.player.xpToNextLevel = getXpToNextLevel(state.player.level);

    events.push({
      id: generateEventId(),
      type: 'level_up',
      message: `Level up! You are now Level ${state.player.level}!`,
      data: {
        newLevel: state.player.level,
        hpGained,
        attackGained,
        defenseGained,
      },
    });
  }

  return events;
}

function getEnemyScore(type: string): number {
  switch (type) {
    case 'rat':
      return 10;
    case 'skeleton':
      return 25;
    case 'orc':
      return 50;
    case 'dragon':
      return 200;
    default:
      return 10;
  }
}

// Calculate total stat bonus from equipment
function getEquipmentTotalBonus(equipment: Equipment): number {
  return (
    equipment.attackBonus +
    equipment.defenseBonus +
    equipment.hpBonus +
    equipment.rangedDamageBonus +
    equipment.rangedRangeBonus
  );
}

// Handle equipment pickup with auto-equip if better
function handleEquipmentPickup(
  state: GameState,
  item: { id: string; equipment: Equipment; x: number; y: number },
  itemIndex: number,
): GameEvent[] {
  const events: GameEvent[] = [];
  const equipment = item.equipment;
  const slot = equipment.slot;
  const currentEquipment = state.player.equipment[slot];

  // Check if new equipment is better
  const currentBonus = currentEquipment
    ? getEquipmentTotalBonus(currentEquipment)
    : 0;
  const newBonus = getEquipmentTotalBonus(equipment);
  const isBetter = newBonus > currentBonus;

  if (isBetter || !currentEquipment) {
    // Remove item from ground
    state.items.splice(itemIndex, 1);

    // Swap equipment stats: remove old, add new
    if (currentEquipment) {
      state.player.attack -= currentEquipment.attackBonus;
      state.player.defense -= currentEquipment.defenseBonus;
      state.player.maxHp -= currentEquipment.hpBonus;
    }

    // Equip new equipment
    state.player.equipment[slot] = equipment;
    state.player.attack += equipment.attackBonus;
    state.player.defense += equipment.defenseBonus;
    state.player.maxHp += equipment.hpBonus;

    // Clamp HP to max after all stat changes are applied
    if (state.player.hp > state.player.maxHp) {
      state.player.hp = state.player.maxHp;
    }

    // Generate event
    const statBonuses: string[] = [];
    if (equipment.attackBonus > 0)
      statBonuses.push(`+${equipment.attackBonus} ATK`);
    if (equipment.defenseBonus > 0)
      statBonuses.push(`+${equipment.defenseBonus} DEF`);
    if (equipment.hpBonus > 0) statBonuses.push(`+${equipment.hpBonus} HP`);
    if (equipment.rangedDamageBonus > 0)
      statBonuses.push(`+${equipment.rangedDamageBonus} RAN`);
    if (equipment.rangedRangeBonus > 0)
      statBonuses.push(`+${equipment.rangedRangeBonus} RNG`);

    events.push({
      id: generateEventId(),
      type: 'equipment_equipped',
      message: `Equipped ${equipment.name}! (${statBonuses.join(', ')})`,
      data: { itemId: item.id, equipment, slot },
    });
  } else {
    // Equipment is not better, leave it on the ground
    events.push({
      id: generateEventId(),
      type: 'equipment_found',
      message: `Found ${equipment.name}, but your current gear is better.`,
      data: { equipment, notBetter: true },
    });
  }

  return events;
}

/**
 * Check if there's a clear line of sight between two points
 * Uses Bresenham's line algorithm with safety guards
 */
export function hasLineOfSight(
  state: GameState,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): boolean {
  // Early exit: same point always has LOS
  if (x1 === x2 && y1 === y2) return true;

  const dx = Math.abs(x2 - x1);
  const dy = Math.abs(y2 - y1);
  const sx = x1 < x2 ? 1 : -1;
  const sy = y1 < y2 ? 1 : -1;
  let err = dx - dy;

  let x = x1;
  let y = y1;

  // Safety: max iterations = map diagonal to prevent infinite loops
  const maxIterations = MAP_WIDTH + MAP_HEIGHT;

  for (let i = 0; i < maxIterations; i++) {
    // Skip the starting position for wall checks
    if (x !== x1 || y !== y1) {
      // Reached the target
      if (x === x2 && y === y2) {
        return true;
      }
      // Check if this tile blocks vision (only walls block)
      if (state.map[y]?.[x]?.type === 'wall') {
        return false;
      }
    }

    // Reached the target (also check at start position)
    if (x === x2 && y === y2) {
      return true;
    }

    const e2 = 2 * err;
    const prevX = x;
    const prevY = y;

    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }

    // Deadlock detection: neither coordinate advanced
    if (x === prevX && y === prevY) {
      console.error('[LOS] Deadlock detected:', {
        x1,
        y1,
        x2,
        y2,
        x,
        y,
        dx,
        dy,
        err,
      });
      return false;
    }
  }

  console.error('[LOS] Max iterations exceeded:', { x1, y1, x2, y2 });
  return false;
}

interface PathNode extends Coordinate {
  path: Coordinate[];
}

/**
 * Find path from start to target using BFS
 * Returns the next step to take, or null if no path exists
 */
export function findPathToTarget(
  state: GameState,
  startX: number,
  startY: number,
  targetX: number,
  targetY: number,
  maxDistance: number = 20,
): Coordinate | null {
  // If at target, no need to move
  if (startX === targetX && startY === targetY) {
    return null;
  }

  // BFS
  const visited = new Set<string>();
  const queue: PathNode[] = [];
  queue.push({ x: startX, y: startY, path: [] });
  visited.add(`${startX},${startY}`);

  const directions = [
    { dx: 0, dy: -1 }, // up
    { dx: 0, dy: 1 }, // down
    { dx: -1, dy: 0 }, // left
    { dx: 1, dy: 0 }, // right
  ];

  // Safety: limit total iterations to prevent infinite loops
  const MAX_ITERATIONS = MAP_WIDTH * MAP_HEIGHT; // Worst case: visit every tile
  let iterations = 0;

  let current = queue.shift();
  while (current) {
    if (++iterations > MAX_ITERATIONS) {
      console.error('[BFS] Max iterations exceeded', {
        startX,
        startY,
        targetX,
        targetY,
        iterations,
      });
      return null;
    }
    // Limit search distance - must get next item, not continue!
    if (current.path.length >= maxDistance) {
      current = queue.shift();
      continue;
    }

    for (const dir of directions) {
      const nx = current.x + dir.dx;
      const ny = current.y + dir.dy;
      const key = `${nx},${ny}`;

      // Skip if already visited
      if (visited.has(key)) continue;
      visited.add(key);

      // Check bounds
      if (
        nx < 0 ||
        nx >= state.map[0].length ||
        ny < 0 ||
        ny >= state.map.length
      ) {
        continue;
      }

      // Check if walkable
      if (state.map[ny][nx].type === 'wall') continue;

      // Check for other enemies (can't walk through them)
      const hasEnemy = state.enemies.some(
        (e) => e.x === nx && e.y === ny && e.hp > 0,
      );

      // Check for player (can walk to player tile as target)
      const isPlayer = nx === state.player.x && ny === state.player.y;

      const newPath = [...current.path, { x: nx, y: ny }];

      // Found the target
      if (nx === targetX && ny === targetY) {
        return newPath[0] || null;
      }

      // Can only continue if tile is empty (no enemies blocking)
      if (!hasEnemy && !isPlayer) {
        queue.push({ x: nx, y: ny, path: newPath });
      }
    }
    current = queue.shift();
  }

  return null; // No path found
}

/**
 * Check if enemy can move to a specific tile
 */
export function canMoveToTile(
  state: GameState,
  enemy: Enemy,
  x: number,
  y: number,
): boolean {
  // Check bounds
  if (x < 0 || x >= state.map[0].length || y < 0 || y >= state.map.length) {
    return false;
  }
  // Check wall
  if (state.map[y][x].type === 'wall') {
    return false;
  }
  // Check player position
  if (x === state.player.x && y === state.player.y) {
    return false;
  }
  // Check other enemies
  if (
    state.enemies.some((e) => e !== enemy && e.x === x && e.y === y && e.hp > 0)
  ) {
    return false;
  }
  return true;
}

/**
 * Enemy attacks player and generates events
 */
function enemyAttackPlayer(state: GameState, enemy: Enemy): GameEvent[] {
  const events: GameEvent[] = [];

  const damage = Math.max(1, enemy.attack - state.player.defense);
  state.player.hp -= damage;

  events.push({
    id: generateEventId(),
    type: 'player_damaged',
    message: `The ${enemy.displayName} hits you for ${damage} damage!`,
  });

  if (state.player.hp <= 0) {
    state.status = 'dead';
    events.push({
      id: generateEventId(),
      type: 'player_died',
      message: `You were killed by a ${enemy.displayName}!`,
      data: { killedBy: enemy.type },
    });
  }

  return events;
}

/**
 * Check if enemy is adjacent to player (orthogonal only)
 */
function isAdjacentToPlayer(enemy: Enemy, px: number, py: number): boolean {
  const dx = Math.abs(px - enemy.x);
  const dy = Math.abs(py - enemy.y);
  return (dx === 1 && dy === 0) || (dx === 0 && dy === 1);
}

// Max enemies to process pathfinding for per turn (performance optimization)
const MAX_PATHFINDING_ENEMIES = 5;

function moveEnemies(state: GameState): GameEvent[] {
  const moveStart = performance.now();
  const events: GameEvent[] = [];
  const { x: px, y: py } = state.player;

  // Sort enemies by distance to player and process closest ones first
  // This ensures we prioritize nearby threats while limiting expensive pathfinding
  const activeEnemies = state.enemies
    .filter((e) => e.hp > 0)
    .map((e) => ({
      enemy: e,
      dist: Math.abs(e.x - px) + Math.abs(e.y - py),
    }))
    .sort((a, b) => a.dist - b.dist);

  let pathfindingCount = 0;
  let pathfindingTotalTime = 0;

  for (const { enemy, dist } of activeEnemies) {
    // Check if player is within detection range
    if (dist > VISION_RADIUS + 2) {
      // Enemy too far - skip for now (patrol behavior could be added here)
      continue;
    }

    // Check line of sight to player
    const canSeePlayer = hasLineOfSight(state, enemy.x, enemy.y, px, py);

    if (canSeePlayer) {
      // Remember where we last saw the player
      enemy.lastSeenPlayer = { x: px, y: py };
    }

    // Handle different AI behaviors
    switch (enemy.behavior) {
      case 'flee':
      case 'aggressive': {
        // Flee behavior: run away when HP is low (below 30%)
        if (enemy.behavior === 'flee') {
          const hpPercent = enemy.hp / enemy.maxHp;
          if (hpPercent < 0.3 && canSeePlayer) {
            // Move away from player
            const fleeX = enemy.x + (enemy.x > px ? 1 : -1);
            const fleeY = enemy.y + (enemy.y > py ? 1 : -1);

            // Try horizontal flee first, then vertical
            if (canMoveToTile(state, enemy, fleeX, enemy.y)) {
              enemy.x = fleeX;
            } else if (canMoveToTile(state, enemy, enemy.x, fleeY)) {
              enemy.y = fleeY;
            }
            continue;
          }
          // If not low HP, fall through to aggressive behavior
        }

        // Aggressive behavior:
        if (!canSeePlayer && !enemy.lastSeenPlayer) {
          // Can't see player and never saw them - do nothing
          continue;
        }

        const targetX = canSeePlayer ? px : (enemy.lastSeenPlayer?.x ?? px);
        const targetY = canSeePlayer ? py : (enemy.lastSeenPlayer?.y ?? py);

        // Check if adjacent to player (attack)
        if (isAdjacentToPlayer(enemy, px, py)) {
          const attackEvents = enemyAttackPlayer(state, enemy);
          events.push(...attackEvents);
          if (state.status === 'dead') return events;
          continue;
        }

        // Use pathfinding to move toward target (limit pathfinding calls for performance)
        let step: Coordinate | null = null;
        if (pathfindingCount < MAX_PATHFINDING_ENEMIES) {
          pathfindingCount++;
          const pathStart = performance.now();
          step = findPathToTarget(state, enemy.x, enemy.y, targetX, targetY);
          pathfindingTotalTime += performance.now() - pathStart;
        }
        if (step) {
          // Check if stepping to player position (shouldn't happen but safety check)
          if (step.x === px && step.y === py) {
            // Adjacent, attack instead
            const attackEvents = enemyAttackPlayer(state, enemy);
            events.push(...attackEvents);
            if (state.status === 'dead') return events;
          } else if (canMoveToTile(state, enemy, step.x, step.y)) {
            enemy.x = step.x;
            enemy.y = step.y;

            // Check if now adjacent to player and attack
            if (isAdjacentToPlayer(enemy, px, py)) {
              const attackEvents = enemyAttackPlayer(state, enemy);
              events.push(...attackEvents);
              if (state.status === 'dead') return events;
            }
          }
        } else if (!canSeePlayer && enemy.lastSeenPlayer) {
          // Reached last known position but player not there - clear memory
          if (
            enemy.x === enemy.lastSeenPlayer.x &&
            enemy.y === enemy.lastSeenPlayer.y
          ) {
            enemy.lastSeenPlayer = undefined;
          }
        }
        break;
      }

      case 'patrol': {
        // Patrol enemies only chase if they can see the player
        if (canSeePlayer) {
          // Check if adjacent first
          if (isAdjacentToPlayer(enemy, px, py)) {
            const attackEvents = enemyAttackPlayer(state, enemy);
            events.push(...attackEvents);
            if (state.status === 'dead') return events;
            continue;
          }

          // Chase player while visible (limit pathfinding calls for performance)
          let step: Coordinate | null = null;
          if (pathfindingCount < MAX_PATHFINDING_ENEMIES) {
            pathfindingCount++;
            const pathStart = performance.now();
            step = findPathToTarget(state, enemy.x, enemy.y, px, py);
            pathfindingTotalTime += performance.now() - pathStart;
          }
          if (step && canMoveToTile(state, enemy, step.x, step.y)) {
            enemy.x = step.x;
            enemy.y = step.y;

            // Check if now adjacent and attack
            if (isAdjacentToPlayer(enemy, px, py)) {
              const attackEvents = enemyAttackPlayer(state, enemy);
              events.push(...attackEvents);
              if (state.status === 'dead') return events;
            }
          }
        }
        // If can't see player, do nothing (could add patrol points later)
        break;
      }

      case 'stationary': {
        // Only attack if player adjacent
        if (isAdjacentToPlayer(enemy, px, py)) {
          const attackEvents = enemyAttackPlayer(state, enemy);
          events.push(...attackEvents);
          if (state.status === 'dead') return events;
        }
        break;
      }
    }
  }

  const moveTime = performance.now() - moveStart;
  if (moveTime > 50) {
    console.warn(
      `[PERF] moveEnemies took ${moveTime.toFixed(1)}ms (pathfinding: ${pathfindingCount} calls, ${pathfindingTotalTime.toFixed(1)}ms total)`,
    );
  }

  return events;
}

export function descendStairs(state: GameState): GameEvent[] {
  const events: GameEvent[] = [];

  if (state.status !== 'active') {
    return events;
  }

  const { x, y } = state.player;
  const currentTile = state.map[y][x];

  if (currentTile.type !== 'stairs') {
    return events;
  }

  // Generate new floor
  state.floor += 1;
  const { map, playerStart, enemies, items } = generateMap(
    state.floor,
    state.player.character,
  );

  state.map = map;
  state.player.x = playerStart.x;
  state.player.y = playerStart.y;
  state.enemies = enemies;
  state.items = items;
  state.fog = initializeFog();

  // Reveal area around player
  updateFog(state);

  state.score += 100;
  state.updatedAt = new Date();

  events.push({
    id: generateEventId(),
    type: 'floor_descended',
    message: `Descended to floor ${state.floor}!`,
  });

  // Win condition: reach floor 20
  if (state.floor >= 20) {
    state.status = 'won';
    state.score += 1000;
    events.push({
      id: generateEventId(),
      type: 'game_won',
      message: 'You escaped the dungeon! You win!',
    });
  }

  return events;
}
