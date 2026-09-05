import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AssetManagerClass } from '@/engine/AssetManager';
import { GameCanvas } from '@/engine/GameCanvas';
import { GameClientModel } from '@/game/GameClientModel';
import { StoreHelpers } from '@/test/helpers/storeHelpers';

describe('GameCanvas renderer lifecycle', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('starts rendering when assets finish after mount', async () => {
    const loading = deferred<void>();
    const assets = {
      loadAll: vi.fn(() => loading.promise),
      getSheet: vi.fn(() => new Image()),
    } as unknown as AssetManagerClass;
    const frames = mockAnimationFrames();
    const context = mockCanvasContext();

    const props = {
      gameModel: new GameClientModel(StoreHelpers.visibleGameState()),
      assets,
      viewportTiles: { x: 13, y: 13 },
      tileScale: 1,
      damagedEntities: [],
    };
    render(<GameCanvas {...props} />);
    expect(screen.getByRole('status').textContent).toContain(
      'Loading sprites...',
    );

    await act(async () => loading.resolve());

    await waitFor(() => expect(frames.pendingCount()).toBe(1));
    expect(screen.getByRole('status').textContent).toContain(
      'Loading sprites...',
    );

    await act(async () => frames.runNext());

    expect(context.fillRect).toHaveBeenCalledOnce();
    expect(screen.queryByRole('status')).toBeNull();
    expect(frames.pendingCount()).toBe(0);
  });

  it('shows an actionable error and retries asset loading in place', async () => {
    const assets = {
      loadAll: vi
        .fn()
        .mockRejectedValueOnce(new Error('Sprites unavailable'))
        .mockResolvedValueOnce(undefined),
      getSheet: vi.fn(() => new Image()),
    } as unknown as AssetManagerClass;
    const frames = mockAnimationFrames();
    mockCanvasContext();

    render(
      <GameCanvas
        gameModel={new GameClientModel(StoreHelpers.visibleGameState())}
        assets={assets}
        viewportTiles={{ x: 13, y: 13 }}
        tileScale={1}
        damagedEntities={[]}
      />,
    );

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Game artwork failed to load.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry Assets' }));

    await waitFor(() => expect(assets.loadAll).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(frames.pendingCount()).toBe(1));
    expect(screen.getByRole('status').textContent).toContain(
      'Loading sprites...',
    );

    await act(async () => frames.runNext());

    expect(screen.queryByRole('alert')).toBeNull();
    expect(frames.pendingCount()).toBe(0);
  });

  it('does not create a renderer when assets resolve after unmount', async () => {
    const loading = deferred<void>();
    const assets = {
      loadAll: vi.fn(() => loading.promise),
      getSheet: vi.fn(() => new Image()),
    } as unknown as AssetManagerClass;
    const frames = mockAnimationFrames();
    const model = new GameClientModel(StoreHelpers.visibleGameState());
    const subscribe = vi.spyOn(model, 'subscribe');
    mockCanvasContext();

    const view = render(
      <GameCanvas
        gameModel={model}
        assets={assets}
        viewportTiles={{ x: 13, y: 13 }}
        tileScale={1}
        damagedEntities={[]}
      />,
    );
    view.unmount();
    await act(async () => loading.resolve());

    expect(subscribe).not.toHaveBeenCalled();
    expect(frames.pendingCount()).toBe(0);
  });

  it('leaves one renderer after a Strict Mode cleanup and remount', async () => {
    const loading = deferred<void>();
    const assets = {
      loadAll: vi.fn(() => loading.promise),
      getSheet: vi.fn(() => new Image()),
    } as unknown as AssetManagerClass;
    const frames = mockAnimationFrames();
    const model = new GameClientModel(StoreHelpers.visibleGameState());
    const subscribe = vi.spyOn(model, 'subscribe');
    mockCanvasContext();

    render(
      <StrictMode>
        <GameCanvas
          gameModel={model}
          assets={assets}
          viewportTiles={{ x: 13, y: 13 }}
          tileScale={1}
          damagedEntities={[]}
        />
      </StrictMode>,
    );
    await act(async () => loading.resolve());
    await waitFor(() => expect(frames.pendingCount()).toBe(1));

    expect(subscribe).toHaveBeenCalledOnce();
    await act(async () => frames.runNext());
    expect(screen.queryByRole('status')).toBeNull();
    expect(frames.pendingCount()).toBe(0);
  });

  it('keeps the canvas unavailable when its first draw fails', async () => {
    const assets = {
      loadAll: vi.fn().mockResolvedValue(undefined),
      getSheet: vi.fn(() => new Image()),
    } as unknown as AssetManagerClass;
    const frames = mockAnimationFrames();
    const context = mockCanvasContext();
    vi.mocked(context.fillRect).mockImplementationOnce(() => {
      throw new Error('draw failed');
    });

    render(
      <GameCanvas
        gameModel={new GameClientModel(StoreHelpers.visibleGameState())}
        assets={assets}
        viewportTiles={{ x: 13, y: 13 }}
        tileScale={1}
        damagedEntities={[]}
      />,
    );
    await waitFor(() => expect(frames.pendingCount()).toBe(1));
    await act(async () => frames.runNext());

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Game artwork failed to load.',
    );
    expect(frames.pendingCount()).toBe(0);
  });

  it('applies committed viewport and damage changes after becoming idle', async () => {
    const assets = {
      loadAll: vi.fn().mockResolvedValue(undefined),
      getSheet: vi.fn(() => new Image()),
    } as unknown as AssetManagerClass;
    const frames = mockAnimationFrames();
    const context = mockCanvasContext();
    const model = new GameClientModel(StoreHelpers.visibleGameState());
    const view = render(
      <GameCanvas
        gameModel={model}
        assets={assets}
        viewportTiles={{ x: 13, y: 13 }}
        tileScale={1}
        damagedEntities={[]}
      />,
    );
    await waitFor(() => expect(frames.pendingCount()).toBe(1));
    await act(async () => frames.runNext());

    view.rerender(
      <GameCanvas
        gameModel={model}
        assets={assets}
        viewportTiles={{ x: 7, y: 7 }}
        tileScale={2}
        damagedEntities={['player']}
      />,
    );
    expect(frames.pendingCount()).toBe(1);
    await act(async () => frames.runNext());

    expect(context.fillRect).toHaveBeenCalledTimes(2);
    expect(context.fillRect).toHaveBeenLastCalledWith(0, 0, 224, 224);
    expect(frames.pendingCount()).toBe(0);
  });
});

function mockCanvasContext(): CanvasRenderingContext2D {
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
  return context;
}

function mockAnimationFrames() {
  let nextId = 1;
  const callbacks = new Map<number, FrameRequestCallback>();
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
    vi.fn((id: number) => callbacks.delete(id)),
  );
  return {
    pendingCount: () => callbacks.size,
    runNext(timestamp = 16.7): void {
      const id = callbacks.keys().next().value as number | undefined;
      if (id === undefined) throw new Error('No frame is pending');
      const callback = callbacks.get(id);
      callbacks.delete(id);
      callback?.(timestamp);
    },
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
