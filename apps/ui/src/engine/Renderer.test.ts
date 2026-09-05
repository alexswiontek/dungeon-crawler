import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AssetManagerClass } from '@/engine/AssetManager';
import { Renderer } from '@/engine/Renderer';
import { GameClientModel } from '@/game/GameClientModel';
import { StoreHelpers } from '@/test/helpers/storeHelpers';

describe('Renderer demand-driven scheduling', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('completes one initial frame and leaves no successor frame', async () => {
    const { context, frames, renderer } = setupRenderer();

    const firstFrame = renderer.start();

    expect(renderer.start()).toBe(firstFrame);
    expect(context.fillRect).not.toHaveBeenCalled();
    expect(frames.pendingCount()).toBe(1);

    frames.runNext();
    await expect(firstFrame).resolves.toBeUndefined();

    expect(context.fillRect).toHaveBeenCalledOnce();
    expect(frames.pendingCount()).toBe(0);
    renderer.stop();
  });

  it('coalesces model replacements and draws the latest snapshot', async () => {
    const { context, frames, model, renderer } = setupRenderer();
    renderer.setViewport({ x: 7, y: 7 }, 1);
    const firstFrame = renderer.start();
    frames.runNext();
    await firstFrame;

    model.replace(
      StoreHelpers.visibleGameState({ revision: 1, player: { x: 10, y: 5 } }),
    );
    model.replace(
      StoreHelpers.visibleGameState({ revision: 2, player: { x: 20, y: 5 } }),
    );
    renderer.setViewport({ x: 9, y: 7 }, 1.25);

    expect(frames.pendingCount()).toBe(1);
    frames.runNext();

    expect(context.fillRect).toHaveBeenCalledTimes(2);
    expect(renderer.getCamera()).toEqual({ x: 16, y: 2 });
    expect(model.getSnapshot().version).toBe(2);
    expect(frames.pendingCount()).toBe(0);
    renderer.stop();
  });

  it('ignores identical viewport and damage inputs but draws each transition', async () => {
    const { context, frames, renderer } = setupRenderer();
    renderer.setViewport({ x: 13, y: 13 }, 1);
    const firstFrame = renderer.start();
    frames.runNext();
    await firstFrame;

    renderer.setViewport({ x: 13, y: 13 }, 1);
    renderer.setDamagedEntities([]);
    expect(frames.pendingCount()).toBe(0);

    renderer.setDamagedEntities(['player', 'enemy-1']);
    renderer.setDamagedEntities(['enemy-1', 'player', 'player']);
    expect(frames.pendingCount()).toBe(1);
    frames.runNext();

    renderer.setDamagedEntities([]);
    expect(frames.pendingCount()).toBe(1);
    frames.runNext();

    renderer.setViewport({ x: 7, y: 7 }, 2);
    expect(frames.pendingCount()).toBe(1);
    frames.runNext();

    expect(context.fillRect).toHaveBeenCalledTimes(4);
    expect(context.fillRect).toHaveBeenLastCalledWith(0, 0, 224, 224);
    expect(frames.pendingCount()).toBe(0);
    renderer.stop();
  });

  it('retains an invalidation raised while drawing for one follow-up frame', async () => {
    const { context, frames, model, renderer } = setupRenderer();
    renderer.setViewport({ x: 7, y: 7 }, 1);
    vi.mocked(context.fillRect).mockImplementationOnce(() => {
      model.replace(
        StoreHelpers.visibleGameState({
          revision: 1,
          player: { x: 12, y: 5 },
        }),
      );
    });

    const firstFrame = renderer.start();
    frames.runNext();
    await firstFrame;

    expect(frames.pendingCount()).toBe(1);
    frames.runNext();
    expect(context.fillRect).toHaveBeenCalledTimes(2);
    expect(renderer.getCamera()).toEqual({ x: 9, y: 2 });
    expect(frames.pendingCount()).toBe(0);
    renderer.stop();
  });

  it('cancels a pending frame and makes a late callback harmless', async () => {
    const { context, frames, model, renderer } = setupRenderer();
    const firstFrame = renderer.start();
    const pendingId = frames.pendingIds()[0];
    if (pendingId === undefined) throw new Error('Expected a pending frame');
    const lateCallback = frames.callback(pendingId);

    renderer.stop();
    renderer.stop();

    await expect(firstFrame).rejects.toMatchObject({ name: 'AbortError' });
    expect(frames.canceledIds()).toEqual([pendingId]);
    lateCallback(16.7);
    model.replace(StoreHelpers.visibleGameState({ revision: 1 }));
    expect(context.fillRect).not.toHaveBeenCalled();
    expect(frames.pendingCount()).toBe(0);
  });

  it('can restart without accumulating subscriptions or stale callbacks', async () => {
    const { frames, model, renderer } = setupRenderer();
    const subscribe = vi.spyOn(model, 'subscribe');
    const firstAttempt = renderer.start();
    void firstAttempt.catch(() => {});
    const staleId = frames.pendingIds()[0];
    if (staleId === undefined) throw new Error('Expected a pending frame');
    const staleCallback = frames.callback(staleId);

    renderer.stop();
    const restarted = renderer.start();
    expect(subscribe).toHaveBeenCalledTimes(2);
    expect(frames.pendingCount()).toBe(1);

    staleCallback(16.7);
    expect(frames.pendingCount()).toBe(1);
    frames.runNext();
    await expect(restarted).resolves.toBeUndefined();

    renderer.stop();
    model.replace(StoreHelpers.visibleGameState({ revision: 1 }));
    expect(frames.pendingCount()).toBe(0);
  });

  it('rejects a failed first frame and releases its subscription', async () => {
    const { context, frames, model, renderer } = setupRenderer();
    vi.mocked(context.fillRect).mockImplementationOnce(() => {
      throw new Error('draw failed');
    });

    const firstFrame = renderer.start();
    frames.runNext();

    await expect(firstFrame).rejects.toThrow('draw failed');
    model.replace(StoreHelpers.visibleGameState({ revision: 1 }));
    expect(frames.pendingCount()).toBe(0);
  });

  it('draws a remembered item on an explored tile outside current sight', async () => {
    const { assets, frames, model, renderer } = setupRenderer();
    renderer.setViewport({ x: 7, y: 7 }, 1);
    const item = StoreHelpers.item({ x: 8, y: 5 });
    const state = StoreHelpers.visibleGameState({ visibleItems: [item] });
    state.visibleNow[item.y][item.x] = false;
    model.replace(state);

    const firstFrame = renderer.start();
    frames.runNext();
    await firstFrame;

    expect(assets.getSheet).toHaveBeenCalledWith('items');
    renderer.stop();
  });
});

function setupRenderer(): {
  assets: AssetManagerClass;
  context: CanvasRenderingContext2D;
  frames: ReturnType<typeof createFrameHarness>;
  model: GameClientModel;
  renderer: Renderer;
} {
  const context = {
    imageSmoothingEnabled: true,
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    clearRect: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
  const frames = createFrameHarness();
  const model = new GameClientModel(StoreHelpers.visibleGameState());
  const assets = {
    getSheet: vi.fn(() => new Image()),
  } as unknown as AssetManagerClass;
  const renderer = new Renderer(
    document.createElement('canvas'),
    assets,
    model,
  );
  return { assets, context, frames, model, renderer };
}

function createFrameHarness() {
  let nextId = 1;
  const callbacks = new Map<number, FrameRequestCallback>();
  const canceled: number[] = [];
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((callback: FrameRequestCallback) => {
      const id = nextId++;
      callbacks.set(id, callback);
      return id;
    }),
  );
  vi.stubGlobal(
    'cancelAnimationFrame',
    vi.fn((id: number) => {
      canceled.push(id);
      callbacks.delete(id);
    }),
  );
  return {
    callback(id: number): FrameRequestCallback {
      const callback = callbacks.get(id);
      if (!callback) throw new Error(`Frame ${id} is not pending`);
      return callback;
    },
    canceledIds: () => [...canceled],
    pendingCount: () => callbacks.size,
    pendingIds: () => [...callbacks.keys()],
    runNext(timestamp = 16.7): void {
      const id = callbacks.keys().next().value as number | undefined;
      if (id === undefined) throw new Error('No frame is pending');
      const callback = callbacks.get(id);
      callbacks.delete(id);
      callback?.(timestamp);
    },
  };
}
