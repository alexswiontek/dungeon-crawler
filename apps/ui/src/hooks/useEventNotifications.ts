import type { GameEvent } from '@dungeon-crawler/shared';
import { useEffect, useRef, useState } from 'react';
import type { TooltipVariant } from '@/components/GameTooltip';

export interface ToastData {
  id: number;
  message: string;
}

export interface TooltipData {
  id: number;
  message: string;
  subtext?: string;
  variant: TooltipVariant;
}

interface EventType {
  variant: TooltipVariant;
  isToast: boolean;
}

const EVENT_CONFIG: Record<string, EventType> = {
  level_up: { variant: 'success', isToast: true },
  equipment_equipped: { variant: 'success', isToast: false },
  equipment_found: { variant: 'neutral', isToast: false },
  player_healed: { variant: 'success', isToast: false },
  potion_refused: { variant: 'neutral', isToast: false },
  item_picked_up: { variant: 'neutral', isToast: false },
} as const;

// Type guard to validate event config exists
function hasEventConfig(
  eventType: string,
): eventType is keyof typeof EVENT_CONFIG {
  return eventType in EVENT_CONFIG;
}

export function useEventNotifications(events: GameEvent[], hasPlayer: boolean) {
  const [toasts, setToasts] = useState<ToastData[]>([]);
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const toastIdRef = useRef(0);
  const tooltipIdRef = useRef(0);
  const tooltipTimerRef = useRef<number | null>(null);
  const processedEventsRef = useRef<Set<string>>(new Set());

  // Reset all state when player is lost (game restart/disconnect)
  useEffect(() => {
    if (!hasPlayer) {
      setToasts([]);
      setTooltip(null);
      processedEventsRef.current.clear();
      if (tooltipTimerRef.current) {
        clearTimeout(tooltipTimerRef.current);
        tooltipTimerRef.current = null;
      }
    }
  }, [hasPlayer]);

  useEffect(() => {
    events.forEach((event) => {
      if (processedEventsRef.current.has(event.id)) return;

      // Type guard to validate event config exists
      if (!hasEventConfig(event.type)) return;

      const config = EVENT_CONFIG[event.type];
      if (!hasPlayer && !config.isToast) return;

      processedEventsRef.current.add(event.id);

      if (config.isToast) {
        const id = ++toastIdRef.current;
        setToasts((prev) => [...prev, { id, message: event.message }]);
      } else {
        // Clear existing tooltip timer
        if (tooltipTimerRef.current) {
          clearTimeout(tooltipTimerRef.current);
        }

        // Set new tooltip
        setTooltip({
          id: ++tooltipIdRef.current,
          message: event.message,
          variant: config.variant,
        });

        // Auto-dismiss tooltip after 3 seconds
        tooltipTimerRef.current = setTimeout(() => {
          setTooltip(null);
          tooltipTimerRef.current = null;
        }, 3000);
      }
    });

    // Cleanup timer on unmount
    return () => {
      if (tooltipTimerRef.current) {
        clearTimeout(tooltipTimerRef.current);
      }
    };
  }, [events, hasPlayer]);

  const removeToast = (id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const clearTooltip = () => {
    if (tooltipTimerRef.current) {
      clearTimeout(tooltipTimerRef.current);
      tooltipTimerRef.current = null;
    }
    setTooltip(null);
  };

  return {
    toasts,
    tooltip,
    removeToast,
    clearTooltip,
  };
}
