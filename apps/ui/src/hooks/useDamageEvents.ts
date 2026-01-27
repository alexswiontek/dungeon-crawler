import type { GameEvent } from '@dungeon-crawler/shared';
import {
  isPlayerAttackedEvent,
  isRangedAttackEvent,
} from '@dungeon-crawler/shared';
import { useEffect, useRef, useState } from 'react';
import type { DamageEvent } from '@/components/DamageNumbers';

export function useDamageEvents(
  events: GameEvent[],
  playerX?: number,
  playerY?: number,
) {
  const [damageEvents, setDamageEvents] = useState<DamageEvent[]>([]);
  const damageIdRef = useRef(0);
  const processedDamageEventsRef = useRef<Set<string>>(new Set());

  // Reset state when player position is lost (game restart/disconnect)
  useEffect(() => {
    if (playerX === undefined || playerY === undefined) {
      setDamageEvents([]);
      processedDamageEventsRef.current.clear();
    }
  }, [playerX, playerY]);

  useEffect(() => {
    if (playerX === undefined || playerY === undefined) return;

    events.forEach((event) => {
      if (processedDamageEventsRef.current.has(event.id)) return;

      // Only show damage numbers for ranged attacks that actually hit (damage > 0)
      if (isRangedAttackEvent(event) && event.data.damage > 0) {
        processedDamageEventsRef.current.add(event.id);
        setDamageEvents((prev) => [
          ...prev,
          {
            id: `damage-${++damageIdRef.current}`,
            amount: event.data.damage,
            tileX: event.data.targetX,
            tileY: event.data.targetY,
            isPlayer: false,
          },
        ]);
        return;
      }

      const damageMatch = event.message.match(/for (\d+) damage/);
      if (!damageMatch) return;

      const amount = parseInt(damageMatch[1], 10);
      if (Number.isNaN(amount)) return;

      processedDamageEventsRef.current.add(event.id);

      if (event.type === 'player_damaged') {
        setDamageEvents((prev) => [
          ...prev,
          {
            id: `damage-${++damageIdRef.current}`,
            amount,
            tileX: playerX,
            tileY: playerY,
            isPlayer: true,
          },
        ]);
      } else if (isPlayerAttackedEvent(event)) {
        setDamageEvents((prev) => [
          ...prev,
          {
            id: `damage-${++damageIdRef.current}`,
            amount: event.data.damage,
            tileX: event.data.targetX,
            tileY: event.data.targetY,
            isPlayer: false,
          },
        ]);
      }
    });
  }, [events, playerX, playerY]);

  const removeDamageEvent = (id: string) => {
    setDamageEvents((prev) => prev.filter((e) => e.id !== id));
  };

  return {
    damageEvents,
    removeDamageEvent,
  };
}
