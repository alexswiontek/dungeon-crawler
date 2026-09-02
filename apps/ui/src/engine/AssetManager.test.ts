import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssetManagerClass } from '@/engine/AssetManager';

describe('AssetManager', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('clears a failed attempt so all sprite sheets can be retried', async () => {
    let shouldFail = true;
    class MockImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      set src(_url: string) {
        queueMicrotask(() => {
          if (shouldFail) this.onerror?.();
          else this.onload?.();
        });
      }
    }
    vi.stubGlobal('Image', MockImage);
    const assets = new AssetManagerClass();

    await expect(assets.loadAll()).rejects.toThrow(
      'Failed to load sprite sheet',
    );
    expect(assets.isLoaded()).toBe(false);

    shouldFail = false;
    await expect(assets.loadAll()).resolves.toBeUndefined();
    expect(assets.isLoaded()).toBe(true);
  });
});
