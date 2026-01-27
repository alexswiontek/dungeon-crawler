// Renderer - Canvas 2D rendering with RAF loop

import {
  type Coordinate,
  isEquipmentItem,
  MAP_HEIGHT,
  MAP_WIDTH,
} from '@dungeon-crawler/shared';
import type { AssetManagerClass, SpriteSheetKey } from '@/engine/AssetManager';
import type { GameState } from '@/engine/GameState';
import {
  CHARACTER_SPRITES,
  ENEMY_SPRITE_MAPPING,
  getEnemySprite,
  getItemSprite,
  getTileSprite,
  TILE_SIZE,
  TILE_SPRITES,
} from '@/sprites';

// Type guard to validate enemy types at runtime
function isValidEnemyType(
  type: string,
): type is keyof typeof ENEMY_SPRITE_MAPPING {
  return type in ENEMY_SPRITE_MAPPING;
}

// Variant tints for enemies without unique sprites (same as Grid.tsx)
const VARIANT_TINTS: Record<string, string | null> = {
  normal: null,
  elite: 'sepia(1) saturate(3) hue-rotate(180deg)', // Blue tint
  champion: 'sepia(1) saturate(5) hue-rotate(320deg) brightness(1.1)', // Red/purple
};

export interface RendererConfig {
  viewportTiles: Coordinate;
  tileScale: number;
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private assets: AssetManagerClass;
  private state: GameState;
  private rafId = 0;
  private running = false;

  // Viewport configuration
  private viewportTilesX = MAP_WIDTH;
  private viewportTilesY = MAP_HEIGHT;

  // Camera position (top-left tile coords)
  private cameraX = 0;
  private cameraY = 0;

  // Damaged entities for flash effect (stored as array for Zustand compatibility)
  private damagedEntities: string[] = [];

  // Off-screen canvas for tinted sprites
  private tintCanvas: HTMLCanvasElement;
  private tintCtx: CanvasRenderingContext2D;

  constructor(
    canvas: HTMLCanvasElement,
    assets: AssetManagerClass,
    state: GameState,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get 2D context from canvas');
    }
    this.ctx = ctx;
    this.assets = assets;
    this.state = state;

    // Disable image smoothing for crisp pixel art
    this.ctx.imageSmoothingEnabled = false;

    // Create off-screen canvas for tinted sprites
    this.tintCanvas = document.createElement('canvas');
    this.tintCanvas.width = TILE_SIZE;
    this.tintCanvas.height = TILE_SIZE;
    const tintCtx = this.tintCanvas.getContext('2d');
    if (!tintCtx) {
      throw new Error('Failed to get 2D context for tint canvas');
    }
    this.tintCtx = tintCtx;
  }

  /**
   * Update viewport configuration.
   */
  setViewport(viewportTiles: Coordinate, _tileScale: number): void {
    this.viewportTilesX = viewportTiles.x;
    this.viewportTilesY = viewportTiles.y;
    // tileScale is handled by CSS, not the canvas internal rendering
  }

  /**
   * Update damaged entities for flash effect.
   */
  setDamagedEntities(entities: string[]): void {
    this.damagedEntities = entities;
  }

  /**
   * Start the render loop.
   */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.loop();
  }

  /**
   * Stop the render loop.
   */
  stop(): void {
    this.running = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  private loop = (): void => {
    if (!this.running) return;

    this.render();

    this.rafId = requestAnimationFrame(this.loop);
  };

  private render(): void {
    if (!this.state.player) return;

    // Update camera to center on player
    this.updateCamera();

    // Clear canvas
    this.ctx.fillStyle = '#1a1a2e';
    this.ctx.fillRect(
      0,
      0,
      this.viewportTilesX * TILE_SIZE,
      this.viewportTilesY * TILE_SIZE,
    );

    // Draw visible tiles (viewport culling)
    this.drawTiles();

    // Draw items
    this.drawItems();

    // Draw enemies
    this.drawEnemies();

    // Draw player
    this.drawPlayer();
  }

  private updateCamera(): void {
    if (!this.state.player) return;

    const halfViewX = Math.floor(this.viewportTilesX / 2);
    const halfViewY = Math.floor(this.viewportTilesY / 2);

    this.cameraX = Math.max(
      0,
      Math.min(
        this.state.player.x - halfViewX,
        MAP_WIDTH - this.viewportTilesX,
      ),
    );
    this.cameraY = Math.max(
      0,
      Math.min(
        this.state.player.y - halfViewY,
        MAP_HEIGHT - this.viewportTilesY,
      ),
    );
  }

  private drawTiles(): void {
    const startX = this.cameraX;
    const startY = this.cameraY;
    const endX = Math.min(this.cameraX + this.viewportTilesX, MAP_WIDTH);
    const endY = Math.min(this.cameraY + this.viewportTilesY, MAP_HEIGHT);

    for (let y = startY; y < endY; y++) {
      for (let x = startX; x < endX; x++) {
        const screenX = (x - this.cameraX) * TILE_SIZE;
        const screenY = (y - this.cameraY) * TILE_SIZE;

        // Check fog
        const inFog = !this.state.fog[y]?.[x];
        if (inFog) {
          this.drawSprite('tiles', TILE_SPRITES.fog, screenX, screenY);
          continue;
        }

        // Get tile type
        const tile = this.state.map[y]?.[x];
        const tileType = tile?.type || 'floor';

        // Get themed tile sprite
        const tilePosition = getTileSprite(tileType, x, y, this.state.floor);
        this.drawSprite('tiles', tilePosition, screenX, screenY);
      }
    }
  }

  private drawItems(): void {
    for (const item of this.state.items.values()) {
      // Skip if not in viewport
      if (!this.isInViewport(item.x, item.y)) continue;

      // Skip if in fog
      if (!this.state.fog[item.y]?.[item.x]) continue;

      const screenX = (item.x - this.cameraX) * TILE_SIZE;
      const screenY = (item.y - this.cameraY) * TILE_SIZE;

      const slot = isEquipmentItem(item) ? item.equipment.slot : undefined;
      const itemId = isEquipmentItem(item) ? item.equipment.id : undefined;
      const position = getItemSprite(slot, itemId);

      this.drawSprite('items', position, screenX, screenY);
    }
  }

  private drawEnemies(): void {
    for (const enemy of this.state.enemies.values()) {
      // Skip if not in viewport
      if (!this.isInViewport(enemy.x, enemy.y)) continue;

      // Skip if in fog
      if (!this.state.fog[enemy.y]?.[enemy.x]) continue;

      // Skip dead enemies
      if (enemy.hp <= 0) continue;

      // Validate enemy type with type guard
      if (!isValidEnemyType(enemy.type)) {
        console.warn(`Unknown enemy type: ${enemy.type}`);
        continue;
      }

      const screenX = (enemy.x - this.cameraX) * TILE_SIZE;
      const screenY = (enemy.y - this.cameraY) * TILE_SIZE;

      const position = getEnemySprite(enemy.type, enemy.variant);

      // Apply tint for enemies without unique variant sprites
      const needsTint = enemy.type === 'rat' || enemy.type === 'dragon';
      const tint = needsTint ? VARIANT_TINTS[enemy.variant || 'normal'] : null;

      // Check if damaged for flash effect
      const isDamaged = this.damagedEntities.includes(enemy.id);

      this.drawSprite(
        'monsters',
        position,
        screenX,
        screenY,
        false,
        tint,
        isDamaged,
      );
    }
  }

  private drawPlayer(): void {
    if (!this.state.player) return;

    // Skip if player not in viewport (shouldn't happen but just in case)
    if (!this.isInViewport(this.state.player.x, this.state.player.y)) return;

    const screenX = (this.state.player.x - this.cameraX) * TILE_SIZE;
    const screenY = (this.state.player.y - this.cameraY) * TILE_SIZE;

    const characterSprite =
      CHARACTER_SPRITES[this.state.player.character] || CHARACTER_SPRITES.dwarf;

    // Check if damaged for flash effect
    const isDamaged = this.damagedEntities.includes('player');

    // Flip sprite based on facing direction
    const flipX = this.state.player.facingDirection === 'right';

    this.drawSprite(
      'rogues',
      characterSprite,
      screenX,
      screenY,
      flipX,
      null,
      isDamaged,
    );
  }

  private drawSprite(
    sheetKey: SpriteSheetKey,
    srcPos: Coordinate,
    destX: number,
    destY: number,
    flipX = false,
    tint: string | null = null,
    isDamaged = false,
  ): void {
    const sheet = this.assets.getSheet(sheetKey);

    // Apply tint if needed using off-screen canvas
    if (tint) {
      this.tintCtx.clearRect(0, 0, TILE_SIZE, TILE_SIZE);
      this.tintCtx.filter = tint;
      this.tintCtx.drawImage(
        sheet,
        srcPos.x,
        srcPos.y,
        TILE_SIZE,
        TILE_SIZE,
        0,
        0,
        TILE_SIZE,
        TILE_SIZE,
      );
      this.tintCtx.filter = 'none';

      this.ctx.save();

      if (flipX) {
        this.ctx.translate(destX + TILE_SIZE, destY);
        this.ctx.scale(-1, 1);
        destX = 0;
        destY = 0;
      }

      // Apply damage flash
      if (isDamaged) {
        this.ctx.filter = 'brightness(2) saturate(0.5)';
      }

      this.ctx.drawImage(this.tintCanvas, destX, destY);
      this.ctx.restore();
      return;
    }

    this.ctx.save();

    if (flipX) {
      this.ctx.translate(destX + TILE_SIZE, destY);
      this.ctx.scale(-1, 1);
      destX = 0;
      destY = 0;
    }

    // Apply damage flash
    if (isDamaged) {
      this.ctx.filter = 'brightness(2) saturate(0.5)';
    }

    this.ctx.drawImage(
      sheet,
      srcPos.x,
      srcPos.y,
      TILE_SIZE,
      TILE_SIZE,
      destX,
      destY,
      TILE_SIZE,
      TILE_SIZE,
    );

    this.ctx.restore();
  }

  private isInViewport(x: number, y: number): boolean {
    return (
      x >= this.cameraX &&
      x < this.cameraX + this.viewportTilesX &&
      y >= this.cameraY &&
      y < this.cameraY + this.viewportTilesY
    );
  }

  /**
   * Get current camera position (for positioning overlays).
   */
  getCamera(): Coordinate {
    return { x: this.cameraX, y: this.cameraY };
  }
}
