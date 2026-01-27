import { type GameEvent, isRangedAttackEvent } from '@dungeon-crawler/shared';
import { useEffect, useRef, useState } from 'react';
import type { ProjectileEvent } from '@/components/Projectile';

export function useProjectileEvents(
  events: GameEvent[],
  playerX?: number,
  playerY?: number,
  playerFacingDirection?: 'left' | 'right',
) {
  const [projectiles, setProjectiles] = useState<ProjectileEvent[]>([]);
  const projectileIdRef = useRef(0);
  const processedProjectileEventsRef = useRef<Set<string>>(new Set());

  // Reset state when player position is lost (game restart/disconnect)
  useEffect(() => {
    if (playerX === undefined || playerY === undefined) {
      setProjectiles([]);
      processedProjectileEventsRef.current.clear();
    }
  }, [playerX, playerY]);

  useEffect(() => {
    if (
      playerX === undefined ||
      playerY === undefined ||
      !playerFacingDirection
    )
      return;

    events.forEach((event) => {
      if (!isRangedAttackEvent(event)) {
        return;
      }

      if (processedProjectileEventsRef.current.has(event.id)) return;

      processedProjectileEventsRef.current.add(event.id);

      const startXOffset = playerFacingDirection === 'right' ? 0.4 : -0.4;
      const endXOffset = 0.5;
      setProjectiles((prev) => [
        ...prev,
        {
          id: `projectile-${++projectileIdRef.current}`,
          type: event.data.attackType,
          startX: playerX + startXOffset,
          startY: playerY,
          endX: event.data.targetX + endXOffset,
          endY: event.data.targetY,
          direction: playerFacingDirection,
        },
      ]);
    });
  }, [events, playerX, playerY, playerFacingDirection]);

  const removeProjectile = (id: string) => {
    setProjectiles((prev) => prev.filter((p) => p.id !== id));
  };

  return {
    projectiles,
    removeProjectile,
  };
}
