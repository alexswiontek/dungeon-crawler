import {
  createVisibilityMask,
  type GameEvent,
  type GameState,
} from '@dungeon-crawler/domain';
import { describe, expect, it } from 'vitest';
import {
  diffClientProjections,
  ExecuteGameCommandRequestSchema,
  GAMEPLAY_PROTOCOL_HEADER,
  GAMEPLAY_PROTOCOL_VERSION,
  GameActionRequestSchema,
  GameCommandResultSchema,
  GameErrorResponseSchema,
  GameplayProtocolVersionSchema,
  GameStateResponseSchema,
  NewGameResponseSchema,
  projectGameState,
} from './index.js';

function stateFixture(): GameState {
  const map = Array.from({ length: 8 }, (_, y) =>
    Array.from({ length: 8 }, (_, x) => ({ type: 'floor' as const, x, y })),
  );
  const explored = createVisibilityMask(8, 8);
  const visibleNow = createVisibilityMask(8, 8);
  explored[1][1] = true;
  explored[2][2] = true;
  visibleNow[2][2] = true;
  const timestamp = new Date('2026-08-18T00:00:00.000Z');
  return {
    _id: 'game-1',
    playerId: 'private-player-id',
    playerName: 'Ada',
    floor: 1,
    player: {
      x: 2,
      y: 2,
      hp: 20,
      maxHp: 20,
      attack: 4,
      defense: 2,
      inventory: [],
      xp: 0,
      level: 1,
      xpToNextLevel: 50,
      equipment: { weapon: null, shield: null, armor: null, ranged: null },
      character: 'wizard',
      facingDirection: 'right',
    },
    map,
    enemies: [
      {
        id: 'visible',
        type: 'rat',
        variant: 'normal',
        displayName: 'Rat',
        x: 2,
        y: 2,
        hp: 6,
        maxHp: 6,
        attack: 4,
        defense: 0,
        behavior: 'flee',
      },
      {
        id: 'explored-but-hidden',
        type: 'orc',
        variant: 'normal',
        displayName: 'Orc',
        x: 1,
        y: 1,
        hp: 25,
        maxHp: 25,
        attack: 13,
        defense: 4,
        behavior: 'aggressive',
      },
    ],
    items: [],
    explored,
    visibleNow,
    status: 'active',
    score: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

describe('wire protocol', () => {
  it('defines one runtime-validated gameplay protocol version', () => {
    expect(GAMEPLAY_PROTOCOL_HEADER).toBe('x-dungeon-crawler-protocol-version');
    expect(GameplayProtocolVersionSchema.parse(GAMEPLAY_PROTOCOL_VERSION)).toBe(
      '1',
    );
    expect(GameplayProtocolVersionSchema.safeParse('0').success).toBe(false);
  });

  it('validates the action body and five-concept service request from their runtime schemas', () => {
    const request = {
      gameId: 'game-1',
      sessionToken: 'secret-token',
      actionId: 'action-1',
      expectedRevision: 7,
      command: { type: 'move' as const, direction: 'left' as const },
    };
    expect(ExecuteGameCommandRequestSchema.parse(request)).toEqual(request);
    expect(
      GameActionRequestSchema.parse({
        actionId: 'action-1',
        expectedRevision: 7,
        command: request.command,
      }),
    ).toEqual({
      actionId: 'action-1',
      expectedRevision: 7,
      command: request.command,
    });
    expect(() =>
      ExecuteGameCommandRequestSchema.parse({
        ...request,
        command: { type: 'move', direction: 'diagonal' },
      }),
    ).toThrow();
  });

  it('creates the only visibility-filtered client projection', () => {
    const projection = projectGameState(stateFixture());

    expect(projection.visibleTiles).toHaveLength(2);
    expect(projection.visibleEnemies.map((enemy) => enemy.id)).toEqual([
      'visible',
    ]);
    expect(projection).not.toHaveProperty('playerId');
    expect(projection).not.toHaveProperty('map');
    expect(projection.explored[1][1]).toBe(true);
    expect(projection.visibleNow[1][1]).toBe(false);
  });

  it('uses the same projection diff for visibility transitions after any command', () => {
    const state = stateFixture();
    const before = projectGameState(state);
    state.visibleNow[1][1] = true;
    const after = projectGameState(state);
    const events: GameEvent[] = [];

    expect(diffClientProjections(before, after, events)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'visibility' }),
        expect.objectContaining({
          type: 'enemy_visible',
          enemy: expect.objectContaining({ id: 'explored-but-hidden' }),
        }),
      ]),
    );
  });

  it('defines strict create, read, action, and typed error responses', () => {
    const state = projectGameState(stateFixture(), 7);
    const result = {
      actionId: 'action-1',
      revision: 7,
      state,
      events: [],
      deltas: [],
    };
    expect(
      NewGameResponseSchema.parse({
        gameId: 'game-1',
        sessionToken: 'one-time-token',
        revision: 7,
        state,
      }),
    ).toMatchObject({ gameId: 'game-1', sessionToken: 'one-time-token' });
    expect(GameStateResponseSchema.parse({ revision: 7, state })).toEqual({
      revision: 7,
      state,
    });
    expect(GameCommandResultSchema.parse(result)).toEqual(result);
    expect(
      GameErrorResponseSchema.parse({
        error: 'Synchronize first',
        code: 'REVISION_CONFLICT',
        actionId: 'action-1',
        revision: 7,
        state,
      }),
    ).toMatchObject({ code: 'REVISION_CONFLICT', revision: 7 });
    expect(
      GameErrorResponseSchema.parse({
        error: 'Wait briefly and try again',
        code: 'RATE_LIMITED',
      }),
    ).toMatchObject({ code: 'RATE_LIMITED' });
    expect(() =>
      GameCommandResultSchema.parse({ ...result, sessionToken: 'secret' }),
    ).toThrow();
  });

  it.each([
    {},
    { actionId: '', expectedRevision: 0, command: { type: 'attack' } },
    {
      actionId: 'x'.repeat(129),
      expectedRevision: 0,
      command: { type: 'attack' },
    },
    { actionId: 'action-1', expectedRevision: -1, command: { type: 'attack' } },
    {
      actionId: 'action-1',
      expectedRevision: 0,
      command: { type: 'move', direction: 'diagonal' },
    },
  ])('rejects an invalid HTTP action body', (body) => {
    expect(GameActionRequestSchema.safeParse(body).success).toBe(false);
  });
});
