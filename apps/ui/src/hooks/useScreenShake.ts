import { useEffect, useState } from 'react';

const SCREEN_SHAKE_DURATION = 300;

export function useScreenShake(playerDamaged: boolean) {
  const [isScreenShaking, setIsScreenShaking] = useState(false);

  useEffect(() => {
    if (playerDamaged) {
      setIsScreenShaking(true);
      const timer = setTimeout(
        () => setIsScreenShaking(false),
        SCREEN_SHAKE_DURATION,
      );
      return () => {
        clearTimeout(timer);
        setIsScreenShaking(false);
      };
    }
  }, [playerDamaged]);

  return isScreenShaking;
}
