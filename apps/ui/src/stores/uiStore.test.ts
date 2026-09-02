import { beforeEach, describe, expect, it } from 'vitest';
import { useUiStore } from '@/stores/uiStore';
import { StoreHelpers } from '@/test/helpers/storeHelpers';

describe('UI-only store', () => {
  beforeEach(() => useUiStore.getState().reset());

  it('contains presentation effects without gameplay authority', () => {
    useUiStore.getState().addEvents([StoreHelpers.event()]);
    useUiStore.getState().setDamagedEntities(['player']);

    const state = useUiStore.getState();
    expect(state.events).toHaveLength(1);
    expect(state.damagedEntities).toEqual(['player']);
    expect(state).not.toHaveProperty('player');
    expect(state).not.toHaveProperty('map');
    expect(state).not.toHaveProperty('revision');
    expect(state).not.toHaveProperty('status');
  });
});
