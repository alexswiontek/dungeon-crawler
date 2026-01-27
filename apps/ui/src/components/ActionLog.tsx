import type { GameEvent } from '@dungeon-crawler/shared';

interface ActionLogProps {
  events: GameEvent[];
  maxEvents?: number;
}

export function ActionLog({ events, maxEvents = 3 }: ActionLogProps) {
  const recentEvents = events.slice(0, maxEvents);

  return (
    <div className="h-[70px] px-3 py-2 bg-dark/70 backdrop-blur-sm border-b border-gray-700 overflow-y-auto scrollbar-hide shrink-0">
      {recentEvents.length === 0 ? (
        <div className="text-gray-600 text-xs">No events yet...</div>
      ) : (
        recentEvents.map((event, i) => (
          <div
            key={event.id}
            className="text-xs text-gray-400 truncate"
            style={{ opacity: Math.max(0.4, 1 - i * 0.25) }}
          >
            {event.message}
          </div>
        ))
      )}
    </div>
  );
}
