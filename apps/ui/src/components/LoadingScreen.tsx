import { useEffect, useState } from 'react';
import { AssetManager } from '@/engine/AssetManager';

interface LoadingScreenProps {
  connected: boolean;
  error: string | null;
}

export function LoadingScreen({ connected, error }: LoadingScreenProps) {
  const [assetsLoaded, setAssetsLoaded] = useState(false);
  const [assetLoadError, setAssetLoadError] = useState(false);

  useEffect(() => {
    AssetManager.loadAll()
      .then(() => setAssetsLoaded(true))
      .catch((err) => {
        console.error('[AssetManager] Failed to load assets:', err);
        setAssetLoadError(true);
      });
  }, []);

  return (
    <div className="h-dvh py-2.5 flex items-center justify-center">
      <div className="text-center">
        {assetLoadError ? (
          <>
            <p className="text-accent mb-4">Failed to load game assets</p>
            <button type="button" onClick={() => window.location.reload()}>
              Reload Page
            </button>
          </>
        ) : (
          <p>
            {!assetsLoaded
              ? 'Loading sprites...'
              : connected
                ? 'Loading game...'
                : 'Connecting...'}
          </p>
        )}
        {error && <p className="text-accent mt-2">{error}</p>}
      </div>
    </div>
  );
}
