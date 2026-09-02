import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HUD } from '@/components/HUD';
import { GameClientModel } from '@/game/GameClientModel';
import { StoreHelpers } from '@/test/helpers/storeHelpers';

describe('HUD ranged damage regression', () => {
  it('uses the shared base, equipment, and level-scaled calculation', () => {
    const gameState = new GameClientModel(
      StoreHelpers.visibleGameState({
        player: {
          character: 'bandit',
          level: 4,
          equipment: {
            weapon: null,
            shield: null,
            armor: null,
            ranged: StoreHelpers.equipment({
              id: 'test-crossbow',
              slot: 'ranged',
              rangedDamageBonus: 2,
            }),
          },
        },
      }),
    );

    const { container } = render(
      <HUD gameState={gameState.getSnapshot()} events={[]} />,
    );

    expect(container.textContent).toMatch(/RAN:\s*11/);
  });
});
