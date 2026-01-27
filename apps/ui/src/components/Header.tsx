import { Button } from '@/components/Button';

interface HeaderProps {
  zoomedOut: boolean;
  onToggleZoom: () => void;
  onRestart: () => void;
}

export function Header({ zoomedOut, onToggleZoom, onRestart }: HeaderProps) {
  return (
    <header className="h-12 flex items-center justify-between px-3 bg-primary border-b border-gray-700 shrink-0">
      <h1 className="text-lg font-bold text-light">Dungeon Crawler</h1>
      <div className="flex gap-2">
        <Button
          type="button"
          onClick={onToggleZoom}
          className="hidden md:block px-2 py-1 text-xs border border-gray-600 rounded hover:border-gray-400 transition-colors"
          title={zoomedOut ? 'Zoom in (close-up)' : 'Zoom out (overview)'}
        >
          {zoomedOut ? 'Zoom In' : 'Zoom Out'}
        </Button>
        <Button
          type="button"
          onClick={onRestart}
          className="px-2 py-1 text-xs border border-gray-600 rounded hover:border-gray-400 transition-colors"
          title="Restart game"
        >
          Restart
        </Button>
      </div>
    </header>
  );
}
