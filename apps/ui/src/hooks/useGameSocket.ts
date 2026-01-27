import type {
  ClientMessage,
  Direction,
  GameDelta,
  GameEvent,
  ServerMessage,
} from '@dungeon-crawler/shared';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { GameState } from '@/engine/GameState';
import { useGameStore } from '@/stores/gameStore';

interface UseGameSocketResult {
  gameState: GameState;
  events: GameEvent[];
  connected: boolean;
  reconnecting: boolean;
  reconnectAttempt: number;
  error: string | null;
  sendMove: (direction: Direction) => void;
  sendAttack: () => void;
  damagedEntities: string[];
  // Expose hasPlayer for loading state detection
  hasPlayer: boolean;
  // Expose status for game end detection
  status: string;
}

const MAX_RECONNECT_ATTEMPTS = 10;
const MAX_RECONNECT_DELAY = 30000; // 30 seconds
const MOVE_THROTTLE_MS = 80; // ~12 moves/sec max - prevents keyboard repeat flooding
const ATTACK_COOLDOWN_MS = 400; // 400ms cooldown for ranged attacks - forces strategic usage
const MAX_PENDING_MESSAGES = 3; // Max unacknowledged messages in flight

// Singleton mutable game state - shared across hook instances
// This is the key performance optimization: state mutations don't trigger React
const globalGameState = new GameState();

// External store for triggering re-renders when game state changes
// We only re-render when necessary (hasPlayer changes, not every frame)
let hasPlayerSnapshot = false;
let statusSnapshot: string = 'active';
const listeners = new Set<() => void>();
const statusListeners = new Set<() => void>();
let lastNotifyTime = 0;
const NOTIFY_THROTTLE_MS = 16; // ~60fps max

function subscribeToGameState(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
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

function notifyListeners(): void {
  const newHasPlayer = globalGameState.player !== null;
  const newStatus = globalGameState.status;

  // Check if either hasPlayer or status changed
  const hasPlayerChanged = newHasPlayer !== hasPlayerSnapshot;
  const statusChanged = newStatus !== statusSnapshot;

  if (!hasPlayerChanged && !statusChanged) {
    return;
  }

  // Throttle notifications to prevent render storms
  const now = Date.now();
  if (now - lastNotifyTime < NOTIFY_THROTTLE_MS) {
    return;
  }

  hasPlayerSnapshot = newHasPlayer;
  lastNotifyTime = now;

  if (hasPlayerChanged) {
    for (const listener of listeners) {
      listener();
    }
  }

  if (statusChanged) {
    statusSnapshot = newStatus;
    for (const listener of statusListeners) {
      listener();
    }
  }
}

export function useGameSocket(gameId: string): UseGameSocketResult {
  // UI state from Zustand - select only what we need
  const events = useGameStore((s) => s.events);
  const connected = useGameStore((s) => s.connected);
  const reconnecting = useGameStore((s) => s.reconnecting);
  const reconnectAttempt = useGameStore((s) => s.reconnectAttempt);
  const error = useGameStore((s) => s.error);
  const damagedEntities = useGameStore((s) => s.damagedEntities);

  // Store actions - get once and use refs to avoid dep issues
  const storeActionsRef = useRef({
    addEvents: useGameStore.getState().addEvents,
    setConnected: useGameStore.getState().setConnected,
    setReconnecting: useGameStore.getState().setReconnecting,
    setReconnectAttempt: useGameStore.getState().setReconnectAttempt,
    setError: useGameStore.getState().setError,
    setDamagedEntities: useGameStore.getState().setDamagedEntities,
    reset: useGameStore.getState().reset,
  });

  // Subscribe to hasPlayer for loading state
  const hasPlayer = useSyncExternalStore(
    subscribeToGameState,
    getHasPlayerSnapshot,
  );

  // Subscribe to status for game end detection
  const status = useSyncExternalStore(subscribeToGameStatus, getStatusSnapshot);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const damageTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const manualCloseRef = useRef(false);
  const reconnectAttemptRef = useRef(0);
  const lastMoveTimeRef = useRef(0);
  const lastAttackTimeRef = useRef(0);
  const pendingMessagesRef = useRef(0);

  // Connection effect
  useEffect(() => {
    if (!gameId) return;

    const actions = storeActionsRef.current;

    // Reset state for new game
    actions.reset();
    globalGameState.reset();
    // Notify listeners that player is now null (triggers loading state)
    if (hasPlayerSnapshot) {
      hasPlayerSnapshot = false;
      for (const listener of listeners) {
        listener();
      }
    }
    // Reset status snapshot
    statusSnapshot = 'active';
    manualCloseRef.current = false;
    reconnectAttemptRef.current = 0;
    pendingMessagesRef.current = 0;

    const getWsUrl = () => {
      const apiUrl = import.meta.env.VITE_API_URL;
      if (apiUrl) {
        const wsUrl = apiUrl.replace(/^http/, 'ws');
        return `${wsUrl}/game/${gameId}/ws`;
      }
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host;
      return `${protocol}//${host}/api/game/${gameId}/ws`;
    };

    const connect = () => {
      if (manualCloseRef.current) return;

      const wsUrl = getWsUrl();
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        actions.setConnected(true);
        actions.setReconnecting(false);
        actions.setReconnectAttempt(0);
        reconnectAttemptRef.current = 0;
        pendingMessagesRef.current = 0;
        actions.setError(null);
      };

      ws.onmessage = (event) => {
        if (wsRef.current !== ws) return;

        try {
          const message: ServerMessage = JSON.parse(event.data);
          if (wsRef.current !== ws) return;

          switch (message.type) {
            case 'init':
              // Initialize mutable game state
              globalGameState.initFromVisible(message.state);
              notifyListeners();
              break;

            case 'update': {
              if (pendingMessagesRef.current > 0) {
                pendingMessagesRef.current--;
              }

              // Extract events
              const newEvents = message.deltas
                .filter((d: GameDelta) => d.type === 'event')
                .map(
                  (d: GameDelta) =>
                    (d as { type: 'event'; event: GameEvent }).event,
                );

              if (newEvents.length > 0) {
                actions.addEvents(newEvents);
              }

              // Track damaged entities for flash effect
              const newlyDamaged = new Set<string>();
              for (const delta of message.deltas) {
                if (delta.type === 'enemy_damaged') {
                  newlyDamaged.add(delta.enemyId);
                }
              }
              for (const evt of newEvents) {
                if (evt.type === 'player_damaged') {
                  newlyDamaged.add('player');
                }
              }

              if (newlyDamaged.size > 0) {
                // Convert Set to array to avoid reference equality issues in Zustand
                actions.setDamagedEntities(Array.from(newlyDamaged));
                if (damageTimeoutRef.current) {
                  clearTimeout(damageTimeoutRef.current);
                }
                damageTimeoutRef.current = setTimeout(() => {
                  actions.setDamagedEntities([]);
                }, 400);
              }

              // Apply deltas to mutable game state (no React re-render!)
              globalGameState.applyDeltas(message.deltas);
              notifyListeners();
              break;
            }

            case 'enemy_tick': {
              // Real-time enemy movement - apply directly to mutable state
              globalGameState.applyDeltas(message.deltas);
              // No notifyListeners() - we don't need React re-render for enemy ticks
              break;
            }

            case 'error':
              actions.setError(message.message);
              break;
          }
        } catch {
          // Failed to parse WebSocket message - ignore malformed messages
        }
      };

      ws.onclose = () => {
        if (wsRef.current !== ws) return;

        actions.setConnected(false);
        wsRef.current = null;

        if (manualCloseRef.current) return;

        const nextAttempt = reconnectAttemptRef.current + 1;
        reconnectAttemptRef.current = nextAttempt;
        actions.setReconnectAttempt(nextAttempt);

        if (nextAttempt <= MAX_RECONNECT_ATTEMPTS) {
          actions.setReconnecting(true);
          const delay = Math.min(
            1000 * 2 ** (nextAttempt - 1),
            MAX_RECONNECT_DELAY,
          );
          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, delay);
        } else {
          actions.setReconnecting(false);
          actions.setError('Connection lost. Please refresh the page.');
        }
      };

      ws.onerror = () => {
        actions.setError('Connection error');
      };
    };

    connect();

    return () => {
      manualCloseRef.current = true;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (damageTimeoutRef.current) {
        clearTimeout(damageTimeoutRef.current);
        damageTimeoutRef.current = null;
      }
      if (wsRef.current) {
        if (
          wsRef.current.readyState === WebSocket.OPEN ||
          wsRef.current.readyState === WebSocket.CLOSING
        ) {
          wsRef.current.close();
        }
        wsRef.current = null;
      }
    };
  }, [gameId]);

  // Stop reconnecting if game ends
  // biome-ignore lint/correctness/useExhaustiveDependencies: globalGameState is mutable and intentionally not in deps - hasPlayer change triggers effect to check status
  useEffect(() => {
    const status = globalGameState.status;
    if (status === 'dead' || status === 'won') {
      manualCloseRef.current = true;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      storeActionsRef.current.setReconnecting(false);
    }
  }, [hasPlayer]);

  // Pause/resume on visibility change
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

      try {
        if (document.hidden) {
          wsRef.current.send(JSON.stringify({ type: 'pause' }));
        } else {
          wsRef.current.send(JSON.stringify({ type: 'resume' }));
        }
      } catch {
        // Failed to send visibility message - socket likely closed
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () =>
      document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  const sendMove = (direction: Direction) => {
    const now = Date.now();
    if (now - lastMoveTimeRef.current < MOVE_THROTTLE_MS) return;
    if (pendingMessagesRef.current >= MAX_PENDING_MESSAGES) return;

    lastMoveTimeRef.current = now;

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      pendingMessagesRef.current++;
      const message: ClientMessage = { type: 'move', direction };
      wsRef.current.send(JSON.stringify(message));
    }
  };

  const sendAttack = () => {
    const now = Date.now();
    if (now - lastAttackTimeRef.current < ATTACK_COOLDOWN_MS) return;
    if (pendingMessagesRef.current >= MAX_PENDING_MESSAGES) return;

    lastAttackTimeRef.current = now;

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      pendingMessagesRef.current++;
      const message: ClientMessage = { type: 'attack' };
      wsRef.current.send(JSON.stringify(message));
    }
  };

  return {
    gameState: globalGameState,
    events,
    connected,
    reconnecting,
    reconnectAttempt,
    error,
    sendMove,
    sendAttack,
    damagedEntities,
    hasPlayer,
    status,
  };
}
