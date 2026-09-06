import { calculateRangedAttackPower } from '@dungeon-crawler/domain/combat';
import type { CharacterType } from '@dungeon-crawler/domain/model';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HUD } from '@/components/HUD';
import { GameClientModel } from '@/game/GameClientModel';
import { StoreHelpers } from '@/test/helpers/storeHelpers';

describe('HUD ranged damage regression', () => {
  const cases = (
    ['dwarf', 'elf', 'bandit', 'wizard'] as CharacterType[]
  ).flatMap((character) =>
    [1, 4].flatMap((level) =>
      [0, 2].map((equipmentBonus) => ({
        character,
        level,
        equipmentBonus,
      })),
    ),
  );

  it.each(cases)(
    'uses the domain calculation for $character at level $level with +$equipmentBonus equipment',
    ({ character, level, equipmentBonus }) => {
      const gameState = new GameClientModel(
        StoreHelpers.visibleGameState({
          player: {
            character,
            level,
            equipment: {
              weapon: null,
              shield: null,
              armor: null,
              ranged:
                equipmentBonus === 0
                  ? null
                  : StoreHelpers.equipment({
                      id: 'test-ranged-equipment',
                      slot: 'ranged',
                      rangedDamageBonus: equipmentBonus,
                    }),
            },
          },
        }),
      );

      const { container } = render(
        <HUD gameState={gameState.getSnapshot()} events={[]} />,
      );

      const expected = calculateRangedAttackPower(
        gameState.getSnapshot().player,
      );
      expect(container.textContent).toMatch(new RegExp(`RAN:\\s*${expected}`));
    },
  );
});
