import type { CharacterType } from '@dungeon-crawler/domain';
import { GAMEPLAY_PROTOCOL_VERSION } from '@dungeon-crawler/protocol';
import { z } from 'zod';
import type { GameSessionCredential } from '@/game/GameHttpClient';

export const ACTIVE_GAME_METADATA_KEY = 'dungeon_crawler_active_game_metadata';
export const ACTIVE_GAME_CREDENTIAL_KEY =
  'dungeon_crawler_active_game_credential';
export const PLAYER_PREFERENCES_KEY = 'dungeon_crawler_player_preferences';
export const LEGACY_ACTIVE_GAME_KEY = 'dungeon_crawler_active_game';

export const GAME_STORAGE_VERSION = 1;
export const GAME_SESSION_TTL_MS = 60 * 60 * 1000;

const ActiveGameMetadataSchema = z.strictObject({
  storageVersion: z.literal(GAME_STORAGE_VERSION),
  protocolVersion: z.literal(GAMEPLAY_PROTOCOL_VERSION),
  gameId: z.string().min(1),
  savedAt: z.number().finite(),
});

const ActiveGameCredentialSchema = z.strictObject({
  storageVersion: z.literal(GAME_STORAGE_VERSION),
  protocolVersion: z.literal(GAMEPLAY_PROTOCOL_VERSION),
  sessionToken: z.string().min(1),
});

const PlayerPreferencesSchema = z.strictObject({
  storageVersion: z.literal(GAME_STORAGE_VERSION),
  playerName: z.string(),
  character: z.enum(['dwarf', 'elf', 'bandit', 'wizard']),
});

const LegacyActiveGameSchema = z.object({
  gameId: z.string().min(1),
  playerName: z.string(),
  character: z.enum(['dwarf', 'elf', 'bandit', 'wizard']).optional(),
  savedAt: z.number().finite(),
});

export interface PlayerPreferences {
  readonly playerName: string;
  readonly character: CharacterType;
}

export interface LegacyActiveGame {
  readonly gameId: string;
  readonly playerName: string;
  readonly character: CharacterType;
  readonly savedAt: number;
}

export interface ActiveGameStorage {
  saveActiveGame(credential: GameSessionCredential): boolean;
  clearActiveGame(): void;
  clearLegacyGame(): void;
}

interface GameSessionStorageOptions {
  readonly storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  readonly now?: () => number;
  readonly ttlMs?: number;
}

export class GameSessionStorage implements ActiveGameStorage {
  private readonly storage: GameSessionStorageOptions['storage'];
  private readonly now: () => number;
  private readonly ttlMs: number;

  constructor(options: GameSessionStorageOptions) {
    this.storage = options.storage;
    this.now = options.now ?? Date.now;
    this.ttlMs = options.ttlMs ?? GAME_SESSION_TTL_MS;
  }

  loadActiveGame(): GameSessionCredential | null {
    const metadataJson = this.get(ACTIVE_GAME_METADATA_KEY);
    const credentialJson = this.get(ACTIVE_GAME_CREDENTIAL_KEY);
    if (!metadataJson && !credentialJson) return null;
    if (!metadataJson || !credentialJson) {
      this.clearActiveGame();
      return null;
    }

    try {
      const metadata = ActiveGameMetadataSchema.parse(JSON.parse(metadataJson));
      const credential = ActiveGameCredentialSchema.parse(
        JSON.parse(credentialJson),
      );
      if (this.now() - metadata.savedAt > this.ttlMs) {
        this.clearActiveGame();
        return null;
      }
      return {
        gameId: metadata.gameId,
        sessionToken: credential.sessionToken,
      };
    } catch {
      this.clearActiveGame();
      return null;
    }
  }

  loadLegacyGame(): LegacyActiveGame | null {
    const legacyJson = this.get(LEGACY_ACTIVE_GAME_KEY);
    if (!legacyJson) return null;
    try {
      const legacy = LegacyActiveGameSchema.parse(JSON.parse(legacyJson));
      if (this.now() - legacy.savedAt > this.ttlMs) {
        this.clearLegacyGame();
        return null;
      }
      return {
        gameId: legacy.gameId,
        playerName: legacy.playerName,
        character: legacy.character ?? 'dwarf',
        savedAt: legacy.savedAt,
      };
    } catch {
      this.clearLegacyGame();
      return null;
    }
  }

  saveActiveGame(credential: GameSessionCredential): boolean {
    try {
      this.storage.setItem(
        ACTIVE_GAME_METADATA_KEY,
        JSON.stringify({
          storageVersion: GAME_STORAGE_VERSION,
          protocolVersion: GAMEPLAY_PROTOCOL_VERSION,
          gameId: credential.gameId,
          savedAt: this.now(),
        }),
      );
      this.storage.setItem(
        ACTIVE_GAME_CREDENTIAL_KEY,
        JSON.stringify({
          storageVersion: GAME_STORAGE_VERSION,
          protocolVersion: GAMEPLAY_PROTOCOL_VERSION,
          sessionToken: credential.sessionToken,
        }),
      );
      return true;
    } catch {
      this.clearActiveGame();
      return false;
    }
  }

  clearActiveGame(): void {
    this.remove(ACTIVE_GAME_METADATA_KEY);
    this.remove(ACTIVE_GAME_CREDENTIAL_KEY);
  }

  clearLegacyGame(): void {
    this.remove(LEGACY_ACTIVE_GAME_KEY);
  }

  loadPreferences(): PlayerPreferences | null {
    const value = this.get(PLAYER_PREFERENCES_KEY);
    if (!value) {
      const legacyJson = this.get(LEGACY_ACTIVE_GAME_KEY);
      if (!legacyJson) return null;
      try {
        const legacy = LegacyActiveGameSchema.parse(JSON.parse(legacyJson));
        const preferences = {
          playerName: legacy.playerName,
          character: legacy.character ?? ('dwarf' as const),
        };
        this.savePreferences(preferences);
        return preferences;
      } catch {
        return null;
      }
    }
    try {
      const parsed = PlayerPreferencesSchema.parse(JSON.parse(value));
      return {
        playerName: parsed.playerName,
        character: parsed.character,
      };
    } catch {
      this.remove(PLAYER_PREFERENCES_KEY);
      return null;
    }
  }

  savePreferences(preferences: PlayerPreferences): void {
    try {
      this.storage.setItem(
        PLAYER_PREFERENCES_KEY,
        JSON.stringify({
          storageVersion: GAME_STORAGE_VERSION,
          ...preferences,
        }),
      );
    } catch {
      // Preferences are optional and must not block in-memory play.
    }
  }

  private get(key: string): string | null {
    try {
      return this.storage.getItem(key);
    } catch {
      return null;
    }
  }

  private remove(key: string): void {
    try {
      this.storage.removeItem(key);
    } catch {
      // Storage cleanup is best effort when browser storage is unavailable.
    }
  }
}
