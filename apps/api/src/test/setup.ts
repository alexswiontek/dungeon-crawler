import { afterEach, vi } from 'vitest';

// Set test environment
process.env.NODE_ENV = 'test';

// Mock environment variables
process.env.MONGODB_URI = 'mongodb://localhost:27017/dungeon-crawler-test';
process.env.PORT = '3001';
process.env.CLIENT_URL = 'http://localhost:5173';

// Reset all mocks after each test
afterEach(() => {
  vi.resetAllMocks();
});
