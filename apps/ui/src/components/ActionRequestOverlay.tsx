import { useEffect, useState } from 'react';

interface ActionRequestOverlayProps {
  error: string | null;
  onRetry: () => void;
  retryAt?: number | null;
}

export function ActionRequestOverlay({
  error,
  onRetry,
  retryAt = null,
}: ActionRequestOverlayProps) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (retryAt === null || retryAt <= now) return;
    const timer = window.setTimeout(
      () => setNow(Date.now()),
      Math.max(1, retryAt - now),
    );
    return () => window.clearTimeout(timer);
  }, [retryAt, now]);

  const waiting = retryAt !== null && now < retryAt;

  return (
    <div className="absolute inset-0 bg-dark/80 flex flex-col items-center justify-center z-40">
      <p className="text-gold font-medium">Action needs confirmation</p>
      {error && <p className="text-accent text-sm mt-2">{error}</p>}
      <button
        type="button"
        className="mt-4"
        onClick={onRetry}
        disabled={waiting}
      >
        {waiting ? 'Retry available shortly' : 'Retry Action'}
      </button>
    </div>
  );
}
