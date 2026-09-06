import {
  type Coordinate,
  isEquipmentItem,
  MAP_HEIGHT,
  MAP_WIDTH,
} from '@dungeon-crawler/domain/model';
import type { AssetManagerClass, SpriteSheetKey } from '@/engine/AssetManager';
import type {
  GameClientModel,
  GameClientSnapshot,
} from '@/game/GameClientModel';
import {
  CHARACTER_SPRITES,
  ENEMY_SPRITE_MAPPING,
  getEnemySprite,
  getItemSprite,
  getTileSprite,
  TILE_SIZE,
  TILE_SPRITES,
} from '@/sprites';

function isValidEnemyType(
  type: string,
): type is keyof typeof ENEMY_SPRITE_MAPPING {
  return type in ENEMY_SPRITE_MAPPING;
}

const VARIANT_TINTS: Record<string, string | null> = {
  normal: null,
  elite: 'sepia(1) saturate(3) hue-rotate(180deg)',
  champion: 'sepia(1) saturate(5) hue-rotate(320deg) brightness(1.1)',
};

export interface RendererConfig {
  viewportTiles: Coordinate;
  tileScale: number;
}

interface FirstFrameDeferred {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
  settled: boolean;
}

function createFirstFrameDeferred(): FirstFrameDeferred {
  let resolvePromise!: () => void;
  let rejectPromise!: (error: unknown) => void;
  const promise = new Promise<void>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve: resolvePromise,
    reject: rejectPromise,
    settled: false,
  };
}

function rendererStoppedError(): Error {
  const error = new Error('Renderer stopped before its first frame completed');
  error.name = 'AbortError';
  return error;
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private assets: AssetManagerClass;
  private model: GameClientModel;
  private rafId: number | null = null;
  private running = false;
  private dirty = false;
  private drawing = false;
  private generation = 0;
  private unsubscribe: (() => void) | null = null;
  private lastObservedVersion = -1;
  private firstFrame: FirstFrameDeferred | null = null;
  private renderingSnapshot: GameClientSnapshot | null = null;

  private viewportTilesX = MAP_WIDTH;
  private viewportTilesY = MAP_HEIGHT;
  private tileScale = 1;

  private cameraX = 0;
  private cameraY = 0;

  private damagedEntities = new Set<string>();

  private tintCanvas: HTMLCanvasElement;
  private tintCtx: CanvasRenderingContext2D;

  constructor(
    canvas: HTMLCanvasElement,
    assets: AssetManagerClass,
    model: GameClientModel,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get 2D context from canvas');
    }
    this.ctx = ctx;
    this.assets = assets;
    this.model = model;

    this.ctx.imageSmoothingEnabled = false;

    this.tintCanvas = document.createElement('canvas');
    this.tintCanvas.width = TILE_SIZE;
    this.tintCanvas.height = TILE_SIZE;
    const tintCtx = this.tintCanvas.getContext('2d');
    if (!tintCtx) {
      throw new Error('Failed to get 2D context for tint canvas');
    }
    this.tintCtx = tintCtx;
  }

  setViewport(viewportTiles: Coordinate, tileScale: number): void {
    if (
      this.viewportTilesX === viewportTiles.x &&
      this.viewportTilesY === viewportTiles.y &&
      this.tileScale === tileScale
    ) {
      return;
    }
    this.viewportTilesX = viewportTiles.x;
    this.viewportTilesY = viewportTiles.y;
    this.tileScale = tileScale;
    this.invalidate();
  }

  setDamagedEntities(entities: string[]): void {
    const nextEntities = new Set(entities);
    if (
      nextEntities.size === this.damagedEntities.size &&
      [...nextEntities].every((entity) => this.damagedEntities.has(entity))
    ) {
      return;
    }
    this.damagedEntities = nextEntities;
    this.invalidate();
  }

  /** Resolves after the first completed frame. */
  start(): Promise<void> {
    if (this.running && this.firstFrame) return this.firstFrame.promise;

    this.running = true;
    this.generation += 1;
    this.lastObservedVersion = this.model.getSnapshot().version;
    this.firstFrame = createFirstFrameDeferred();
    this.unsubscribe = this.model.subscribe(this.handleModelChange);
    this.invalidate();
    return this.firstFrame.promise;
  }

  stop(): void {
    if (!this.running && !this.unsubscribe && this.rafId === null) return;

    this.running = false;
    this.generation += 1;
    this.dirty = false;
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.rejectFirstFrame(rendererStoppedError());
  }

  private handleModelChange = (): void => {
    const version = this.model.getSnapshot().version;
    if (version === this.lastObservedVersion) return;
    this.lastObservedVersion = version;
    this.invalidate();
  };

  private invalidate(): void {
    if (!this.running) return;
    this.dirty = true;
    if (this.rafId === null && !this.drawing) this.scheduleFrame();
  }

  private scheduleFrame(): void {
    const generation = this.generation;
    this.rafId = requestAnimationFrame(() => this.drawFrame(generation));
  }

  private drawFrame(generation: number): void {
    if (!this.running || generation !== this.generation) return;

    this.rafId = null;
    if (!this.dirty) return;
    this.dirty = false;
    this.drawing = true;
    this.renderingSnapshot = this.model.getSnapshot();
    try {
      this.render();
      this.resolveFirstFrame();
    } catch (error) {
      this.rejectFirstFrame(error);
      this.stop();
      return;
    } finally {
      this.renderingSnapshot = null;
      this.drawing = false;
    }

    if (this.running && this.dirty && this.rafId === null) {
      this.scheduleFrame();
    }
  }

  private resolveFirstFrame(): void {
    if (!this.firstFrame || this.firstFrame.settled) return;
    this.firstFrame.settled = true;
    this.firstFrame.resolve();
  }

  private rejectFirstFrame(error: unknown): void {
    if (!this.firstFrame || this.firstFrame.settled) return;
    this.firstFrame.settled = true;
    this.firstFrame.reject(error);
  }

  private render(): void {
    this.updateCamera();

    this.ctx.fillStyle = '#1a1a2e';
    this.ctx.fillRect(
      0,
      0,
      this.viewportTilesX * TILE_SIZE,
      this.viewportTilesY * TILE_SIZE,
    );

    this.drawTiles();
    this.drawItems();
    this.drawEnemies();
    this.drawPlayer();
  }

  private get state(): GameClientSnapshot {
    return this.renderingSnapshot ?? this.model.getSnapshot();
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

        const inFog = !this.state.explored[y]?.[x];
        if (inFog) {
          this.drawSprite('tiles', TILE_SPRITES.fog, screenX, screenY);
          continue;
        }

        const tile = this.state.map[y]?.[x];
        const tileType = tile?.type || 'floor';

        const tilePosition = getTileSprite(tileType, x, y, this.state.floor);
        this.drawSprite('tiles', tilePosition, screenX, screenY);
      }
    }
  }

  private drawItems(): void {
    for (const item of this.state.items.values()) {
      if (!this.isInViewport(item.x, item.y)) continue;

      if (!this.state.explored[item.y]?.[item.x]) continue;

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
      if (!this.isInViewport(enemy.x, enemy.y)) continue;

      if (!this.state.visibleNow[enemy.y]?.[enemy.x]) continue;

      if (enemy.hp <= 0) continue;

      if (!isValidEnemyType(enemy.type)) {
        console.warn(`Unknown enemy type: ${enemy.type}`);
        continue;
      }

      const screenX = (enemy.x - this.cameraX) * TILE_SIZE;
      const screenY = (enemy.y - this.cameraY) * TILE_SIZE;

      const position = getEnemySprite(enemy.type, enemy.variant);

      const needsTint = enemy.type === 'rat' || enemy.type === 'dragon';
      const tint = needsTint ? VARIANT_TINTS[enemy.variant || 'normal'] : null;

      const isDamaged = this.damagedEntities.has(enemy.id);

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

    if (!this.isInViewport(this.state.player.x, this.state.player.y)) return;

    const screenX = (this.state.player.x - this.cameraX) * TILE_SIZE;
    const screenY = (this.state.player.y - this.cameraY) * TILE_SIZE;

    const characterSprite =
      CHARACTER_SPRITES[this.state.player.character] || CHARACTER_SPRITES.dwarf;

    const isDamaged = this.damagedEntities.has('player');

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

  getCamera(): Coordinate {
    return { x: this.cameraX, y: this.cameraY };
  }
}
