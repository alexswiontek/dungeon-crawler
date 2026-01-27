import { useEffect, useState } from 'react';
import type { ProjectileType } from '@/sprites';
import { getProjectileConfigByType, SPRITE_SHEETS, TILE_SIZE } from '@/sprites';

export type { ProjectileType };

export interface ProjectileEvent {
  id: string;
  type: ProjectileType;
  startX: number; // Tile coordinates
  startY: number;
  endX: number;
  endY: number;
  direction: 'left' | 'right';
}

interface ProjectileProps {
  event: ProjectileEvent;
  cameraX: number;
  cameraY: number;
  tileScale: number;
  onComplete: (id: string) => void;
}

const ANIMATION_DURATION = 200; // ms

function Projectile({
  event,
  cameraX,
  cameraY,
  tileScale,
  onComplete,
}: ProjectileProps) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const startTime = Date.now();

    const animate = () => {
      const elapsed = Date.now() - startTime;
      const newProgress = Math.min(elapsed / ANIMATION_DURATION, 1);
      setProgress(newProgress);

      if (newProgress < 1) {
        requestAnimationFrame(animate);
      } else {
        onComplete(event.id);
      }
    };

    requestAnimationFrame(animate);
  }, [event.id, onComplete]);

  // Calculate current position (lerp between start and end)
  const currentX = event.startX + (event.endX - event.startX) * progress;
  const currentY = event.startY + (event.endY - event.startY) * progress;

  // Convert to screen coordinates
  const screenX = (currentX - cameraX) * TILE_SIZE * tileScale;
  const screenY = (currentY - cameraY) * TILE_SIZE * tileScale;

  const scaledSize = TILE_SIZE * tileScale;

  // Get projectile configuration
  const config = getProjectileConfigByType(event.type);

  // Spell uses CSS effect - glowing orb
  if (!config.sprite) {
    return (
      <div
        className="absolute pointer-events-none -translate-x-1/2 -translate-y-1/2 z-50"
        style={{
          left: screenX + scaledSize / 2,
          top: screenY + scaledSize / 2,
        }}
      >
        <div
          className="rounded-full animate-pulse spell-orb"
          style={{
            width: scaledSize * 0.4,
            height: scaledSize * 0.4,
          }}
        />
      </div>
    );
  }

  // Get rendering properties from config
  const sprite = config.sprite;
  const rotation = config.getRotation(event.direction);
  const flipX = config.shouldFlip(event.direction);

  return (
    <div
      className="absolute pointer-events-none z-50"
      style={{
        left: screenX,
        top: screenY,
        width: scaledSize,
        height: scaledSize,
      }}
    >
      <div
        className="w-full h-full origin-center [image-rendering:pixelated]"
        style={{
          backgroundImage: `url(${SPRITE_SHEETS.items})`,
          backgroundPosition: `-${sprite.x * tileScale}px -${sprite.y * tileScale}px`,
          backgroundSize: `${352 * tileScale}px ${832 * tileScale}px`,
          transform: `${flipX ? 'scaleX(-1) ' : ''}rotate(${rotation}deg)`,
        }}
      />
    </div>
  );
}

interface ProjectilesProps {
  projectiles: ProjectileEvent[];
  cameraX: number;
  cameraY: number;
  tileScale: number;
  onComplete: (id: string) => void;
}

export function Projectiles({
  projectiles,
  cameraX,
  cameraY,
  tileScale,
  onComplete,
}: ProjectilesProps) {
  return (
    <>
      {projectiles.map((projectile) => (
        <Projectile
          key={projectile.id}
          event={projectile}
          cameraX={cameraX}
          cameraY={cameraY}
          tileScale={tileScale}
          onComplete={onComplete}
        />
      ))}
    </>
  );
}
