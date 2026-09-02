import type { GameEvent } from '@dungeon-crawler/domain';
import { create } from 'zustand';

interface UiStore {
  events: GameEvent[];
  damagedEntities: string[];
  addEvents: (events: GameEvent[]) => void;
  setDamagedEntities: (entities: string[]) => void;
  reset: () => void;
}

export const useUiStore = create<UiStore>((set) => ({
  events: [],
  damagedEntities: [],
  addEvents: (events) =>
    set((state) => ({ events: [...events, ...state.events].slice(0, 30) })),
  setDamagedEntities: (damagedEntities) => set({ damagedEntities }),
  reset: () => set({ events: [], damagedEntities: [] }),
}));
