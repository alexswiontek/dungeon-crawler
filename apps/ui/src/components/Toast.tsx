import { useEffect, useState } from 'react';
import { cn } from '@/utils/cn';

type ToastType = 'success' | 'danger' | 'info';

interface ToastProps {
  id: number;
  message: string;
  duration?: number;
  type?: ToastType;
  onRemove: (id: number) => void;
}

const TOAST_THEMES = {
  success: cn('from-amber-400 via-yellow-500 to-amber-600'),
  danger: cn('from-red-400 via-red-600 to-red-800'),
  info: cn('from-cyan-400 via-blue-500 to-blue-600'),
} as const;

export function Toast({
  id,
  message,
  duration = 3000,
  type = 'success',
  onRemove,
}: ToastProps) {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsVisible(false);
      setTimeout(() => onRemove(id), 300);
    }, duration);

    return () => clearTimeout(timer);
  }, [duration, id, onRemove]);

  return (
    <div
      className={cn(
        'flex-col items-center z-60 pointer-events-none transition-all duration-300',
        isVisible ? 'opacity-100 scale-100' : 'opacity-0 scale-95',
      )}
    >
      {/* Background Banner: No side borders, just a horizontal slice */}
      <div className="relative px-6 py-2 md:px-16 md:py-4 bg-linear-to-r from-transparent via-black/80 to-transparent border-y border-white/20 backdrop-blur-sm">
        {/* Main Title with Metallic Glint */}
        <span
          className={cn(
            'block text-base md:text-2xl lg:text-3xl font-serif font-black tracking-wide md:tracking-widest text-transparent bg-clip-text bg-linear-to-b animate-shine text-center leading-tight',
            TOAST_THEMES[type],
          )}
        >
          {message}
        </span>
      </div>
    </div>
  );
}
