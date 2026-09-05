import { useEffect } from 'react';
import { TILE_SIZE } from '@/sprites';
import { cn } from '@/utils/cn';

const ANIMATION_DURATION_MS = 800;

export interface DamageEvent {
  id: string;
  amount: number;
  tileX: number;
  tileY: number;
  isPlayer: boolean;
}

interface DamageNumbersProps {
  damageEvents: DamageEvent[];
  cameraX: number;
  cameraY: number;
  tileScale: number;
  onComplete: (id: string) => void;
}

function DamageNumber({
  event,
  cameraX,
  cameraY,
  tileScale,
  onComplete,
}: {
  event: DamageEvent;
  cameraX: number;
  cameraY: number;
  tileScale: number;
  onComplete: (id: string) => void;
}) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onComplete(event.id);
    }, ANIMATION_DURATION_MS);
    return () => clearTimeout(timer);
  }, [event.id, onComplete]);

  const screenX = (event.tileX - cameraX) * TILE_SIZE * tileScale;
  const screenY = (event.tileY - cameraY) * TILE_SIZE * tileScale;

  const centerX = screenX + (TILE_SIZE * tileScale) / 2;
  const centerY = screenY + (TILE_SIZE * tileScale) / 4;

  return (
    <div
      className={cn(
        'damage-number absolute text-lg -translate-x-1/2 z-50',
        event.isPlayer ? 'text-[#ff4444]' : 'text-white',
      )}
      style={{
        left: centerX,
        top: centerY,
        fontSize: Math.max(14, 16 * tileScale),
      }}
    >
      -{event.amount}
    </div>
  );
}

export function DamageNumbers({
  damageEvents,
  cameraX,
  cameraY,
  tileScale,
  onComplete,
}: DamageNumbersProps) {
  return (
    <>
      {damageEvents.map((event) => (
        <DamageNumber
          key={event.id}
          event={event}
          cameraX={cameraX}
          cameraY={cameraY}
          tileScale={tileScale}
          onComplete={onComplete}
        />
      ))}
    </>
  );
}
