import * as matchers from '@testing-library/jest-dom/matchers';
import { cleanup } from '@testing-library/react';
import { afterEach, expect, vi } from 'vitest';

// Extend Vitest's expect with jest-dom matchers
expect.extend(matchers);

// Mock WebSocket globally
globalThis.WebSocket = vi.fn() as unknown as typeof WebSocket;

// Mock localStorage and sessionStorage
const storageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  length: 0,
  key: vi.fn(),
};

Object.defineProperty(window, 'localStorage', {
  value: storageMock,
});

Object.defineProperty(window, 'sessionStorage', {
  value: storageMock,
});

// Cleanup after each test
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  // Reset storage mock state to prevent cross-test pollution
  storageMock.length = 0;
});
