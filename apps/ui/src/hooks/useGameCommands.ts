import type {
  Direction,
  GameCommand,
  GameEvent,
} from '@dungeon-crawler/domain';
import type {
  GameActionRequest,
  GameCommandResult,
  GameStateResponse,
  VisibleGameState,
} from '@dungeon-crawler/protocol';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  api,
  GameApiError,
  isInvalidSessionError,
  isRetryableActionError,
} from '@/api';
import { GameState } from '@/engine/GameState';
import { useGameStore } from '@/stores/gameStore';

interface UseGameCommandsResult {
  gameState: GameState;
  events: GameEvent[];
  error: string | null;
  sendMove: (direction: Direction) => void;
  sendAttack: () => void;
  retryAction: () => void;
  damagedEntities: string[];
  hasPlayer: boolean;
  status: string;
  actionPending: boolean;
  retryAvailable: boolean;
}

interface UseGameCommandsOptions {
  initialGame: GameStateResponse;
  onSessionInvalid: () => void;
}

const MOVE_THROTTLE_MS = 80;
const ATTACK_COOLDOWN_MS = 400;
const globalGameState = new GameState();

let hasPlayerSnapshot = false;
let statusSnapshot: string = 'active';
const playerListeners = new Set<() => void>();
const statusListeners = new Set<() => void>();

function subscribeToGameState(callback: () => void): () => void {
  playerListeners.add(callback);
  return () => playerListeners.delete(callback);
}

function subscribeToGameStatus(callback: () => void): () => void {
  statusListeners.add(callback);
  return () => statusListeners.delete(callback);
}

function getHasPlayerSnapshot(): boolean {
  return hasPlayerSnapshot;
}

function getStatusSnapshot(): string {
  return statusSnapshot;
}

function publishGameState(): void {
  const nextHasPlayer = globalGameState.player !== null;
  const nextStatus = globalGameState.status;
  if (nextHasPlayer !== hasPlayerSnapshot) {
    hasPlayerSnapshot = nextHasPlayer;
    for (const listener of playerListeners) listener();
  }
  if (nextStatus !== statusSnapshot) {
    statusSnapshot = nextStatus;
    for (const listener of statusListeners) listener();
  }
}

export function useGameCommands(
  gameId: string,
  sessionToken: string,
  { initialGame, onSessionInvalid }: UseGameCommandsOptions,
): UseGameCommandsResult {
  const events = useGameStore((state) => state.events);
  const error = useGameStore((state) => state.error);
  const damagedEntities = useGameStore((state) => state.damagedEntities);
  const [actionPending, setActionPending] = useState(false);
  const [retryAvailable, setRetryAvailable] = useState(false);

  const storeActionsRef = useRef({
    addEvents: useGameStore.getState().addEvents,
    setError: useGameStore.getState().setError,
    setDamagedEntities: useGameStore.getState().setDamagedEntities,
    reset: useGameStore.getState().reset,
  });
  const onSessionInvalidRef = useRef(onSessionInvalid);
  const pendingActionRef = useRef<GameActionRequest | null>(null);
  const requestInFlightRef = useRef(false);
  const revisionRef = useRef(initialGame.revision);
  const disposedRef = useRef(false);
  const lastMoveTimeRef = useRef(0);
  const lastAttackTimeRef = useRef(0);
  const damageTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  onSessionInvalidRef.current = onSessionInvalid;

  const hasPlayer = useSyncExternalStore(
    subscribeToGameState,
    getHasPlayerSnapshot,
  );
  const status = useSyncExternalStore(subscribeToGameStatus, getStatusSnapshot);

  useEffect(() => {
    disposedRef.current = false;
    const actions = storeActionsRef.current;
    actions.reset();
    globalGameState.reset();
    revisionRef.current = initialGame.revision;
    globalGameState.initFromVisible(initialGame.state);
    pendingActionRef.current = null;
    requestInFlightRef.current = false;
    setActionPending(false);
    setRetryAvailable(false);
    publishGameState();

    return () => {
      disposedRef.current = true;
      if (damageTimeoutRef.current) clearTimeout(damageTimeoutRef.current);
    };
  }, [initialGame]);

  function applyProjection(state: VisibleGameState, revision: number): void {
    revisionRef.current = revision;
    globalGameState.initFromVisible(state);
    publishGameState();
  }

  function trackEffects(result: GameCommandResult): void {
    const actions = storeActionsRef.current;
    const newEvents = result.events as unknown as GameEvent[];
    if (newEvents.length > 0) actions.addEvents(newEvents);

    const newlyDamaged = new Set<string>();
    for (const delta of result.deltas) {
      if (delta.type === 'enemy_damaged') newlyDamaged.add(delta.enemyId);
    }
    for (const event of newEvents) {
      if (event.type === 'player_damaged') newlyDamaged.add('player');
    }
    if (newlyDamaged.size === 0) return;

    actions.setDamagedEntities(Array.from(newlyDamaged));
    if (damageTimeoutRef.current) clearTimeout(damageTimeoutRef.current);
    damageTimeoutRef.current = setTimeout(() => {
      actions.setDamagedEntities([]);
    }, 400);
  }

  function clearPendingAction(): void {
    pendingActionRef.current = null;
    requestInFlightRef.current = false;
    setActionPending(false);
    setRetryAvailable(false);
  }

  async function executePending(request: GameActionRequest): Promise<void> {
    if (requestInFlightRef.current) return;
    requestInFlightRef.current = true;
    setActionPending(true);
    setRetryAvailable(false);
    storeActionsRef.current.setError(null);

    try {
      const result = await api.executeAction(gameId, sessionToken, request);
      if (disposedRef.current || pendingActionRef.current !== request) return;
      applyProjection(result.state, result.revision);
      trackEffects(result);
      clearPendingAction();
    } catch (requestError) {
      if (disposedRef.current || pendingActionRef.current !== request) return;
      requestInFlightRef.current = false;
      setActionPending(false);

      if (isRetryableActionError(requestError)) {
        setRetryAvailable(true);
        storeActionsRef.current.setError(
          requestError instanceof Error
            ? requestError.message
            : 'The action response was interrupted.',
        );
        return;
      }

      if (requestError instanceof GameApiError) {
        const response = requestError.response;
        if (response.state && response.revision !== undefined) {
          applyProjection(response.state, response.revision);
        }
      }

      clearPendingAction();
      if (isInvalidSessionError(requestError)) {
        onSessionInvalidRef.current();
        return;
      }
      storeActionsRef.current.setError(
        requestError instanceof Error ? requestError.message : 'Action failed',
      );
    }
  }

  function startAction(command: GameCommand): void {
    if (pendingActionRef.current || requestInFlightRef.current) return;
    const request: GameActionRequest = Object.freeze({
      actionId: crypto.randomUUID(),
      expectedRevision: revisionRef.current,
      command: Object.freeze(command),
    });
    pendingActionRef.current = request;
    void executePending(request);
  }

  function sendMove(direction: Direction): void {
    const now = Date.now();
    if (now - lastMoveTimeRef.current < MOVE_THROTTLE_MS) return;
    lastMoveTimeRef.current = now;
    startAction({ type: 'move', direction });
  }

  function sendAttack(): void {
    const now = Date.now();
    if (now - lastAttackTimeRef.current < ATTACK_COOLDOWN_MS) return;
    lastAttackTimeRef.current = now;
    startAction({ type: 'attack' });
  }

  function retryAction(): void {
    const pending = pendingActionRef.current;
    if (!pending || !retryAvailable || requestInFlightRef.current) return;
    void executePending(pending);
  }

  return {
    gameState: globalGameState,
    events,
    error,
    sendMove,
    sendAttack,
    retryAction,
    damagedEntities,
    hasPlayer,
    status,
    actionPending,
    retryAvailable,
  };
}
