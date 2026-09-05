import { useCallback, useEffect, useRef, useState } from 'react';
import { AssetManager } from '@/engine/AssetManager';

interface LoadingScreenProps {
  error: string | null;
}

export function LoadingScreen({ error }: LoadingScreenProps) {
  const [assetsLoaded, setAssetsLoaded] = useState(false);
  const [assetLoadError, setAssetLoadError] = useState(false);
  const mountedRef = useRef(false);

  const loadAssets = useCallback(async (): Promise<void> => {
    setAssetsLoaded(false);
    setAssetLoadError(false);
    try {
      await AssetManager.loadAll();
      if (mountedRef.current) setAssetsLoaded(true);
    } catch {
      if (mountedRef.current) setAssetLoadError(true);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void loadAssets();
    return () => {
      mountedRef.current = false;
    };
  }, [loadAssets]);

  return (
    <div className="h-dvh py-2.5 flex items-center justify-center">
      <div className="text-center">
        {assetLoadError ? (
          <>
            <p className="text-accent mb-4">Failed to load game assets</p>
            <button type="button" onClick={() => void loadAssets()}>
              Retry Assets
            </button>
          </>
        ) : (
          <p>{!assetsLoaded ? 'Loading sprites...' : 'Loading game...'}</p>
        )}
        {error && <p className="text-accent mt-2">{error}</p>}
      </div>
    </div>
  );
}
