interface ConnectionOverlayProps {
  reconnecting: boolean;
  reconnectAttempt: number;
  error: string | null;
}

export function ConnectionOverlay({
  reconnecting,
  reconnectAttempt,
  error,
}: ConnectionOverlayProps) {
  return (
    <div className="absolute inset-0 bg-dark/80 flex flex-col items-center justify-center z-40">
      <div className="w-8 h-8 border-2 border-gold border-t-transparent rounded-full animate-spin mb-3" />
      <p className="text-gold font-medium">
        {reconnecting
          ? `Reconnecting... (${reconnectAttempt}/10)`
          : 'Connecting...'}
      </p>
      {error && <p className="text-accent text-sm mt-2">{error}</p>}
      {reconnecting && reconnectAttempt > 3 && (
        <p className="text-gray-400 text-xs mt-2 max-w-xs text-center">
          Connection issues may be due to server maintenance. Your progress is
          saved.
        </p>
      )}
    </div>
  );
}
