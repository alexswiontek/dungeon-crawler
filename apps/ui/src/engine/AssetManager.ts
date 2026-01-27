// AssetManager - Preloads and manages sprite sheets for canvas rendering

import { SPRITE_SHEETS } from '@/sprites';

export type SpriteSheetKey = keyof typeof SPRITE_SHEETS;

class AssetManagerClass {
  private images = new Map<SpriteSheetKey, HTMLImageElement>();
  private loadPromise: Promise<void> | null = null;
  private loaded = false;

  /**
   * Preload all sprite sheets. Safe to call multiple times - only loads once.
   */
  async loadAll(): Promise<void> {
    // Return cached promise if already loading/loaded
    if (this.loadPromise) {
      return this.loadPromise;
    }

    this.loadPromise = this.doLoad();
    return this.loadPromise;
  }

  private async doLoad(): Promise<void> {
    const entries = Object.entries(SPRITE_SHEETS) as [SpriteSheetKey, string][];

    await Promise.all(entries.map(([key, url]) => this.loadImage(key, url)));

    this.loaded = true;
  }

  private loadImage(key: SpriteSheetKey, url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        this.images.set(key, img);
        resolve();
      };
      img.onerror = () => {
        reject(new Error(`Failed to load sprite sheet: ${key} from ${url}`));
      };
      img.src = url;
    });
  }

  /**
   * Get a loaded sprite sheet image.
   * Throws if assets haven't been loaded yet.
   */
  getSheet(key: SpriteSheetKey): HTMLImageElement {
    const img = this.images.get(key);
    if (!img) {
      throw new Error(
        `Sprite sheet "${key}" not loaded. Call loadAll() first.`,
      );
    }
    return img;
  }

  /**
   * Check if all assets are loaded.
   */
  isLoaded(): boolean {
    return this.loaded;
  }
}

// Export singleton instance and type
export const AssetManager = new AssetManagerClass();
export type { AssetManagerClass };
