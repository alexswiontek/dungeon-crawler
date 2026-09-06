import type {
  Direction,
  GameCommand,
  GameEvent,
} from '@dungeon-crawler/domain/model';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { GameGateway } from '@/game/GameGateway';
import {
  CommandQueueOverflowError,
  GatewayStateError,
  RetryNotReadyError,
} from '@/game/GameGateway';
import { useUiStore } from '@/stores/uiStore';

const MOVE_THROTTLE_MS = 80;
const ATTACK_COOLDOWN_MS = 400;

function ignoreExpectedCommandError(error: unknown): void {
  if (
    error instanceof CommandQueueOverflowError ||
    error instanceof GatewayStateError ||
    error instanceof RetryNotReadyError
  ) {
    return;
  }
}

export function useGameSession(gateway: GameGateway) {
  const model = gateway.getModel();
  const game = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const gatewaySnapshot = useSyncExternalStore(
    gateway.subscribe,
    gateway.getSnapshot,
  );
  const events = useUiStore((state) => state.events);
  const damagedEntities = useUiStore((state) => state.damagedEntities);
  const lastMoveTimeRef = useRef(0);
  const lastAttackTimeRef = useRef(0);
  const damageTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    useUiStore.getState().reset();
    return gateway.subscribeResults((result) => {
      const newEvents = result.events as GameEvent[];
      if (newEvents.length > 0) useUiStore.getState().addEvents(newEvents);

      const damaged = new Set<string>();
      for (const delta of result.deltas) {
        if (delta.type === 'enemy_damaged') damaged.add(delta.enemyId);
      }
      for (const event of newEvents) {
        if (event.type === 'player_damaged') damaged.add('player');
      }
      if (damaged.size === 0) return;
      useUiStore.getState().setDamagedEntities([...damaged]);
      if (damageTimeoutRef.current) clearTimeout(damageTimeoutRef.current);
      damageTimeoutRef.current = setTimeout(() => {
        useUiStore.getState().setDamagedEntities([]);
      }, 400);
    });
  }, [gateway]);

  useEffect(
    () => () => {
      if (damageTimeoutRef.current) clearTimeout(damageTimeoutRef.current);
    },
    [],
  );

  const dispatch = (command: GameCommand): void => {
    void gateway.execute(command).catch(ignoreExpectedCommandError);
  };

  const sendMove = (direction: Direction): void => {
    const now = Date.now();
    if (now - lastMoveTimeRef.current < MOVE_THROTTLE_MS) return;
    lastMoveTimeRef.current = now;
    dispatch({ type: 'move', direction });
  };

  const sendAttack = (): void => {
    const now = Date.now();
    if (now - lastAttackTimeRef.current < ATTACK_COOLDOWN_MS) return;
    lastAttackTimeRef.current = now;
    dispatch({ type: 'attack' });
  };

  const retryAction = (): void => {
    void gateway.retryPendingAction().catch(ignoreExpectedCommandError);
  };

  return {
    model,
    game,
    gatewaySnapshot,
    events,
    damagedEntities,
    sendMove,
    sendAttack,
    retryAction,
  };
}
