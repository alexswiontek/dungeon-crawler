import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AssetManagerClass } from '@/engine/AssetManager';
import { GameCanvas } from '@/engine/GameCanvas';
import { GameClientModel } from '@/game/GameClientModel';
import { StoreHelpers } from '@/test/helpers/storeHelpers';

describe('GameCanvas asset readiness characterization', () => {
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
    const requestAnimationFrame = vi.fn(() => 1);
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrame);
    mockCanvasContext();

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

    await waitFor(() => expect(requestAnimationFrame).toHaveBeenCalledOnce());
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows an actionable error and retries asset loading in place', async () => {
    const assets = {
      loadAll: vi
        .fn()
        .mockRejectedValueOnce(new Error('Sprites unavailable'))
        .mockResolvedValueOnce(undefined),
      getSheet: vi.fn(() => new Image()),
    } as unknown as AssetManagerClass;
    const requestAnimationFrame = vi.fn(() => 1);
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrame);
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
    await waitFor(() => expect(requestAnimationFrame).toHaveBeenCalledOnce());
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

function mockCanvasContext(): void {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    imageSmoothingEnabled: true,
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    clearRect: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
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
