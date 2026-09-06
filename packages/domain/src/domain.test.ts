import { describe, expect, it } from 'vitest';
import { calculateRangedAttackPower } from './combat.js';
import { createVisibilityMask } from './dungeon-generation.js';
import type { GameCommand, GameState } from './model.js';
import {
  createSeededRandom,
  fixedClock,
  type GameCommandContext,
} from './random.js';
import { attackAtRange, createGame, movePlayer } from './transition.js';
import { recalculateVisibility } from './visibility.js';

function context(seed = 'domain-test'): GameCommandContext {
  return {
    clock: fixedClock('2026-08-18T12:00:00.000Z'),
    random: createSeededRandom(seed),
  };
}

function stateFixture(overrides: Partial<GameState> = {}): GameState {
  const width = 12;
  const height = 12;
  const map = Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => ({
      type:
        x === 0 || y === 0 || x === width - 1 || y === height - 1
          ? ('wall' as const)
          : ('floor' as const),
      x,
      y,
    })),
  );
  const timestamp = new Date('2026-08-18T00:00:00.000Z');
  return {
    _id: 'game-1',
    playerId: 'player-1',
    playerName: 'Ada',
    floor: 1,
    player: {
      x: 5,
      y: 5,
      hp: 24,
      maxHp: 24,
      attack: 4,
      defense: 4,
      inventory: [],
      xp: 0,
      level: 1,
      xpToNextLevel: 50,
      equipment: { weapon: null, shield: null, armor: null, ranged: null },
      character: 'bandit',
      facingDirection: 'right',
    },
    map,
    enemies: [],
    items: [],
    explored: createVisibilityMask(width, height),
    visibleNow: createVisibilityMask(width, height),
    status: 'active',
    score: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

describe('domain boundaries', () => {
  it('defines commands as an exhaustive discriminated union', () => {
    const commands = [
      { type: 'move', direction: 'left' },
      { type: 'attack' },
      { type: 'descend' },
    ] satisfies GameCommand[];

    expect(commands.map((command) => command.type)).toEqual([
      'move',
      'attack',
      'descend',
    ]);
  });

  it('creates the same game from the same injected time and seed', () => {
    const input = {
      gameId: 'game-1',
      playerId: 'player-1',
      playerName: 'Ada',
      character: 'wizard' as const,
    };

    expect(createGame(input, context('same-seed'))).toEqual(
      createGame(input, context('same-seed')),
    );
  });

  it('emits movement and pickup events through the domain transition', () => {
    const state = stateFixture();
    state.player.hp = 10;
    state.items = [
      {
        id: 'potion',
        type: 'health_potion',
        name: 'Health Potion',
        x: 6,
        y: 5,
        value: 10,
      },
    ];

    const transition = movePlayer(state, 'right', context());

    expect(transition.accepted).toBe(true);
    expect(state.player).toMatchObject({ x: 6, y: 5, hp: 20 });
    expect(transition.events.map((event) => event.type)).toEqual([
      'player_moved',
      'player_healed',
    ]);
  });

  it('uses one ranged calculation for base, equipment, and level scaling', () => {
    const state = stateFixture();
    state.player.level = 4;
    state.player.equipment.ranged = {
      id: 'crossbow',
      slot: 'ranged',
      name: 'Crossbow',
      attackBonus: 0,
      defenseBonus: 0,
      hpBonus: 0,
      rangedDamageBonus: 2,
      rangedRangeBonus: 0,
      tier: 1,
    };
    state.enemies = [
      {
        id: 'rat',
        type: 'rat',
        variant: 'normal',
        displayName: 'Rat',
        x: 7,
        y: 5,
        hp: 100,
        maxHp: 100,
        attack: 0,
        defense: 0,
        behavior: 'stationary',
      },
    ];

    expect(calculateRangedAttackPower(state.player)).toBe(11);
    const transition = attackAtRange(state, context());
    expect(state.enemies[0].hp).toBe(89);
    expect(transition.events[0]).toMatchObject({
      type: 'ranged_attack',
      data: { damage: 11 },
    });
  });

  it('emits damage, kill, XP, and progression events', () => {
    const state = stateFixture();
    state.player.xp = 45;
    state.enemies = [
      {
        id: 'rat',
        type: 'rat',
        variant: 'normal',
        displayName: 'Rat',
        x: 6,
        y: 5,
        hp: 1,
        maxHp: 6,
        attack: 0,
        defense: 0,
        behavior: 'stationary',
      },
    ];

    const transition = movePlayer(state, 'right', context());
    expect(transition.events.map((event) => event.type)).toEqual([
      'player_attacked',
      'enemy_killed',
      'xp_gained',
      'level_up',
    ]);
    expect(state.player.level).toBe(2);
  });

  it('emits a floor transition and keeps playing below the final floor', () => {
    const state = stateFixture({ floor: 19 });
    state.map[5][6] = { type: 'stairs', x: 6, y: 5 };

    const transition = movePlayer(state, 'right', context('descend'));

    expect(state).toMatchObject({ floor: 20, status: 'active' });
    expect(state.enemies.length).toBeGreaterThan(0);
    expect(transition.events.map((event) => event.type)).toEqual([
      'player_moved',
      'floor_descended',
    ]);
  });

  it('emits victory when taking the stairs on the final floor', () => {
    const state = stateFixture({ floor: 20 });
    state.map[5][6] = { type: 'stairs', x: 6, y: 5 };

    const transition = movePlayer(state, 'right', context('victory'));

    expect(state).toMatchObject({ floor: 20, status: 'won' });
    expect(transition.events.map((event) => event.type)).toEqual([
      'player_moved',
      'game_won',
    ]);
  });

  it('emits damage and death events from an enemy turn', () => {
    const state = stateFixture();
    state.player.hp = 1;
    state.player.defense = 0;
    state.enemies = [
      {
        id: 'orc',
        type: 'orc',
        variant: 'normal',
        displayName: 'Orc',
        x: 4,
        y: 6,
        hp: 25,
        maxHp: 25,
        attack: 4,
        defense: 4,
        behavior: 'stationary',
      },
    ];

    const transition = movePlayer(state, 'down', context());
    expect(state.status).toBe('dead');
    expect(transition.events.map((event) => event.type)).toEqual([
      'player_moved',
      'player_damaged',
      'player_died',
    ]);
  });

  it('uses a legal diagonal when it is the best remaining flee route', () => {
    const state = stateFixture();
    state.player.x = 8;
    state.player.y = 6;
    state.player.facingDirection = 'right';
    state.enemies = [
      {
        id: 'fleeing-rat',
        type: 'rat',
        variant: 'normal',
        displayName: 'Rat',
        x: 6,
        y: 6,
        hp: 1,
        maxHp: 6,
        attack: 0,
        defense: 0,
        behavior: 'flee',
      },
    ];
    for (let y = 5; y <= 7; y++) {
      for (let x = 5; x <= 7; x++) {
        state.map[y][x] = { type: 'wall', x, y };
      }
    }
    state.map[6][6] = { type: 'floor', x: 6, y: 6 };
    state.map[6][7] = { type: 'floor', x: 7, y: 6 };
    state.map[7][5] = { type: 'floor', x: 5, y: 7 };

    attackAtRange(state, context());

    expect(state.enemies[0]).toMatchObject({ x: 5, y: 7 });
  });

  it('prioritizes a visible chaser over stale remembered targets', () => {
    const state = stateFixture();
    state.player.x = 2;
    state.player.y = 2;
    state.player.facingDirection = 'left';
    for (let y = 1; y <= 7; y++) {
      state.map[y][3] = { type: 'wall', x: 3, y };
    }
    state.enemies = [
      ...Array.from({ length: 5 }, (_, index) => ({
        id: `stale-${index}`,
        type: 'skeleton' as const,
        variant: 'normal' as const,
        displayName: 'Skeleton',
        x: 4,
        y: 2 + index,
        hp: 12,
        maxHp: 12,
        attack: 0,
        defense: 0,
        behavior: 'aggressive' as const,
        lastSeenPlayer: { x: 4, y: 8 },
      })),
      {
        id: 'visible-chaser',
        type: 'skeleton',
        variant: 'normal',
        displayName: 'Skeleton',
        x: 2,
        y: 8,
        hp: 12,
        maxHp: 12,
        attack: 0,
        defense: 0,
        behavior: 'aggressive',
      },
    ];

    attackAtRange(state, context());

    expect(state.enemies.at(-1)).toMatchObject({ x: 2, y: 7 });
  });

  it('retains explored terrain while recalculating visibleNow', () => {
    const state = stateFixture();
    state.explored[1][1] = true;
    state.visibleNow[1][1] = true;

    recalculateVisibility(state);

    expect(state.explored[1][1]).toBe(true);
    expect(state.visibleNow[1][1]).toBe(false);
    expect(state.visibleNow[5][5]).toBe(true);
  });
});
