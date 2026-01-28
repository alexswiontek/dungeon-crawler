import { MAP_HEIGHT, MAP_WIDTH } from '@dungeon-crawler/shared';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { StoreHelpers } from '../test/helpers/storeHelpers';
import { GameState } from './GameState';

describe('GameState', () => {
  let gameState: GameState;

  beforeEach(() => {
    gameState = new GameState();
  });

  describe('constructor', () => {
    let constructedState: GameState;

    beforeAll(() => {
      constructedState = new GameState();
    });

    it('should initialize with empty state', () => {
      expect(constructedState).toMatchObject({
        _id: '',
        playerName: '',
        floor: 1,
        player: null,
        status: 'active',
        score: 0,
        version: 0,
      });
    });

    it('should initialize empty collections with correct dimensions', () => {
      // Map
      expect(constructedState.map).toHaveLength(MAP_HEIGHT);
      expect(constructedState.map[0]).toHaveLength(MAP_WIDTH);
      expect(constructedState.map[0][0]).toBeNull();
      expect(constructedState.map[MAP_HEIGHT - 1][MAP_WIDTH - 1]).toBeNull();

      // Fog
      expect(constructedState.fog).toHaveLength(MAP_HEIGHT);
      expect(constructedState.fog[0]).toHaveLength(MAP_WIDTH);
      expect(constructedState.fog[0][0]).toBe(false);
      expect(constructedState.fog[MAP_HEIGHT - 1][MAP_WIDTH - 1]).toBe(false);

      // Enemies and items
      expect(constructedState.enemies).toBeInstanceOf(Map);
      expect(constructedState.enemies.size).toBe(0);
      expect(constructedState.items).toBeInstanceOf(Map);
      expect(constructedState.items.size).toBe(0);
    });
  });

  describe('initFromVisible', () => {
    it('should copy all fields from VisibleGameState', () => {
      const visible = StoreHelpers.visibleGameState({
        _id: 'game-123',
        playerName: 'TestPlayer',
        floor: 3,
        score: 150,
        status: 'won',
      });

      gameState.initFromVisible(visible);

      expect(gameState).toMatchObject({
        _id: 'game-123',
        playerName: 'TestPlayer',
        floor: 3,
        score: 150,
        status: 'won',
      });
    });

    it('should create copies (not references) of player and fog', () => {
      const visible = StoreHelpers.visibleGameState();
      const originalPlayer = visible.player;
      const originalFog = visible.fog;

      gameState.initFromVisible(visible);

      // Should not be the same references
      expect(gameState.player).not.toBe(originalPlayer);
      expect(gameState.player).toEqual(originalPlayer);
      expect(gameState.fog).not.toBe(originalFog);
      expect(gameState.fog[0]).not.toBe(originalFog[0]);
      expect(gameState.fog).toEqual(originalFog);
    });

    it('should populate map, enemies, and items from visible arrays', () => {
      const tile1 = StoreHelpers.tile({ x: 5, y: 5, type: 'floor' });
      const tile2 = StoreHelpers.tile({ x: 10, y: 10, type: 'wall' });
      const enemy1 = StoreHelpers.enemy({ id: 'enemy-1', x: 10, y: 10 });
      const enemy2 = StoreHelpers.enemy({ id: 'enemy-2', x: 15, y: 15 });
      const item1 = StoreHelpers.item({ id: 'item-1', x: 8, y: 8 });
      const item2 = StoreHelpers.item({ id: 'item-2', x: 12, y: 12 });

      const visible = StoreHelpers.visibleGameState({
        visibleTiles: [tile1, tile2],
        visibleEnemies: [enemy1, enemy2],
        visibleItems: [item1, item2],
      });

      gameState.initFromVisible(visible);

      // Map
      expect(gameState.map[5][5]).toEqual(tile1);
      expect(gameState.map[10][10]).toEqual(tile2);
      expect(gameState.map[0][0]).toBeNull();

      // Enemies
      expect(gameState.enemies.size).toBe(2);
      expect(gameState.enemies.get('enemy-1')).toEqual(enemy1);
      expect(gameState.enemies.get('enemy-2')).toEqual(enemy2);

      // Items
      expect(gameState.items.size).toBe(2);
      expect(gameState.items.get('item-1')).toEqual(item1);
      expect(gameState.items.get('item-2')).toEqual(item2);
    });

    it('should replace existing collections', () => {
      // Add some initial data
      gameState.enemies.set(
        'old-enemy',
        StoreHelpers.enemy({ id: 'old-enemy' }),
      );
      gameState.items.set('old-item', StoreHelpers.item({ id: 'old-item' }));

      const visible = StoreHelpers.visibleGameState({
        visibleEnemies: [StoreHelpers.enemy({ id: 'new-enemy' })],
        visibleItems: [StoreHelpers.item({ id: 'new-item' })],
      });

      gameState.initFromVisible(visible);

      expect(gameState.enemies.size).toBe(1);
      expect(gameState.enemies.has('new-enemy')).toBe(true);
      expect(gameState.enemies.has('old-enemy')).toBe(false);
      expect(gameState.items.size).toBe(1);
      expect(gameState.items.has('new-item')).toBe(true);
      expect(gameState.items.has('old-item')).toBe(false);
    });

    it('should increment version counter', () => {
      const visible = StoreHelpers.visibleGameState();
      const initialVersion = gameState.version;

      gameState.initFromVisible(visible);

      expect(gameState.version).toBe(initialVersion + 1);
    });

    it('should handle empty visible arrays', () => {
      const visible = StoreHelpers.visibleGameState({
        visibleTiles: [],
        visibleEnemies: [],
        visibleItems: [],
      });

      gameState.initFromVisible(visible);

      expect(gameState.map[0][0]).toBeNull();
      expect(gameState.enemies.size).toBe(0);
      expect(gameState.items.size).toBe(0);
    });
  });

  describe('applyDelta - Core deltas', () => {
    beforeEach(() => {
      const visible = StoreHelpers.visibleGameState();
      gameState.initFromVisible(visible);
    });

    it('should apply player_pos delta', () => {
      const playerRef = gameState.player;
      const delta = StoreHelpers.delta.playerPos(10, 15, 'right');

      gameState.applyDelta(delta);

      expect(gameState.player).toBe(playerRef); // Same reference (mutation)
      expect(gameState.player).toMatchObject({
        x: 10,
        y: 15,
        facingDirection: 'right',
      });
      expect(gameState.version).toBeGreaterThan(0);
    });

    it('should apply player_stats delta', () => {
      const playerRef = gameState.player;
      const delta = StoreHelpers.delta.playerStats({
        hp: 20,
        maxHp: 30,
        attack: 10,
        xp: 100,
        level: 3,
      });

      gameState.applyDelta(delta);

      expect(gameState.player).toBe(playerRef); // Same reference (mutation)
      expect(gameState.player).toMatchObject({
        hp: 20,
        maxHp: 30,
        attack: 10,
        xp: 100,
        level: 3,
      });
    });

    it('should apply partial player_stats delta', () => {
      const originalHp = gameState.player?.hp;
      const delta = StoreHelpers.delta.playerStats({ attack: 15 });

      gameState.applyDelta(delta);

      expect(gameState.player?.attack).toBe(15);
      expect(gameState.player?.hp).toBe(originalHp);
    });

    it('should apply score delta', () => {
      const delta = StoreHelpers.delta.score(500);

      gameState.applyDelta(delta);

      expect(gameState.score).toBe(500);
    });

    it('should apply player_equipment delta', () => {
      const weapon = StoreHelpers.equipment({
        slot: 'weapon',
        name: 'Iron Sword',
      });
      const shield = StoreHelpers.equipment({
        slot: 'shield',
        name: 'Wooden Shield',
      });
      const delta = StoreHelpers.delta.playerEquipment({
        weapon,
        shield,
        armor: null,
        ranged: null,
      });

      gameState.applyDelta(delta);

      expect(gameState.player?.equipment.weapon).toEqual(weapon);
      expect(gameState.player?.equipment.shield).toEqual(shield);
      expect(gameState.player?.equipment.armor).toBeNull();
      expect(gameState.player?.equipment.ranged).toBeNull();
    });

    it('should apply floor delta', () => {
      const delta = StoreHelpers.delta.floor(5);

      gameState.applyDelta(delta);

      expect(gameState.floor).toBe(5);
    });

    it('should handle null player gracefully', () => {
      gameState.player = null;

      expect(() =>
        gameState.applyDelta(StoreHelpers.delta.playerPos(10, 15)),
      ).not.toThrow();
      expect(() =>
        gameState.applyDelta(StoreHelpers.delta.playerStats({ hp: 20 })),
      ).not.toThrow();
      expect(() =>
        gameState.applyDelta(
          StoreHelpers.delta.playerEquipment({
            weapon: null,
            shield: null,
            armor: null,
            ranged: null,
          }),
        ),
      ).not.toThrow();
    });
  });

  describe('applyDelta - Enemy deltas', () => {
    beforeEach(() => {
      const visible = StoreHelpers.visibleGameState();
      gameState.initFromVisible(visible);
    });

    it('should apply enemy_visible delta', () => {
      const enemy = StoreHelpers.enemy({ id: 'enemy-1', x: 10, y: 10 });
      const delta = StoreHelpers.delta.enemyVisible(enemy);

      gameState.applyDelta(delta);

      expect(gameState.enemies.size).toBe(1);
      expect(gameState.enemies.get('enemy-1')).toEqual(enemy);
    });

    it('should replace existing enemy with same id', () => {
      const enemy1 = StoreHelpers.enemy({ id: 'enemy-1', x: 10, y: 10 });
      const enemy2 = StoreHelpers.enemy({ id: 'enemy-1', x: 15, y: 15 });

      gameState.applyDelta(StoreHelpers.delta.enemyVisible(enemy1));
      gameState.applyDelta(StoreHelpers.delta.enemyVisible(enemy2));

      expect(gameState.enemies.size).toBe(1);
      expect(gameState.enemies.get('enemy-1')).toEqual(enemy2);
    });

    it('should apply enemy_moved delta', () => {
      const enemy = StoreHelpers.enemy({ id: 'enemy-1', x: 10, y: 10 });
      gameState.enemies.set('enemy-1', enemy);

      const enemyRef = gameState.enemies.get('enemy-1');
      const delta = StoreHelpers.delta.enemyMoved('enemy-1', 15, 20);

      gameState.applyDelta(delta);

      expect(gameState.enemies.get('enemy-1')).toBe(enemyRef); // Same reference (mutation)
      expect(gameState.enemies.get('enemy-1')?.x).toBe(15);
      expect(gameState.enemies.get('enemy-1')?.y).toBe(20);
    });

    it('should apply enemy_damaged delta', () => {
      const enemy = StoreHelpers.enemy({ id: 'enemy-1', hp: 10 });
      gameState.enemies.set('enemy-1', enemy);

      const enemyRef = gameState.enemies.get('enemy-1');
      const delta = StoreHelpers.delta.enemyDamaged('enemy-1', 5);

      gameState.applyDelta(delta);

      expect(gameState.enemies.get('enemy-1')).toBe(enemyRef); // Same reference (mutation)
      expect(gameState.enemies.get('enemy-1')?.hp).toBe(5);
    });

    it('should apply enemy_killed delta', () => {
      const enemy = StoreHelpers.enemy({ id: 'enemy-1' });
      gameState.enemies.set('enemy-1', enemy);

      const delta = StoreHelpers.delta.enemyKilled('enemy-1');

      gameState.applyDelta(delta);

      expect(gameState.enemies.size).toBe(0);
      expect(gameState.enemies.has('enemy-1')).toBe(false);
    });

    it('should handle non-existent enemy gracefully', () => {
      expect(() =>
        gameState.applyDelta(
          StoreHelpers.delta.enemyMoved('non-existent', 15, 20),
        ),
      ).not.toThrow();
      expect(() =>
        gameState.applyDelta(
          StoreHelpers.delta.enemyDamaged('non-existent', 5),
        ),
      ).not.toThrow();
      expect(() =>
        gameState.applyDelta(StoreHelpers.delta.enemyKilled('non-existent')),
      ).not.toThrow();
    });
  });

  describe('applyDelta - Item deltas', () => {
    beforeEach(() => {
      const visible = StoreHelpers.visibleGameState();
      gameState.initFromVisible(visible);
    });

    it('should apply item_visible delta', () => {
      const item = StoreHelpers.item({ id: 'item-1', x: 8, y: 8 });
      const delta = StoreHelpers.delta.itemVisible(item);

      gameState.applyDelta(delta);

      expect(gameState.items.size).toBe(1);
      expect(gameState.items.get('item-1')).toEqual(item);
    });

    it('should replace existing item with same id', () => {
      const item1 = StoreHelpers.item({ id: 'item-1', x: 8, y: 8 });
      const item2 = StoreHelpers.item({ id: 'item-1', x: 10, y: 10 });

      gameState.applyDelta(StoreHelpers.delta.itemVisible(item1));
      gameState.applyDelta(StoreHelpers.delta.itemVisible(item2));

      expect(gameState.items.size).toBe(1);
      expect(gameState.items.get('item-1')).toEqual(item2);
    });

    it('should apply item_removed delta', () => {
      const item = StoreHelpers.item({ id: 'item-1' });
      gameState.items.set('item-1', item);

      const delta = StoreHelpers.delta.itemRemoved('item-1');

      gameState.applyDelta(delta);

      expect(gameState.items.size).toBe(0);
      expect(gameState.items.has('item-1')).toBe(false);
    });

    it('should handle non-existent item gracefully', () => {
      const delta = StoreHelpers.delta.itemRemoved('non-existent');

      expect(() => gameState.applyDelta(delta)).not.toThrow();
      expect(gameState.items.size).toBe(0);
    });
  });

  describe('applyDelta - Map and fog deltas', () => {
    it('should apply fog_reveal delta', () => {
      const fogRef = gameState.fog;
      const delta = StoreHelpers.delta.fogReveal([
        [5, 5],
        [10, 10],
        [15, 15],
      ]);

      gameState.applyDelta(delta);

      expect(gameState.fog).toBe(fogRef); // Same reference (mutation)
      expect(gameState.fog[5][5]).toBe(true);
      expect(gameState.fog[10][10]).toBe(true);
      expect(gameState.fog[15][15]).toBe(true);
      expect(gameState.fog[0][0]).toBe(false);
    });

    it('should handle out-of-bounds fog cells gracefully', () => {
      const delta = StoreHelpers.delta.fogReveal([
        [5, 5],
        [-1, -1],
        [MAP_WIDTH + 10, MAP_HEIGHT + 10],
      ]);

      expect(() => gameState.applyDelta(delta)).not.toThrow();
      expect(gameState.fog[5][5]).toBe(true);
      expect(gameState.fog[0][0]).toBe(false);
    });

    it('should apply tiles_reveal delta', () => {
      const mapRef = gameState.map;
      const tile1 = StoreHelpers.tile({ x: 5, y: 5, type: 'floor' });
      const tile2 = StoreHelpers.tile({ x: 10, y: 10, type: 'wall' });
      const delta = StoreHelpers.delta.tilesReveal([tile1, tile2]);

      gameState.applyDelta(delta);

      expect(gameState.map).toBe(mapRef); // Same reference (mutation)
      expect(gameState.map[5][5]).toEqual(tile1);
      expect(gameState.map[10][10]).toEqual(tile2);
      expect(gameState.map[0][0]).toBeNull();
    });

    it('should handle empty arrays', () => {
      const initialVersion = gameState.version;

      expect(() =>
        gameState.applyDelta(StoreHelpers.delta.fogReveal([])),
      ).not.toThrow();
      expect(() =>
        gameState.applyDelta(StoreHelpers.delta.tilesReveal([])),
      ).not.toThrow();
      expect(gameState.version).toBe(initialVersion + 2);
    });
  });

  describe('applyDelta - State deltas', () => {
    it('should apply game_status delta', () => {
      const delta = StoreHelpers.delta.gameStatus('won');

      gameState.applyDelta(delta);

      expect(gameState.status).toBe('won');
    });

    it('should apply event delta without changing state', () => {
      const initialState = {
        _id: gameState._id,
        playerName: gameState.playerName,
        floor: gameState.floor,
        status: gameState.status,
        score: gameState.score,
      };

      const initialVersion = gameState.version;
      const delta = StoreHelpers.delta.event(
        StoreHelpers.event({
          type: 'player_attacked',
          message: 'You hit the rat!',
        }),
      );

      gameState.applyDelta(delta);

      // State unchanged
      expect(gameState._id).toBe(initialState._id);
      expect(gameState.playerName).toBe(initialState.playerName);
      expect(gameState.floor).toBe(initialState.floor);
      expect(gameState.status).toBe(initialState.status);
      expect(gameState.score).toBe(initialState.score);

      // Version incremented
      expect(gameState.version).toBe(initialVersion + 1);
    });

    it('should apply new_floor delta', () => {
      const visible1 = StoreHelpers.visibleGameState({ floor: 1, score: 100 });
      gameState.initFromVisible(visible1);

      const visible2 = StoreHelpers.visibleGameState({ floor: 2, score: 200 });
      const delta = StoreHelpers.delta.newFloor(visible2);

      const versionBefore = gameState.version;
      gameState.applyDelta(delta);

      expect(gameState.floor).toBe(2);
      expect(gameState.score).toBe(200);
      // initFromVisible increments version, then applyDelta increments again
      expect(gameState.version).toBe(versionBefore + 2);
    });

    it('should reset collections on new_floor delta', () => {
      const visible1 = StoreHelpers.visibleGameState({
        visibleEnemies: [StoreHelpers.enemy({ id: 'enemy-1' })],
        visibleItems: [StoreHelpers.item({ id: 'item-1' })],
      });
      gameState.initFromVisible(visible1);

      const visible2 = StoreHelpers.visibleGameState({
        floor: 2,
        visibleEnemies: [StoreHelpers.enemy({ id: 'enemy-2' })],
        visibleItems: [],
      });
      const delta = StoreHelpers.delta.newFloor(visible2);

      gameState.applyDelta(delta);

      expect(gameState.enemies.size).toBe(1);
      expect(gameState.enemies.has('enemy-2')).toBe(true);
      expect(gameState.enemies.has('enemy-1')).toBe(false);
      expect(gameState.items.size).toBe(0);
    });
  });

  describe('applyDeltas', () => {
    beforeEach(() => {
      const visible = StoreHelpers.visibleGameState();
      gameState.initFromVisible(visible);
    });

    it('should apply multiple deltas in sequence', () => {
      const deltas = [
        StoreHelpers.delta.playerPos(10, 15),
        StoreHelpers.delta.playerStats({ hp: 20 }),
        StoreHelpers.delta.score(100),
      ];

      gameState.applyDeltas(deltas);

      expect(gameState.player?.x).toBe(10);
      expect(gameState.player?.y).toBe(15);
      expect(gameState.player?.hp).toBe(20);
      expect(gameState.score).toBe(100);
    });

    it('should increment version once per delta', () => {
      const initialVersion = gameState.version;
      const deltas = [
        StoreHelpers.delta.playerPos(10, 15),
        StoreHelpers.delta.playerStats({ hp: 20 }),
        StoreHelpers.delta.score(100),
      ];

      gameState.applyDeltas(deltas);

      expect(gameState.version).toBe(initialVersion + 3);
    });

    it('should handle empty deltas array', () => {
      const initialVersion = gameState.version;

      gameState.applyDeltas([]);

      expect(gameState.version).toBe(initialVersion);
    });

    it('should handle complex delta sequence', () => {
      const enemy = StoreHelpers.enemy({ id: 'enemy-1', x: 10, y: 10, hp: 10 });
      const item = StoreHelpers.item({ id: 'item-1', x: 8, y: 8 });

      const deltas = [
        StoreHelpers.delta.enemyVisible(enemy),
        StoreHelpers.delta.itemVisible(item),
        StoreHelpers.delta.enemyMoved('enemy-1', 11, 11),
        StoreHelpers.delta.enemyDamaged('enemy-1', 5),
        StoreHelpers.delta.itemRemoved('item-1'),
        StoreHelpers.delta.enemyKilled('enemy-1'),
      ];

      gameState.applyDeltas(deltas);

      expect(gameState.enemies.size).toBe(0);
      expect(gameState.items.size).toBe(0);
    });

    it('should maintain mutation behavior across multiple deltas', () => {
      const playerRef = gameState.player;
      const mapRef = gameState.map;
      const fogRef = gameState.fog;

      const deltas = [
        StoreHelpers.delta.playerPos(10, 15),
        StoreHelpers.delta.tilesReveal([
          StoreHelpers.tile({ x: 5, y: 5, type: 'floor' }),
        ]),
        StoreHelpers.delta.fogReveal([[5, 5]]),
      ];

      gameState.applyDeltas(deltas);

      // References should remain the same (in-place mutations)
      expect(gameState.player).toBe(playerRef);
      expect(gameState.map).toBe(mapRef);
      expect(gameState.fog).toBe(fogRef);
    });
  });

  describe('reset', () => {
    beforeEach(() => {
      const visible = StoreHelpers.visibleGameState({
        _id: 'game-123',
        playerName: 'TestPlayer',
        floor: 5,
        score: 500,
        status: 'won',
        visibleEnemies: [StoreHelpers.enemy({ id: 'enemy-1' })],
        visibleItems: [StoreHelpers.item({ id: 'item-1' })],
      });
      gameState.initFromVisible(visible);
    });

    it('should clear all state fields', () => {
      gameState.reset();

      expect(gameState._id).toBe('');
      expect(gameState.playerName).toBe('');
      expect(gameState.floor).toBe(1);
      expect(gameState.player).toBeNull();
      expect(gameState.status).toBe('active');
      expect(gameState.score).toBe(0);
    });

    it('should clear collections and create new arrays', () => {
      const oldMap = gameState.map;
      const oldFog = gameState.fog;

      gameState.reset();

      expect(gameState.enemies.size).toBe(0);
      expect(gameState.items.size).toBe(0);
      expect(gameState.map).not.toBe(oldMap);
      expect(gameState.fog).not.toBe(oldFog);
      expect(gameState.map).toHaveLength(MAP_HEIGHT);
      expect(gameState.fog).toHaveLength(MAP_HEIGHT);
      expect(gameState.map[0][0]).toBeNull();
      expect(gameState.fog[0][0]).toBe(false);
    });

    it('should increment version counter', () => {
      const initialVersion = gameState.version;

      gameState.reset();

      expect(gameState.version).toBe(initialVersion + 1);
    });

    it('should be idempotent', () => {
      gameState.reset();
      const firstResetVersion = gameState.version;

      gameState.reset();
      const secondResetVersion = gameState.version;

      expect(gameState._id).toBe('');
      expect(gameState.playerName).toBe('');
      expect(gameState.floor).toBe(1);
      expect(gameState.player).toBeNull();
      expect(gameState.enemies.size).toBe(0);
      expect(gameState.items.size).toBe(0);
      expect(secondResetVersion).toBe(firstResetVersion + 1);
    });
  });

  describe('version counter', () => {
    it('should start at 0 and increment on state changes', () => {
      expect(gameState.version).toBe(0);

      const visible = StoreHelpers.visibleGameState();
      gameState.initFromVisible(visible);
      expect(gameState.version).toBe(1);

      gameState.applyDelta(StoreHelpers.delta.playerPos(10, 15));
      expect(gameState.version).toBe(2);

      gameState.applyDelta(StoreHelpers.delta.score(100));
      expect(gameState.version).toBe(3);

      gameState.reset();
      expect(gameState.version).toBe(4);
    });

    it('should provide monotonically increasing version numbers', () => {
      const visible = StoreHelpers.visibleGameState();
      const versions: number[] = [];

      versions.push(gameState.version);

      gameState.initFromVisible(visible);
      versions.push(gameState.version);

      gameState.applyDelta(StoreHelpers.delta.playerPos(10, 15));
      versions.push(gameState.version);

      gameState.applyDelta(StoreHelpers.delta.score(100));
      versions.push(gameState.version);

      gameState.reset();
      versions.push(gameState.version);

      // Each version should be greater than the previous
      for (let i = 1; i < versions.length; i++) {
        expect(versions[i]).toBeGreaterThan(versions[i - 1]);
        expect(versions[i]).toBe(versions[i - 1] + 1);
      }
    });
  });
});
