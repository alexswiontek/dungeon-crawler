import { useEffect, useState } from 'react';
import { useWindowSize } from '@/hooks/useWindowSize';
import { cn } from '@/utils/cn';

export type TooltipVariant = 'success' | 'neutral';

interface GameTooltipProps {
  message: string;
  subtext?: string;
  variant?: TooltipVariant;
  duration?: number;
  onDone: () => void;
  toastCount?: number;
}

export function GameTooltip({
  message,
  subtext,
  variant = 'success',
  duration = 3000,
  onDone,
  toastCount = 0,
}: GameTooltipProps) {
  const [isVisible, setIsVisible] = useState(true);
  const { isMobile } = useWindowSize();

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsVisible(false);
      setTimeout(onDone, 300);
    }, duration);

    return () => clearTimeout(timer);
  }, [duration, onDone]);

  const bgColor = variant === 'success' ? 'bg-green-800/90' : 'bg-gray-700/90';
  const borderColor =
    variant === 'success' ? 'border-green-500' : 'border-gray-500';

  // Calculate offset for mobile when toasts are present
  // Each toast is approximately 48px tall + 8px gap
  const mobileTopOffset = 162 + toastCount * 56;

  return (
    <div
      className={cn(
        'left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 border-2 rounded-lg text-sm sm:text-base text-light shadow-xl transition-all duration-300 text-center pointer-events-none backdrop-blur-sm',
        // Mobile: wide enough for most messages, max 2 lines
        // Desktop: even wider
        'min-w-[280px] max-w-[95vw] sm:max-w-2xl',
        // Mobile: fixed position below toasts
        // Desktop: absolute bottom-4 (at bottom of canvas)
        'fixed md:absolute md:bottom-4',
        bgColor,
        borderColor,
        isVisible ? 'opacity-100 scale-100' : 'opacity-0 scale-95',
      )}
      style={
        isMobile
          ? {
              top: `${mobileTopOffset}px`,
            }
          : undefined
      }
    >
      <div className="font-bold leading-tight line-clamp-2">{message}</div>
      {subtext && (
        <div className="text-gray-300 text-xs sm:text-sm mt-1">{subtext}</div>
      )}
    </div>
  );
}
