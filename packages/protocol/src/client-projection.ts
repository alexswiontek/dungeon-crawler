import type {
  Enemy,
  GameEvent,
  GameState,
  Item,
  Player,
  Tile,
} from '@dungeon-crawler/domain';
import type { GameDelta, VisibleGameState } from './schemas.js';

function clonePlayer(player: Player): Player {
  return {
    ...player,
    inventory: player.inventory.map((item) => ({ ...item })),
    equipment: { ...player.equipment },
  };
}

function cloneEnemy(enemy: Enemy): Enemy {
  return {
    ...enemy,
    ...(enemy.lastSeenPlayer && {
      lastSeenPlayer: { ...enemy.lastSeenPlayer },
    }),
  };
}

function cloneItem(item: Item): Item {
  return { ...item };
}

export function projectGameState(
  state: GameState,
  revision = 0,
): VisibleGameState {
  const visibleTiles: Tile[] = [];
  for (let y = 0; y < state.map.length; y++) {
    for (let x = 0; x < (state.map[y]?.length ?? 0); x++) {
      if (state.explored[y]?.[x] && state.map[y]?.[x]) {
        visibleTiles.push({ ...state.map[y][x] });
      }
    }
  }

  return {
    _id: state._id,
    revision,
    playerName: state.playerName,
    floor: state.floor,
    player: clonePlayer(state.player),
    visibleTiles,
    visibleEnemies: state.enemies
      .filter((enemy) => enemy.hp > 0 && state.visibleNow[enemy.y]?.[enemy.x])
      .map(cloneEnemy),
    visibleItems: state.items
      .filter((item) => state.visibleNow[item.y]?.[item.x])
      .map(cloneItem),
    explored: state.explored.map((row) => [...row]),
    visibleNow: state.visibleNow.map((row) => [...row]),
    status: state.status,
    score: state.score,
  };
}

function equipmentChanged(before: Player, after: Player): boolean {
  return (
    before.equipment.weapon?.id !== after.equipment.weapon?.id ||
    before.equipment.shield?.id !== after.equipment.shield?.id ||
    before.equipment.armor?.id !== after.equipment.armor?.id ||
    before.equipment.ranged?.id !== after.equipment.ranged?.id
  );
}

export function diffClientProjections(
  before: VisibleGameState,
  after: VisibleGameState,
  events: GameEvent[],
): GameDelta[] {
  if (before.floor !== after.floor) {
    return [
      ...events.map((event): GameDelta => ({ type: 'event', event })),
      { type: 'new_floor', visibleState: after },
    ];
  }

  const deltas: GameDelta[] = [];
  if (
    before.player.x !== after.player.x ||
    before.player.y !== after.player.y ||
    before.player.facingDirection !== after.player.facingDirection
  ) {
    deltas.push({
      type: 'player_pos',
      x: after.player.x,
      y: after.player.y,
      facingDirection: after.player.facingDirection,
    });
  }

  const stats = {
    hp: after.player.hp !== before.player.hp ? after.player.hp : undefined,
    maxHp:
      after.player.maxHp !== before.player.maxHp
        ? after.player.maxHp
        : undefined,
    attack:
      after.player.attack !== before.player.attack
        ? after.player.attack
        : undefined,
    defense:
      after.player.defense !== before.player.defense
        ? after.player.defense
        : undefined,
    xp: after.player.xp !== before.player.xp ? after.player.xp : undefined,
    level:
      after.player.level !== before.player.level
        ? after.player.level
        : undefined,
    xpToNextLevel:
      after.player.xpToNextLevel !== before.player.xpToNextLevel
        ? after.player.xpToNextLevel
        : undefined,
  };
  if (Object.values(stats).some((value) => value !== undefined)) {
    deltas.push({ type: 'player_stats', ...stats });
  }
  if (equipmentChanged(before.player, after.player)) {
    deltas.push({
      type: 'player_equipment',
      equipment: after.player.equipment,
    });
  }
  if (before.score !== after.score)
    deltas.push({ type: 'score', score: after.score });

  const revealed: [number, number][] = [];
  for (let y = 0; y < after.explored.length; y++) {
    for (let x = 0; x < (after.explored[y]?.length ?? 0); x++) {
      if (after.explored[y][x] && !before.explored[y]?.[x])
        revealed.push([x, y]);
    }
  }
  if (revealed.length > 0) {
    const byCoordinate = new Map(
      after.visibleTiles.map((tile) => [`${tile.x},${tile.y}`, tile]),
    );
    deltas.push({ type: 'fog_reveal', cells: revealed });
    deltas.push({
      type: 'tiles_reveal',
      tiles: revealed
        .map(([x, y]) => byCoordinate.get(`${x},${y}`))
        .filter((tile): tile is Tile => tile !== undefined),
    });
  }

  if (JSON.stringify(before.visibleNow) !== JSON.stringify(after.visibleNow)) {
    deltas.push({
      type: 'visibility',
      visibleNow: after.visibleNow.map((row) => [...row]),
    });
  }

  const beforeEnemies = new Map(
    before.visibleEnemies.map((enemy) => [enemy.id, enemy]),
  );
  const afterEnemies = new Map(
    after.visibleEnemies.map((enemy) => [enemy.id, enemy]),
  );
  for (const enemy of after.visibleEnemies) {
    const previous = beforeEnemies.get(enemy.id);
    if (!previous) {
      deltas.push({ type: 'enemy_visible', enemy });
      continue;
    }
    if (previous.x !== enemy.x || previous.y !== enemy.y) {
      deltas.push({
        type: 'enemy_moved',
        enemyId: enemy.id,
        x: enemy.x,
        y: enemy.y,
      });
    }
    if (previous.hp !== enemy.hp) {
      deltas.push({ type: 'enemy_damaged', enemyId: enemy.id, hp: enemy.hp });
    }
  }
  for (const enemy of before.visibleEnemies) {
    if (afterEnemies.has(enemy.id)) continue;
    const killed = events.some(
      (event) =>
        event.type === 'enemy_killed' && event.data?.enemyId === enemy.id,
    );
    deltas.push(
      killed
        ? { type: 'enemy_killed', enemyId: enemy.id }
        : { type: 'enemy_hidden', enemyId: enemy.id },
    );
  }

  const beforeItems = new Map(
    before.visibleItems.map((item) => [item.id, item]),
  );
  const afterItems = new Map(after.visibleItems.map((item) => [item.id, item]));
  for (const item of after.visibleItems) {
    if (!beforeItems.has(item.id)) deltas.push({ type: 'item_visible', item });
  }
  for (const item of before.visibleItems) {
    if (!afterItems.has(item.id))
      deltas.push({ type: 'item_removed', itemId: item.id });
  }

  if (before.status !== after.status) {
    deltas.push({ type: 'game_status', status: after.status });
  }
  for (const event of events) deltas.push({ type: 'event', event });
  return deltas;
}
