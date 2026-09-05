import type { GameEvent } from '@dungeon-crawler/domain';
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastContainer } from '@/components/ToastContainer';
import { useEventNotifications } from '@/hooks/useEventNotifications';

function levelUp(id: string, level: number): GameEvent {
  return {
    id,
    type: 'level_up',
    message: `Level up! You are now Level ${level}!`,
    data: {
      newLevel: level,
      hpGained: 5,
      attackGained: 1,
      defenseGained: 1,
    },
  };
}

function Notifications({ events }: { events: GameEvent[] }) {
  const { toasts, removeToast } = useEventNotifications(events, true);
  return <ToastContainer toasts={toasts} onRemove={removeToast} />;
}

describe('level-up notifications', () => {
  afterEach(() => vi.useRealTimers());

  it('dismisses on schedule while gameplay rerenders', () => {
    vi.useFakeTimers();
    const events = [levelUp('level-2', 2)];
    const { rerender } = render(<Notifications events={events} />);

    for (let elapsed = 0; elapsed < 2_500; elapsed += 500) {
      act(() => vi.advanceTimersByTime(500));
      rerender(<Notifications events={events} />);
    }

    expect(screen.queryByText('Level up! You are now Level 2!')).toBeNull();
  });

  it('shows only the latest level reached by one action', () => {
    render(
      <Notifications events={[levelUp('level-2', 2), levelUp('level-3', 3)]} />,
    );

    expect(screen.queryByText('Level up! You are now Level 2!')).toBeNull();
    expect(screen.getByText('Level up! You are now Level 3!')).toBeTruthy();
  });
});
