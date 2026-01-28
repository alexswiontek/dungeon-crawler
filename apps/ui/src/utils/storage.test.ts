import type { MockInstance } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSafeStorage } from './storage';

function createTypedMockStorage() {
  return {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
    key: vi.fn(),
    length: 0,
  } as Storage;
}

describe('createSafeStorage', () => {
  let mockStorage: Storage;
  let mockGetItem: MockInstance;
  let mockSetItem: MockInstance;
  let mockRemoveItem: MockInstance;

  beforeEach(() => {
    mockStorage = createTypedMockStorage();
    mockGetItem = mockStorage.getItem as unknown as MockInstance;
    mockSetItem = mockStorage.setItem as unknown as MockInstance;
    mockRemoveItem = mockStorage.removeItem as unknown as MockInstance;
  });

  describe('getItem', () => {
    it('should return value when storage is available', () => {
      mockGetItem.mockReturnValue('test-value');

      const safeStorage = createSafeStorage(mockStorage);
      const result = safeStorage.getItem('test-key');

      expect(result).toBe('test-value');
      expect(mockStorage.getItem).toHaveBeenCalledWith('test-key');
    });

    it('should return null when storage throws error', () => {
      mockGetItem.mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });

      const safeStorage = createSafeStorage(mockStorage);
      const result = safeStorage.getItem('test-key');

      expect(result).toBeNull();
    });

    it('should return null when storage is disabled', () => {
      mockGetItem.mockImplementation(() => {
        throw new DOMException('Storage is disabled', 'SecurityError');
      });

      const safeStorage = createSafeStorage(mockStorage);
      const result = safeStorage.getItem('test-key');

      expect(result).toBeNull();
    });

    it('should return null when in private browsing mode', () => {
      mockGetItem.mockImplementation(() => {
        throw new DOMException('Cannot access storage', 'SecurityError');
      });

      const safeStorage = createSafeStorage(mockStorage);
      const result = safeStorage.getItem('test-key');

      expect(result).toBeNull();
    });

    it('should handle multiple calls after error', () => {
      mockGetItem.mockImplementation(() => {
        throw new Error('Storage error');
      });

      const safeStorage = createSafeStorage(mockStorage);

      expect(safeStorage.getItem('key1')).toBeNull();
      expect(safeStorage.getItem('key2')).toBeNull();
      expect(safeStorage.getItem('key3')).toBeNull();
    });
  });

  describe('setItem', () => {
    it('should set value when storage is available', () => {
      const safeStorage = createSafeStorage(mockStorage);
      safeStorage.setItem('test-key', 'test-value');

      expect(mockStorage.setItem).toHaveBeenCalledWith(
        'test-key',
        'test-value',
      );
    });

    it('should fail silently when storage throws error', () => {
      mockSetItem.mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });

      const safeStorage = createSafeStorage(mockStorage);

      // Should not throw
      expect(() => safeStorage.setItem('test-key', 'test-value')).not.toThrow();
    });

    it('should fail silently when storage is disabled', () => {
      mockSetItem.mockImplementation(() => {
        throw new DOMException('Storage is disabled', 'SecurityError');
      });

      const safeStorage = createSafeStorage(mockStorage);

      expect(() => safeStorage.setItem('test-key', 'test-value')).not.toThrow();
    });

    it('should fail silently when quota is exceeded', () => {
      mockSetItem.mockImplementation(() => {
        throw new DOMException('Quota exceeded', 'QuotaExceededError');
      });

      const safeStorage = createSafeStorage(mockStorage);

      expect(() =>
        safeStorage.setItem('test-key', 'large-value'),
      ).not.toThrow();
    });

    it('should handle multiple set attempts after error', () => {
      mockSetItem.mockImplementation(() => {
        throw new Error('Storage error');
      });

      const safeStorage = createSafeStorage(mockStorage);

      expect(() => {
        safeStorage.setItem('key1', 'value1');
        safeStorage.setItem('key2', 'value2');
        safeStorage.setItem('key3', 'value3');
      }).not.toThrow();
    });
  });

  describe('removeItem', () => {
    it('should remove item when storage is available', () => {
      const safeStorage = createSafeStorage(mockStorage);
      safeStorage.removeItem('test-key');

      expect(mockStorage.removeItem).toHaveBeenCalledWith('test-key');
    });

    it('should fail silently when storage throws error', () => {
      mockRemoveItem.mockImplementation(() => {
        throw new Error('Storage error');
      });

      const safeStorage = createSafeStorage(mockStorage);

      expect(() => safeStorage.removeItem('test-key')).not.toThrow();
    });

    it('should fail silently when storage is disabled', () => {
      mockRemoveItem.mockImplementation(() => {
        throw new DOMException('Storage is disabled', 'SecurityError');
      });

      const safeStorage = createSafeStorage(mockStorage);

      expect(() => safeStorage.removeItem('test-key')).not.toThrow();
    });

    it('should handle multiple remove attempts after error', () => {
      mockRemoveItem.mockImplementation(() => {
        throw new Error('Storage error');
      });

      const safeStorage = createSafeStorage(mockStorage);

      expect(() => {
        safeStorage.removeItem('key1');
        safeStorage.removeItem('key2');
        safeStorage.removeItem('key3');
      }).not.toThrow();
    });
  });

  describe('Normal Operations', () => {
    it('should work normally when no errors occur', () => {
      const actualStorage = new Map<string, string>();

      mockStorage.getItem = vi.fn(
        (key: string) => actualStorage.get(key) ?? null,
      );
      mockStorage.setItem = vi.fn((key: string, value: string) => {
        actualStorage.set(key, value);
      });
      mockStorage.removeItem = vi.fn((key: string) => {
        actualStorage.delete(key);
      });

      const safeStorage = createSafeStorage(mockStorage);

      // Set items
      safeStorage.setItem('key1', 'value1');
      safeStorage.setItem('key2', 'value2');

      // Get items
      expect(safeStorage.getItem('key1')).toBe('value1');
      expect(safeStorage.getItem('key2')).toBe('value2');

      // Remove item
      safeStorage.removeItem('key1');
      expect(safeStorage.getItem('key1')).toBeNull();

      // key2 should still exist
      expect(safeStorage.getItem('key2')).toBe('value2');
    });

    it('should handle empty string values', () => {
      mockGetItem.mockReturnValue('');
      mockSetItem.mockImplementation(() => {});

      const safeStorage = createSafeStorage(mockStorage);

      safeStorage.setItem('empty-key', '');
      expect(safeStorage.getItem('empty-key')).toBe('');
    });

    it('should handle JSON string values', () => {
      const jsonValue = JSON.stringify({ foo: 'bar', nested: { value: 123 } });
      mockGetItem.mockReturnValue(jsonValue);

      const safeStorage = createSafeStorage(mockStorage);
      const result = safeStorage.getItem('json-key');

      expect(result).toBe(jsonValue);
      if (result) {
        expect(JSON.parse(result)).toEqual({
          foo: 'bar',
          nested: { value: 123 },
        });
      }
    });
  });

  describe('Error Recovery', () => {
    it('should recover after temporary storage failure', () => {
      let callCount = 0;
      mockSetItem.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          throw new Error('Temporary failure');
        }
        // Success on second call
      });

      const safeStorage = createSafeStorage(mockStorage);

      // First call fails silently
      safeStorage.setItem('key', 'value1');

      // Second call succeeds
      safeStorage.setItem('key', 'value2');

      expect(mockStorage.setItem).toHaveBeenCalledTimes(2);
    });

    it('should isolate errors between operations', () => {
      mockSetItem.mockImplementation(() => {
        throw new Error('setItem error');
      });
      mockGetItem.mockReturnValue('value');

      const safeStorage = createSafeStorage(mockStorage);

      // setItem fails
      safeStorage.setItem('key', 'value');

      // getItem still works
      expect(safeStorage.getItem('key')).toBe('value');
    });
  });
});
