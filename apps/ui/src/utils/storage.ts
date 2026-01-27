/**
 * Safe localStorage wrapper that handles exceptions
 * Needed for Safari private browsing, quota exceeded, or disabled storage
 */

export function createSafeStorage(storage: Storage) {
  return {
    getItem: (key: string): string | null => {
      try {
        return storage.getItem(key);
      } catch {
        // Storage is disabled, quota exceeded, or in private browsing
        return null;
      }
    },

    setItem: (key: string, value: string): void => {
      try {
        storage.setItem(key, value);
      } catch {
        // Storage is disabled, quota exceeded, or in private browsing
        // Silently fail - storage errors shouldn't break the game
      }
    },

    removeItem: (key: string): void => {
      try {
        storage.removeItem(key);
      } catch {
        // Storage is disabled or in private browsing - safe to ignore
      }
    },
  };
}

export const safeLocalStorage = createSafeStorage(localStorage);
export const safeSessionStorage = createSafeStorage(sessionStorage);
