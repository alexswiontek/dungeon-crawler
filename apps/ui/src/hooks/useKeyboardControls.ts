import type { Direction } from '@dungeon-crawler/shared';
import type { GameClientSnapshot } from '@/game/GameClientModel';

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

function isActive(gameState: GameClientSnapshot): boolean {
  return gameState.status === 'active';
}

export function useKeyboardControls(
  gameState: GameClientSnapshot,
  sendMove: (dir: Direction) => void,
  sendAttack: () => void,
) {
  const handleMove = (dir: Direction) => {
    if (!isActive(gameState)) return;
    sendMove(dir);
  };

  const handleAttack = () => {
    if (!isActive(gameState)) return;
    sendAttack();
  };

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
