import {
  type Coordinate,
  type FacingDirection,
  isEquipmentItem,
  MAP_HEIGHT,
  MAP_WIDTH,
} from '@dungeon-crawler/shared';
import type { GameState } from '@/engine/GameState';
import {
  CHARACTER_SPRITES,
  ENEMY_SPRITE_MAPPING,
  getEnemySprite,
  getItemSprite,
  getTileSprite,
  SPRITE_SHEETS,
  TILE_SIZE,
  TILE_SPRITES,
} from '@/sprites';
import { cn } from '@/utils/cn';

// Type guard to validate enemy types at runtime
function isValidEnemyType(
  type: string,
): type is keyof typeof ENEMY_SPRITE_MAPPING {
  return type in ENEMY_SPRITE_MAPPING;
}

// Variant colors for enemies without unique sprites
const VARIANT_TINTS = {
  normal: undefined,
  elite: 'sepia(1) saturate(3) hue-rotate(180deg)', // Blue tint
  champion: 'sepia(1) saturate(5) hue-rotate(320deg) brightness(1.1)', // Red/purple tint
} as const;

// Sprite rendering component using CSS background-position
function SpriteCell({
  sheet,
  position,
  tint,
  direction = 'left',
}: {
  sheet: string;
  position: Coordinate;
  tint?: string;
  direction?: FacingDirection;
}) {
  return (
    <div
      className={cn(
        'w-full h-full bg-auto [image-rendering:pixelated]',
        direction === 'right' && '-scale-x-100',
      )}
      style={{
        backgroundImage: `url(${sheet})`,
        backgroundPosition: `-${position.x}px -${position.y}px`,
        filter: tint || undefined,
      }}
    />
  );
}

interface GridProps {
  gameState: GameState;
  // Camera system props
  cameraX?: number;
  cameraY?: number;
  viewportTiles?: Coordinate;
  tileScale?: number;
  // Damage flash animation
  damagedEntities?: string[];
}

export function Grid({
  gameState,
  cameraX = 0,
  cameraY = 0,
  viewportTiles,
  tileScale = 1,
  damagedEntities = [],
}: GridProps) {
  const { map, player, enemies, items, fog, floor } = gameState;

  // Early return if no player (safety check)
  if (!player) return null;

  // Determine rendering bounds based on camera position
  const tilesX = viewportTiles?.x || MAP_WIDTH;
  const tilesY = viewportTiles?.y || MAP_HEIGHT;
  const startX = cameraX;
  const startY = cameraY;
  const endX = Math.min(cameraX + tilesX, MAP_WIDTH);
  const endY = Math.min(cameraY + tilesY, MAP_HEIGHT);

  const renderCell = (x: number, y: number) => {
    const inFog = !fog[y]?.[x];

    // If in fog, just render the fog tile
    if (inFog) {
      return (
        <div style={{ width: TILE_SIZE, height: TILE_SIZE }}>
          <SpriteCell sheet={SPRITE_SHEETS.tiles} position={TILE_SPRITES.fog} />
        </div>
      );
    }

    const tile = map[y]?.[x];
    const tileType = tile?.type || 'floor';

    // Base tile sprite (themed based on floor)
    const tilePosition = getTileSprite(tileType, x, y, floor);

    // Determine what entity to render on top
    let entitySprite: React.ReactNode = null;

    // Check for player
    if (player.x === x && player.y === y) {
      const characterSprite =
        CHARACTER_SPRITES[player.character] || CHARACTER_SPRITES.dwarf;
      const isPlayerDamaged = damagedEntities.includes('player');

      entitySprite = (
        <div className={cn('w-full h-full', isPlayerDamaged && 'damage-flash')}>
          <SpriteCell
            sheet={SPRITE_SHEETS.rogues}
            position={characterSprite}
            direction={player.facingDirection}
          />
        </div>
      );
    } else {
      // Check for enemies
      for (const enemy of enemies.values()) {
        if (enemy.x === x && enemy.y === y && enemy.hp > 0) {
          // Validate enemy type with type guard
          if (!isValidEnemyType(enemy.type)) {
            console.warn(`Unknown enemy type: ${enemy.type}`);
            continue;
          }

          const position = getEnemySprite(enemy.type, enemy.variant);
          // Apply tint for enemies without unique variant sprites (rat, dragon)
          const needsTint = enemy.type === 'rat' || enemy.type === 'dragon';
          const tint = needsTint
            ? VARIANT_TINTS[enemy.variant || 'normal']
            : undefined;
          const isEnemyDamaged = damagedEntities.includes(enemy.id);
          entitySprite = (
            <div
              className={cn('w-full h-full', isEnemyDamaged && 'damage-flash')}
            >
              <SpriteCell
                sheet={SPRITE_SHEETS.monsters}
                position={position}
                tint={tint}
              />
            </div>
          );
          break;
        }
      }

      // Check for items
      if (!entitySprite) {
        for (const item of items.values()) {
          if (item.x === x && item.y === y) {
            const slot = isEquipmentItem(item)
              ? item.equipment.slot
              : undefined;
            const itemId = isEquipmentItem(item)
              ? item.equipment.id
              : undefined;
            const position = getItemSprite(slot, itemId);
            entitySprite = (
              <SpriteCell sheet={SPRITE_SHEETS.items} position={position} />
            );
            break;
          }
        }
      }
    }

    return (
      <div className="relative" style={{ width: TILE_SIZE, height: TILE_SIZE }}>
        {/* Base tile */}
        <SpriteCell sheet={SPRITE_SHEETS.tiles} position={tilePosition} />

        {/* Entity on top */}
        {entitySprite && <div className="absolute inset-0">{entitySprite}</div>}
      </div>
    );
  };

  // Generate visible rows and columns
  const rows = Array.from({ length: endY - startY }, (_, i) => startY + i);
  const cols = Array.from({ length: endX - startX }, (_, i) => startX + i);

  // Calculate grid dimensions based on viewport tiles
  const gridWidth = tilesX * TILE_SIZE;
  const gridHeight = tilesY * TILE_SIZE;

  return (
    <div
      className="bg-dark border-2 border-gray-700 select-none overflow-hidden"
      style={{
        width: gridWidth * tileScale,
        height: gridHeight * tileScale,
      }}
    >
      <div
        className="origin-top-left"
        style={{
          transform: `scale(${tileScale})`,
          width: gridWidth,
          height: gridHeight,
        }}
      >
        {rows.map((y) => (
          <div key={y} className="flex">
            {cols.map((x) => (
              <div key={x}>{renderCell(x, y)}</div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
