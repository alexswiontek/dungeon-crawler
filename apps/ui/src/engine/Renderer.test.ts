import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AssetManagerClass } from '@/engine/AssetManager';
import { Renderer } from '@/engine/Renderer';
import { GameClientModel } from '@/game/GameClientModel';
import { StoreHelpers } from '@/test/helpers/storeHelpers';

describe('Renderer frame activity characterization', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('currently schedules another frame after every unchanged render', () => {
    const context = { imageSmoothingEnabled: true };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      context as unknown as CanvasRenderingContext2D,
    );
    const renderSpy = vi
      .spyOn(Renderer.prototype as unknown as { render: () => void }, 'render')
      .mockImplementation(() => {});
    let scheduledFrame: FrameRequestCallback | undefined;
    const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      scheduledFrame = callback;
      return 1;
    });
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrame);
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    const canvas = document.createElement('canvas');
    const assets = {} as AssetManagerClass;
    const model = new GameClientModel(StoreHelpers.visibleGameState());
    const initialVersion = model.getSnapshot().version;
    const renderer = new Renderer(canvas, assets, model);

    renderer.start();

    expect(renderSpy).toHaveBeenCalledTimes(1);
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);

    scheduledFrame?.(16.7);

    expect(model.getSnapshot().version).toBe(initialVersion);
    expect(renderSpy).toHaveBeenCalledTimes(2);
    expect(requestAnimationFrame).toHaveBeenCalledTimes(2);

    renderer.stop();
    // Finalized target: unchanged state with no active effects should stop the loop.
  });
});
