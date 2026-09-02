import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ACTIVE_GAME_CREDENTIAL_KEY,
  ACTIVE_GAME_METADATA_KEY,
  GAME_SESSION_TTL_MS,
  GameSessionStorage,
  LEGACY_ACTIVE_GAME_KEY,
  PLAYER_PREFERENCES_KEY,
} from '@/game/GameSessionStorage';

describe('GameSessionStorage', () => {
  let values: Map<string, string>;
  let backend: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  let now: number;

  beforeEach(() => {
    values = new Map();
    now = 10_000;
    backend = {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => values.set(key, value)),
      removeItem: vi.fn((key: string) => values.delete(key)),
    };
  });

  it('stores public metadata and the secret credential in separate versioned records', () => {
    const storage = createStorage();
    storage.saveActiveGame({ gameId: 'game-a', sessionToken: 'secret-a' });

    const metadata = values.get(ACTIVE_GAME_METADATA_KEY) ?? '';
    const credential = values.get(ACTIVE_GAME_CREDENTIAL_KEY) ?? '';
    expect(metadata).toContain('game-a');
    expect(metadata).not.toContain('secret-a');
    expect(credential).toContain('secret-a');
    expect(storage.loadActiveGame()).toEqual({
      gameId: 'game-a',
      sessionToken: 'secret-a',
    });
  });

  it('expires the credential pair without clearing independent preferences', () => {
    const storage = createStorage();
    storage.savePreferences({ playerName: 'Ada', character: 'wizard' });
    storage.saveActiveGame({ gameId: 'game-a', sessionToken: 'secret-a' });
    now += GAME_SESSION_TTL_MS + 1;

    expect(storage.loadActiveGame()).toBeNull();
    expect(storage.loadPreferences()).toEqual({
      playerName: 'Ada',
      character: 'wizard',
    });
    expect(values.has(ACTIVE_GAME_METADATA_KEY)).toBe(false);
    expect(values.has(ACTIVE_GAME_CREDENTIAL_KEY)).toBe(false);
    expect(values.has(PLAYER_PREFERENCES_KEY)).toBe(true);
  });

  it.each([
    ['malformed metadata', '{', validCredential()],
    ['malformed credential', validMetadata(), '{'],
    [
      'storage version mismatch',
      JSON.stringify({ ...JSON.parse(validMetadata()), storageVersion: 2 }),
      validCredential(),
    ],
    [
      'protocol mismatch',
      JSON.stringify({ ...JSON.parse(validMetadata()), protocolVersion: '0' }),
      validCredential(),
    ],
  ])('clears both active records for %s', (_name, metadata, credential) => {
    values.set(ACTIVE_GAME_METADATA_KEY, metadata);
    values.set(ACTIVE_GAME_CREDENTIAL_KEY, credential);

    expect(createStorage().loadActiveGame()).toBeNull();
    expect(values.has(ACTIVE_GAME_METADATA_KEY)).toBe(false);
    expect(values.has(ACTIVE_GAME_CREDENTIAL_KEY)).toBe(false);
  });

  it('clears an incomplete credential pair', () => {
    values.set(ACTIVE_GAME_METADATA_KEY, validMetadata());

    expect(createStorage().loadActiveGame()).toBeNull();
    expect(values.size).toBe(0);
  });

  it('preserves and parses the exact legacy record until migration succeeds', () => {
    values.set(
      LEGACY_ACTIVE_GAME_KEY,
      JSON.stringify({
        gameId: 'legacy',
        playerName: 'Legacy Ada',
        character: 'elf',
        savedAt: now,
      }),
    );

    expect(createStorage().loadActiveGame()).toBeNull();
    expect(createStorage().loadLegacyGame()).toEqual({
      gameId: 'legacy',
      playerName: 'Legacy Ada',
      character: 'elf',
      savedAt: now,
    });
    expect(createStorage().loadPreferences()).toEqual({
      playerName: 'Legacy Ada',
      character: 'elf',
    });
    expect(values.has(LEGACY_ACTIVE_GAME_KEY)).toBe(true);

    createStorage().clearLegacyGame();
    expect(values.has(LEGACY_ACTIVE_GAME_KEY)).toBe(false);
  });

  it('tolerates read, write, and cleanup exceptions', () => {
    const unavailable = new GameSessionStorage({
      storage: {
        getItem: () => {
          throw new Error('disabled');
        },
        setItem: () => {
          throw new Error('quota');
        },
        removeItem: () => {
          throw new Error('disabled');
        },
      },
    });

    expect(unavailable.loadActiveGame()).toBeNull();
    expect(() =>
      unavailable.saveActiveGame({ gameId: 'memory', sessionToken: 'secret' }),
    ).not.toThrow();
    expect(() =>
      unavailable.savePreferences({ playerName: 'Ada', character: 'dwarf' }),
    ).not.toThrow();
  });

  it('clears malformed preferences without touching an active game', () => {
    const storage = createStorage();
    storage.saveActiveGame({ gameId: 'game-a', sessionToken: 'secret-a' });
    values.set(PLAYER_PREFERENCES_KEY, '{');

    expect(storage.loadPreferences()).toBeNull();
    expect(storage.loadActiveGame()).toEqual({
      gameId: 'game-a',
      sessionToken: 'secret-a',
    });
  });

  function createStorage(): GameSessionStorage {
    return new GameSessionStorage({ storage: backend, now: () => now });
  }

  function validMetadata(): string {
    return JSON.stringify({
      storageVersion: 1,
      protocolVersion: '1',
      gameId: 'game-a',
      savedAt: 10_000,
    });
  }

  function validCredential(): string {
    return JSON.stringify({
      storageVersion: 1,
      protocolVersion: '1',
      sessionToken: 'secret-a',
    });
  }
});
