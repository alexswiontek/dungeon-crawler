import type { Direction } from '@dungeon-crawler/shared';
import type { GameState } from '@/engine/GameState';

const KEY_MAP = {
  ArrowUp: 'up',
  w: 'up',
  W: 'up',
  ArrowDown: 'down',
  s: 'down',
  S: 'down',
  ArrowLeft: 'left',
  a: 'left',
  A: 'left',
  ArrowRight: 'right',
  d: 'right',
  D: 'right',
  ' ': 'attack',
} as const;

type KeyName = keyof typeof KEY_MAP;
type Action = (typeof KEY_MAP)[KeyName];

function isMappedKey(key: string): key is KeyName {
  return key in KEY_MAP;
}

function isActive(gameState: GameState): boolean {
  return gameState.player !== null && gameState.status === 'active';
}

export function useKeyboardControls(
  gameState: GameState,
  sendMove: (dir: Direction) => void,
  sendAttack: () => void,
) {
  // Button handlers for UI components (D-pad, etc.)
  const handleMove = (dir: Direction) => {
    if (!isActive(gameState)) return;
    sendMove(dir);
  };

  const handleAttack = () => {
    if (!isActive(gameState)) return;
    sendAttack();
  };

  // Keyboard handler - use this with onKeyDown on a container div
  const handleKeyDown = (e: React.KeyboardEvent | KeyboardEvent) => {
    if (!isActive(gameState)) return;
    if (!isMappedKey(e.key)) return;

    const action: Action = KEY_MAP[e.key];
    e.preventDefault();

    if (action === 'attack') {
      sendAttack();
    } else {
      sendMove(action);
    }
  };

  return { handleKeyDown, handleMove, handleAttack };
}
