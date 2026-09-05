import { describe, expect, it, vi } from 'vitest';
import { GameClientModel } from '@/game/GameClientModel';
import { StoreHelpers } from '@/test/helpers/storeHelpers';

describe('GameClientModel', () => {
  it('materializes the authoritative projection once for React and the renderer', () => {
    const enemy = StoreHelpers.enemy({ id: 'enemy-a' });
    const item = StoreHelpers.item({ id: 'item-a' });
    const model = new GameClientModel(
      StoreHelpers.visibleGameState({
        revision: 3,
        visibleEnemies: [enemy],
        visibleItems: [item],
      }),
    );
    const snapshot = model.getSnapshot();

    expect(snapshot.revision).toBe(3);
    expect(snapshot.map[5][5]).toMatchObject({ type: 'floor' });
    expect(snapshot.enemies.get('enemy-a')).toEqual(enemy);
    expect(snapshot.items.get('item-a')).toEqual(item);
    expect(model.getSnapshot()).toBe(snapshot);
  });

  it('publishes exactly once for each authoritative replacement', () => {
    const model = new GameClientModel(StoreHelpers.visibleGameState());
    const listener = vi.fn();
    model.subscribe(listener);
    const before = model.getSnapshot();

    model.replace(
      StoreHelpers.visibleGameState({ revision: 1, player: { x: 6 } }),
    );

    expect(listener).toHaveBeenCalledOnce();
    expect(model.getSnapshot()).not.toBe(before);
    expect(model.getSnapshot()).toMatchObject({ revision: 1, version: 1 });
    expect(model.getSnapshot().player.x).toBe(6);
    expect(model.getSnapshot()).toBe(model.getSnapshot());
  });

  it('keeps terminal state scoped to each fresh model', () => {
    const finished = new GameClientModel(
      StoreHelpers.visibleGameState({ status: 'won', revision: 20 }),
    );
    const fresh = new GameClientModel(
      StoreHelpers.visibleGameState({
        _id: 'fresh-game',
        status: 'active',
        revision: 0,
      }),
    );

    expect(finished.getSnapshot().status).toBe('won');
    expect(fresh.getSnapshot()).toMatchObject({
      id: 'fresh-game',
      status: 'active',
      revision: 0,
    });
  });
});
