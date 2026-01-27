import type { Direction } from '@dungeon-crawler/shared';
import type { ProjectileConfig } from '@/sprites';
import { SPRITE_SHEETS, TILE_SIZE } from '@/sprites';
import { cn } from '@/utils/cn';

interface DPadProps {
  onMove: (direction: Direction) => void;
  onAttack: () => void;
  disabled?: boolean;
  projectileConfig: ProjectileConfig;
}

export function DPad({
  onMove,
  onAttack,
  disabled,
  projectileConfig,
}: DPadProps) {
  const baseClass =
    'flex items-center justify-center text-white transition-all touch-manipulation select-none disabled:opacity-50 disabled:cursor-not-allowed pointer-events-auto active:scale-95 size-16';

  const buttonClass = cn(
    baseClass,
    'bg-black/60 border border-white/30 rounded-lg text-xl active:bg-black/80 backdrop-blur-md',
  );

  const actionBaseClass = cn(baseClass, 'p-4 rounded-full');

  const attackButtonClass = cn(
    actionBaseClass,
    'bg-accent/30 border-2 border-accent/50 active:bg-accent/40 backdrop-blur-md',
  );

  return (
    <div className="fixed bottom-15 left-0 right-0 flex items-center justify-between px-8 md:hidden pointer-events-none z-50">
      {/* D-pad on left side */}
      <div className="grid grid-cols-3 gap-1">
        {/* Top row - up button */}
        <div />
        <button
          type="button"
          className={buttonClass}
          onClick={() => onMove('up')}
          disabled={disabled}
          aria-label="Move up"
        >
          ▲
        </button>
        <div />

        {/* Middle row - left and right buttons */}
        <button
          type="button"
          className={buttonClass}
          onClick={() => onMove('left')}
          disabled={disabled}
          aria-label="Move left"
        >
          ◀
        </button>
        <div />
        <button
          type="button"
          className={buttonClass}
          onClick={() => onMove('right')}
          disabled={disabled}
          aria-label="Move right"
        >
          ▶
        </button>

        {/* Bottom row - down button */}
        <div />
        <button
          type="button"
          className={buttonClass}
          onClick={() => onMove('down')}
          disabled={disabled}
          aria-label="Move down"
        >
          ▼
        </button>
        <div />
      </div>

      {/* Ranged attack button on right side */}
      <div className="flex items-center">
        <button
          type="button"
          className={attackButtonClass}
          onClick={onAttack}
          disabled={disabled}
          aria-label="Ranged Attack"
        >
          <div className="relative w-full h-full flex items-center justify-center [image-rendering:pixelated]">
            <div
              className="absolute left-1/2 top-1/2 bg-no-repeat"
              style={{
                width: TILE_SIZE * projectileConfig.buttonScale,
                height: TILE_SIZE * projectileConfig.buttonScale,
                backgroundImage: `url(${SPRITE_SHEETS.items})`,
                backgroundPosition: `-${projectileConfig.buttonIcon.x * projectileConfig.buttonScale}px -${projectileConfig.buttonIcon.y * projectileConfig.buttonScale}px`,
                backgroundSize: `${TILE_SIZE * 11 * projectileConfig.buttonScale}px auto`,
                transform: `translate(-50%, -50%) translate(${(projectileConfig.buttonOffset?.x || 0) * projectileConfig.buttonScale}px, ${(projectileConfig.buttonOffset?.y || 0) * projectileConfig.buttonScale}px) rotate(${projectileConfig.buttonRotation}deg)`,
              }}
            />
          </div>
        </button>
      </div>
    </div>
  );
}
