import type {
  GameActionRequest,
  GameCommandResult,
} from '@dungeon-crawler/protocol';
import {
  GAMEPLAY_PROTOCOL_HEADER,
  GAMEPLAY_PROTOCOL_VERSION,
} from '@dungeon-crawler/protocol';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '@/App';
import { useUiStore } from '@/stores/uiStore';
import { StoreHelpers } from '@/test/helpers/storeHelpers';

describe('browser gameplay smoke test', () => {
  let now: number;
  let actionRequests: GameActionRequest[];
  let actionGate: Promise<void> | null;
  let nextActionFailure: Error | null;
  let nextConflict = false;
  let nextInvalidCommand = false;

  beforeEach(() => {
    actionRequests = [];
    actionGate = null;
    nextActionFailure = null;
    nextConflict = false;
    nextInvalidCommand = false;
    now = Date.now() + 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/games') && init?.method === 'POST') {
          const initialState = StoreHelpers.visibleGameState({
            _id: 'smoke-game',
            playerName: 'Ada',
            visibleEnemies: [
              StoreHelpers.enemy({
                id: 'smoke-enemy',
                x: 8,
                y: 5,
                hp: 10,
                maxHp: 10,
              }),
            ],
          });
          return jsonResponse(
            {
              gameId: 'smoke-game',
              sessionToken: 'smoke-session-token',
              revision: 0,
              state: initialState,
            },
            201,
          );
        }
        if (url.endsWith('/games/smoke-game/actions')) {
          const request = JSON.parse(String(init?.body)) as GameActionRequest;
          actionRequests.push(request);
          if (actionGate) {
            const gate = actionGate;
            actionGate = null;
            await gate;
          }
          if (nextActionFailure) {
            const failure = nextActionFailure;
            nextActionFailure = null;
            throw failure;
          }
          if (nextConflict) {
            nextConflict = false;
            const conflictState = StoreHelpers.visibleGameState({
              _id: 'smoke-game',
              revision: 7,
              playerName: 'Ada',
              player: { x: 9, y: 9 },
            });
            return jsonResponse(
              {
                error: 'Synchronize first',
                code: 'REVISION_CONFLICT',
                actionId: request.actionId,
                revision: 7,
                state: conflictState,
              },
              409,
            );
          }
          if (nextInvalidCommand) {
            nextInvalidCommand = false;
            return jsonResponse(
              {
                error: 'The command is not valid for the current game state',
                code: 'INVALID_COMMAND',
                actionId: request.actionId,
                revision: 0,
                state: StoreHelpers.visibleGameState({
                  _id: 'smoke-game',
                  playerName: 'Ada',
                }),
              },
              400,
            );
          }
          return jsonResponse(actionResult(request));
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('keeps normal pending actions unobtrusive while serializing input', async () => {
    let releaseAction!: () => void;
    actionGate = new Promise<void>((resolve) => {
      releaseAction = resolve;
    });
    const game = await startGame();

    now += 100;
    fireEvent.keyDown(game, { key: 'ArrowRight' });
    await waitFor(() => expect(actionRequests).toHaveLength(1));
    expect(screen.queryByText('Saving action...')).toBeNull();
    expect(screen.queryByText('Action needs confirmation')).toBeNull();

    now += 500;
    fireEvent.keyDown(game, { key: ' ' });
    expect(actionRequests).toHaveLength(1);

    act(() => releaseAction());
    expect(await screen.findAllByText('Moved right')).not.toHaveLength(0);
  });

  it('shows the retry overlay only after an ambiguous failure', async () => {
    nextActionFailure = new Error('Connection interrupted');
    const game = await startGame();

    now += 100;
    fireEvent.keyDown(game, { key: 'ArrowRight' });
    expect(await screen.findByText('Action needs confirmation')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry Action' })).toBeTruthy();
    expect(actionRequests).toHaveLength(1);

    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Retry Action' }));
    await waitFor(() => expect(actionRequests).toHaveLength(2));
    expect(actionRequests[1]).toEqual(actionRequests[0]);
    await waitFor(() =>
      expect(screen.queryByText('Action needs confirmation')).toBeNull(),
    );
  });

  it('creates, moves, attacks, descends, and finishes through HTTP actions', async () => {
    const game = await startGame();

    await sendKey(game, 'ArrowRight', 100, 1);
    expect(actionRequests[0]).toMatchObject({
      expectedRevision: 0,
      command: { type: 'move', direction: 'right' },
    });

    await sendKey(game, ' ', 500, 2);
    expect(actionRequests[1]).toMatchObject({
      expectedRevision: 1,
      command: { type: 'attack' },
    });

    await sendKey(game, 'ArrowRight', 100, 3);
    expect(actionRequests[2]).toMatchObject({
      expectedRevision: 2,
      command: { type: 'move', direction: 'right' },
    });

    now += 100;
    fireEvent.keyDown(game, { key: 'ArrowRight' });
    expect(
      await screen.findByRole('heading', { name: 'Victory!' }),
    ).toBeTruthy();
    expect(actionRequests[3]).toMatchObject({
      expectedRevision: 3,
      command: { type: 'move', direction: 'right' },
    });
    expect(screen.getByText('You escaped the dungeon!')).toBeTruthy();
  });

  it('shows conflict resynchronization without replaying the rejected input', async () => {
    nextConflict = true;
    const game = await startGame();

    now += 100;
    fireEvent.keyDown(game, { key: 'ArrowRight' });

    expect(
      await screen.findByText(
        'This game changed in another tab. The latest server state is now shown.',
      ),
    ).toBeTruthy();
    expect(actionRequests).toHaveLength(1);
    expect(screen.queryByText('Action needs confirmation')).toBeNull();
  });

  it('silently ignores a wall collision and continues with the latest input', async () => {
    nextInvalidCommand = true;
    const game = await startGame();

    now += 100;
    fireEvent.keyDown(game, { key: 'ArrowLeft' });
    await waitFor(() => expect(actionRequests).toHaveLength(1));
    now += 100;
    fireEvent.keyDown(game, { key: 'ArrowRight' });

    expect(await screen.findAllByText('Moved right')).not.toHaveLength(0);
    expect(actionRequests).toHaveLength(2);
    expect(actionRequests[1]).toMatchObject({
      expectedRevision: 0,
      command: { type: 'move', direction: 'right' },
    });
    expect(
      screen.queryByText('The command is not valid for the current game state'),
    ).toBeNull();
  });

  it('clears projectiles left by the previous game before starting another', async () => {
    useUiStore.getState().addEvents([
      StoreHelpers.event({
        id: 'old-spell',
        type: 'ranged_attack',
        message: 'Old spell',
        data: {
          targetX: 8,
          targetY: 5,
          damage: 6,
          attackType: 'spell',
        },
      }),
    ]);

    await startGame();

    expect(document.querySelector('.spell-orb')).toBeNull();
  });

  async function startGame(): Promise<HTMLElement> {
    const user = userEvent.setup();
    render(<App />);
    await user.type(await screen.findByRole('textbox'), 'Ada');
    await user.click(screen.getByRole('button', { name: 'Start Game' }));
    return screen.findByRole('application', {
      name: 'Dungeon Crawler game',
    });
  }

  async function sendKey(
    game: HTMLElement,
    key: string,
    elapsed: number,
    expectedRequests: number,
  ): Promise<void> {
    now += elapsed;
    fireEvent.keyDown(game, { key });
    await waitFor(() => expect(actionRequests).toHaveLength(expectedRequests));
    await waitFor(() =>
      expect(screen.queryByText('Action needs confirmation')).toBeNull(),
    );
  }
});

function actionResult(request: GameActionRequest): GameCommandResult {
  const revision = request.expectedRevision + 1;
  if (revision === 1) {
    const state = StoreHelpers.visibleGameState({
      _id: 'smoke-game',
      revision,
      playerName: 'Ada',
      player: { x: 6, y: 5 },
    });
    return {
      actionId: request.actionId,
      revision,
      state,
      events: [
        StoreHelpers.event({
          id: 'move-event',
          type: 'player_moved',
          message: 'Moved right',
        }),
      ],
      deltas: [StoreHelpers.delta.playerPos(6, 5, 'right')],
    };
  }
  if (revision === 2) {
    const state = StoreHelpers.visibleGameState({
      _id: 'smoke-game',
      revision,
      playerName: 'Ada',
      player: { x: 6, y: 5 },
      visibleEnemies: [
        StoreHelpers.enemy({
          id: 'smoke-enemy',
          x: 8,
          y: 5,
          hp: 4,
          maxHp: 10,
        }),
      ],
    });
    return {
      actionId: request.actionId,
      revision,
      state,
      events: [
        StoreHelpers.event({
          id: 'attack-event',
          type: 'ranged_attack',
          message: 'Your dagger strikes the Rat for 6 damage!',
          data: {
            targetX: 8,
            targetY: 5,
            damage: 6,
            enemyId: 'smoke-enemy',
            attackType: 'dagger',
          },
        }),
      ],
      deltas: [StoreHelpers.delta.enemyDamaged('smoke-enemy', 4)],
    };
  }
  if (revision === 3) {
    const state = StoreHelpers.visibleGameState({
      _id: 'smoke-game',
      revision,
      playerName: 'Ada',
      floor: 2,
    });
    return {
      actionId: request.actionId,
      revision,
      state,
      events: [],
      deltas: [StoreHelpers.delta.newFloor(state)],
    };
  }
  const state = StoreHelpers.visibleGameState({
    _id: 'smoke-game',
    revision,
    playerName: 'Ada',
    floor: 20,
    status: 'won',
    score: 1_200,
  });
  return {
    actionId: request.actionId,
    revision,
    state,
    events: [],
    deltas: [StoreHelpers.delta.newFloor(state)],
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      [GAMEPLAY_PROTOCOL_HEADER]: GAMEPLAY_PROTOCOL_VERSION,
    },
  });
}
