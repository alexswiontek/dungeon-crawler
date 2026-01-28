import type { GameEvent } from '@dungeon-crawler/shared';
import { MAP_HEIGHT, MAP_WIDTH } from '@dungeon-crawler/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { StoreHelpers } from '../test/helpers/storeHelpers';
import { applyDelta, initializeFromVisible, useGameStore } from './gameStore';

describe('gameStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    useGameStore.getState().reset();
  });

  describe('initializeFromVisible', () => {
    it('should convert VisibleGameState to LocalGameState', () => {
      const visible = StoreHelpers.visibleGameState();
      const local = initializeFromVisible(visible);

      expect(local).toMatchObject({
        _id: visible._id,
        playerName: visible.playerName,
        floor: visible.floor,
        player: visible.player,
        status: visible.status,
        score: visible.score,
        fog: visible.fog,
      });
    });

    it('should create empty map with correct dimensions', () => {
      const visible = StoreHelpers.visibleGameState({ visibleTiles: [] });
      const local = initializeFromVisible(visible);

      expect(local.map).toHaveLength(MAP_HEIGHT);
      expect(local.map[0]).toHaveLength(MAP_WIDTH);
      expect(local.map[0][0]).toBeNull();
    });

    it('should populate tiles from visibleTiles', () => {
      const tile1 = StoreHelpers.tile({ x: 5, y: 5, type: 'floor' });
      const tile2 = StoreHelpers.tile({ x: 6, y: 6, type: 'wall' });
      const tile3 = StoreHelpers.tile({ x: 10, y: 10, type: 'stairs' });

      const visible = StoreHelpers.visibleGameState({
        visibleTiles: [tile1, tile2, tile3],
      });

      const local = initializeFromVisible(visible);

      expect(local.map[5][5]).toEqual(tile1);
      expect(local.map[6][6]).toEqual(tile2);
      expect(local.map[10][10]).toEqual(tile3);
      expect(local.map[0][0]).toBeNull();
    });

    it('should populate enemies as Map', () => {
      const enemy1 = StoreHelpers.enemy({ id: 'enemy-1', x: 10, y: 10 });
      const enemy2 = StoreHelpers.enemy({ id: 'enemy-2', x: 15, y: 15 });

      const visible = StoreHelpers.visibleGameState({
        visibleEnemies: [enemy1, enemy2],
      });

      const local = initializeFromVisible(visible);

      expect(local.enemies).toBeInstanceOf(Map);
      expect(local.enemies.size).toBe(2);
      expect(local.enemies.get('enemy-1')).toEqual(enemy1);
      expect(local.enemies.get('enemy-2')).toEqual(enemy2);
    });

    it('should populate items as Map', () => {
      const item1 = StoreHelpers.item({ id: 'item-1', x: 8, y: 8 });
      const item2 = StoreHelpers.item({ id: 'item-2', x: 12, y: 12 });

      const visible = StoreHelpers.visibleGameState({
        visibleItems: [item1, item2],
      });

      const local = initializeFromVisible(visible);

      expect(local.items).toBeInstanceOf(Map);
      expect(local.items.size).toBe(2);
      expect(local.items.get('item-1')).toEqual(item1);
      expect(local.items.get('item-2')).toEqual(item2);
    });

    it('should initialize fog correctly', () => {
      const customFog = Array.from({ length: MAP_HEIGHT }, () =>
        Array.from({ length: MAP_WIDTH }, () => false),
      );
      customFog[5][5] = true;
      customFog[6][6] = true;

      const visible = StoreHelpers.visibleGameState({ fog: customFog });
      const local = initializeFromVisible(visible);

      expect(local.fog).toBe(customFog);
      expect(local.fog[5][5]).toBe(true);
      expect(local.fog[6][6]).toBe(true);
      expect(local.fog[0][0]).toBe(false);
    });
  });

  describe('applyDelta - player_pos', () => {
    it('should update player position and facing direction', () => {
      const state = initializeFromVisible(StoreHelpers.visibleGameState());
      const delta = StoreHelpers.delta.playerPos(10, 15, 'left');

      const newState = applyDelta(state, delta);

      expect(newState.player).toMatchObject({
        x: 10,
        y: 15,
        facingDirection: 'left',
      });
    });

    it('should not mutate original state', () => {
      const state = initializeFromVisible(StoreHelpers.visibleGameState());
      const originalX = state.player.x;
      const delta = StoreHelpers.delta.playerPos(20, 20, 'right');

      applyDelta(state, delta);

      expect(state.player.x).toBe(originalX);
    });
  });

  describe('applyDelta - player_stats', () => {
    it('should update hp only', () => {
      const state = initializeFromVisible(StoreHelpers.visibleGameState());
      const delta = StoreHelpers.delta.playerStats({ hp: 20 });

      const newState = applyDelta(state, delta);

      expect(newState.player.hp).toBe(20);
      expect(newState.player.maxHp).toBe(state.player.maxHp);
      expect(newState.player.attack).toBe(state.player.attack);
    });

    it('should update maxHp only', () => {
      const state = initializeFromVisible(StoreHelpers.visibleGameState());
      const delta = StoreHelpers.delta.playerStats({ maxHp: 30 });

      const newState = applyDelta(state, delta);

      expect(newState.player.maxHp).toBe(30);
      expect(newState.player.hp).toBe(state.player.hp);
    });

    it('should update multiple stats at once', () => {
      const state = initializeFromVisible(StoreHelpers.visibleGameState());
      const delta = StoreHelpers.delta.playerStats({
        hp: 18,
        attack: 8,
        defense: 5,
        xp: 100,
      });

      const newState = applyDelta(state, delta);

      expect(newState.player).toMatchObject({
        hp: 18,
        attack: 8,
        defense: 5,
        xp: 100,
      });
    });

    it('should update level and xpToNextLevel', () => {
      const state = initializeFromVisible(StoreHelpers.visibleGameState());
      const delta = StoreHelpers.delta.playerStats({
        level: 2,
        xp: 50,
        xpToNextLevel: 100,
      });

      const newState = applyDelta(state, delta);

      expect(newState.player).toMatchObject({
        level: 2,
        xp: 50,
        xpToNextLevel: 100,
      });
    });

    it('should handle partial updates without affecting other stats', () => {
      const state = initializeFromVisible(StoreHelpers.visibleGameState());
      const originalAttack = state.player.attack;
      const delta = StoreHelpers.delta.playerStats({ defense: 10 });

      const newState = applyDelta(state, delta);

      expect(newState.player.defense).toBe(10);
      expect(newState.player.attack).toBe(originalAttack);
    });
  });

  describe('applyDelta - player_equipment', () => {
    it('should update player equipment', () => {
      const state = initializeFromVisible(StoreHelpers.visibleGameState());
      const weapon = StoreHelpers.equipment({
        id: 'iron_sword',
        slot: 'weapon',
      });
      const shield = StoreHelpers.equipment({
        id: 'wooden_shield',
        slot: 'shield',
      });

      const delta = StoreHelpers.delta.playerEquipment({
        weapon,
        shield,
        armor: null,
        ranged: null,
      });

      const newState = applyDelta(state, delta);

      expect(newState.player.equipment.weapon).toEqual(weapon);
      expect(newState.player.equipment.shield).toEqual(shield);
      expect(newState.player.equipment.armor).toBeNull();
      expect(newState.player.equipment.ranged).toBeNull();
    });

    it('should replace entire equipment object', () => {
      const state = initializeFromVisible(
        StoreHelpers.visibleGameState({
          player: {
            equipment: {
              weapon: StoreHelpers.equipment(),
              shield: null,
              armor: null,
              ranged: null,
            },
          },
        }),
      );

      const delta = StoreHelpers.delta.playerEquipment({
        weapon: null,
        shield: null,
        armor: null,
        ranged: null,
      });

      const newState = applyDelta(state, delta);

      expect(newState.player.equipment.weapon).toBeNull();
    });
  });

  describe('applyDelta - score', () => {
    it('should update score', () => {
      const state = initializeFromVisible(StoreHelpers.visibleGameState());
      const delta = StoreHelpers.delta.score(150);

      const newState = applyDelta(state, delta);

      expect(newState.score).toBe(150);
    });

    it('should handle zero score', () => {
      const state = initializeFromVisible(
        StoreHelpers.visibleGameState({ score: 100 }),
      );
      const delta = StoreHelpers.delta.score(0);

      const newState = applyDelta(state, delta);

      expect(newState.score).toBe(0);
    });
  });

  describe('applyDelta - floor', () => {
    it('should update floor number', () => {
      const state = initializeFromVisible(StoreHelpers.visibleGameState());
      const delta = StoreHelpers.delta.floor(3);

      const newState = applyDelta(state, delta);

      expect(newState.floor).toBe(3);
    });
  });

  describe('applyDelta - enemy_visible', () => {
    it('should add enemy to Map', () => {
      const state = initializeFromVisible(StoreHelpers.visibleGameState());
      const enemy = StoreHelpers.enemy({ id: 'new-enemy', x: 12, y: 12 });
      const delta = StoreHelpers.delta.enemyVisible(enemy);

      const newState = applyDelta(state, delta);

      expect(newState.enemies.size).toBe(1);
      expect(newState.enemies.get('new-enemy')).toEqual(enemy);
    });

    it('should add multiple enemies', () => {
      const state = initializeFromVisible(StoreHelpers.visibleGameState());
      const enemy1 = StoreHelpers.enemy({ id: 'enemy-1' });
      const enemy2 = StoreHelpers.enemy({ id: 'enemy-2' });

      let newState = applyDelta(state, StoreHelpers.delta.enemyVisible(enemy1));
      newState = applyDelta(newState, StoreHelpers.delta.enemyVisible(enemy2));

      expect(newState.enemies.size).toBe(2);
      expect(newState.enemies.get('enemy-1')).toEqual(enemy1);
      expect(newState.enemies.get('enemy-2')).toEqual(enemy2);
    });

    it('should not mutate original enemies Map', () => {
      const state = initializeFromVisible(StoreHelpers.visibleGameState());
      const enemy = StoreHelpers.enemy();
      const delta = StoreHelpers.delta.enemyVisible(enemy);

      applyDelta(state, delta);

      expect(state.enemies.size).toBe(0);
    });
  });

  describe('applyDelta - enemy_moved', () => {
    it('should update enemy position', () => {
      const enemy = StoreHelpers.enemy({ id: 'enemy-1', x: 10, y: 10 });
      const state = initializeFromVisible(
        StoreHelpers.visibleGameState({ visibleEnemies: [enemy] }),
      );

      const delta = StoreHelpers.delta.enemyMoved('enemy-1', 12, 14);
      const newState = applyDelta(state, delta);

      expect(newState.enemies.get('enemy-1')?.x).toBe(12);
      expect(newState.enemies.get('enemy-1')?.y).toBe(14);
    });

    it('should preserve other enemy properties', () => {
      const enemy = StoreHelpers.enemy({
        id: 'enemy-1',
        x: 10,
        y: 10,
        hp: 15,
        type: 'skeleton',
      });
      const state = initializeFromVisible(
        StoreHelpers.visibleGameState({ visibleEnemies: [enemy] }),
      );

      const delta = StoreHelpers.delta.enemyMoved('enemy-1', 11, 11);
      const newState = applyDelta(state, delta);

      const updatedEnemy = newState.enemies.get('enemy-1');
      expect(updatedEnemy?.hp).toBe(15);
      expect(updatedEnemy?.type).toBe('skeleton');
    });

    it('should do nothing if enemy not found', () => {
      const state = initializeFromVisible(StoreHelpers.visibleGameState());
      const delta = StoreHelpers.delta.enemyMoved('nonexistent', 5, 5);

      const newState = applyDelta(state, delta);

      expect(newState.enemies.size).toBe(0);
    });
  });

  describe('applyDelta - enemy_damaged', () => {
    it('should update enemy HP', () => {
      const enemy = StoreHelpers.enemy({ id: 'enemy-1', hp: 20, maxHp: 20 });
      const state = initializeFromVisible(
        StoreHelpers.visibleGameState({ visibleEnemies: [enemy] }),
      );

      const delta = StoreHelpers.delta.enemyDamaged('enemy-1', 15);
      const newState = applyDelta(state, delta);

      expect(newState.enemies.get('enemy-1')?.hp).toBe(15);
    });

    it('should preserve other enemy properties', () => {
      const enemy = StoreHelpers.enemy({ id: 'enemy-1', hp: 20, x: 10, y: 10 });
      const state = initializeFromVisible(
        StoreHelpers.visibleGameState({ visibleEnemies: [enemy] }),
      );

      const delta = StoreHelpers.delta.enemyDamaged('enemy-1', 5);
      const newState = applyDelta(state, delta);

      const updatedEnemy = newState.enemies.get('enemy-1');
      expect(updatedEnemy?.x).toBe(10);
      expect(updatedEnemy?.y).toBe(10);
      expect(updatedEnemy?.maxHp).toBe(enemy.maxHp);
    });

    it('should do nothing if enemy not found', () => {
      const state = initializeFromVisible(StoreHelpers.visibleGameState());
      const delta = StoreHelpers.delta.enemyDamaged('nonexistent', 10);

      const newState = applyDelta(state, delta);

      expect(newState.enemies.size).toBe(0);
    });
  });

  describe('applyDelta - enemy_killed', () => {
    it('should remove enemy from Map', () => {
      const enemy = StoreHelpers.enemy({ id: 'enemy-1' });
      const state = initializeFromVisible(
        StoreHelpers.visibleGameState({ visibleEnemies: [enemy] }),
      );

      const delta = StoreHelpers.delta.enemyKilled('enemy-1');
      const newState = applyDelta(state, delta);

      expect(newState.enemies.size).toBe(0);
      expect(newState.enemies.get('enemy-1')).toBeUndefined();
    });

    it('should not affect other enemies', () => {
      const enemy1 = StoreHelpers.enemy({ id: 'enemy-1' });
      const enemy2 = StoreHelpers.enemy({ id: 'enemy-2' });
      const state = initializeFromVisible(
        StoreHelpers.visibleGameState({ visibleEnemies: [enemy1, enemy2] }),
      );

      const delta = StoreHelpers.delta.enemyKilled('enemy-1');
      const newState = applyDelta(state, delta);

      expect(newState.enemies.size).toBe(1);
      expect(newState.enemies.get('enemy-2')).toEqual(enemy2);
    });
  });

  describe('applyDelta - enemy_hidden', () => {
    it('should remove enemy from Map', () => {
      const enemy = StoreHelpers.enemy({ id: 'enemy-1' });
      const state = initializeFromVisible(
        StoreHelpers.visibleGameState({ visibleEnemies: [enemy] }),
      );

      const delta = StoreHelpers.delta.enemyHidden('enemy-1');
      const newState = applyDelta(state, delta);

      expect(newState.enemies.size).toBe(0);
      expect(newState.enemies.get('enemy-1')).toBeUndefined();
    });

    it('should behave same as enemy_killed', () => {
      const enemy = StoreHelpers.enemy({ id: 'enemy-1' });
      const state = initializeFromVisible(
        StoreHelpers.visibleGameState({ visibleEnemies: [enemy] }),
      );

      const killedState = applyDelta(
        state,
        StoreHelpers.delta.enemyKilled('enemy-1'),
      );
      const hiddenState = applyDelta(
        state,
        StoreHelpers.delta.enemyHidden('enemy-1'),
      );

      expect(killedState.enemies.size).toBe(hiddenState.enemies.size);
    });
  });

  describe('applyDelta - item_visible', () => {
    it('should add item to Map', () => {
      const state = initializeFromVisible(StoreHelpers.visibleGameState());
      const item = StoreHelpers.item({ id: 'item-1', x: 8, y: 8 });
      const delta = StoreHelpers.delta.itemVisible(item);

      const newState = applyDelta(state, delta);

      expect(newState.items.size).toBe(1);
      expect(newState.items.get('item-1')).toEqual(item);
    });

    it('should add multiple items', () => {
      const state = initializeFromVisible(StoreHelpers.visibleGameState());
      const item1 = StoreHelpers.item({ id: 'item-1' });
      const item2 = StoreHelpers.item({ id: 'item-2' });

      let newState = applyDelta(state, StoreHelpers.delta.itemVisible(item1));
      newState = applyDelta(newState, StoreHelpers.delta.itemVisible(item2));

      expect(newState.items.size).toBe(2);
      expect(newState.items.get('item-1')).toEqual(item1);
      expect(newState.items.get('item-2')).toEqual(item2);
    });

    it('should not mutate original items Map', () => {
      const state = initializeFromVisible(StoreHelpers.visibleGameState());
      const item = StoreHelpers.item();
      const delta = StoreHelpers.delta.itemVisible(item);

      applyDelta(state, delta);

      expect(state.items.size).toBe(0);
    });
  });

  describe('applyDelta - item_removed', () => {
    it('should remove item from Map', () => {
      const item = StoreHelpers.item({ id: 'item-1' });
      const state = initializeFromVisible(
        StoreHelpers.visibleGameState({ visibleItems: [item] }),
      );

      const delta = StoreHelpers.delta.itemRemoved('item-1');
      const newState = applyDelta(state, delta);

      expect(newState.items.size).toBe(0);
      expect(newState.items.get('item-1')).toBeUndefined();
    });

    it('should not affect other items', () => {
      const item1 = StoreHelpers.item({ id: 'item-1' });
      const item2 = StoreHelpers.item({ id: 'item-2' });
      const state = initializeFromVisible(
        StoreHelpers.visibleGameState({ visibleItems: [item1, item2] }),
      );

      const delta = StoreHelpers.delta.itemRemoved('item-1');
      const newState = applyDelta(state, delta);

      expect(newState.items.size).toBe(1);
      expect(newState.items.get('item-2')).toEqual(item2);
    });
  });

  describe('applyDelta - fog_reveal', () => {
    it('should reveal specified fog cells', () => {
      const state = initializeFromVisible(StoreHelpers.visibleGameState());
      const cells: [number, number][] = [
        [10, 10],
        [11, 11],
        [12, 12],
      ];
      const delta = StoreHelpers.delta.fogReveal(cells);

      const newState = applyDelta(state, delta);

      expect(newState.fog[10][10]).toBe(true);
      expect(newState.fog[11][11]).toBe(true);
      expect(newState.fog[12][12]).toBe(true);
    });

    it('should not mutate original fog array', () => {
      const state = initializeFromVisible(StoreHelpers.visibleGameState());
      state.fog[15][15] = false;

      const cells: [number, number][] = [[15, 15]];
      const delta = StoreHelpers.delta.fogReveal(cells);

      applyDelta(state, delta);

      expect(state.fog[15][15]).toBe(false);
    });

    it('should handle out-of-bounds cells gracefully', () => {
      const state = initializeFromVisible(StoreHelpers.visibleGameState());
      const cells: [number, number][] = [
        [-1, -1],
        [1000, 1000],
        [5, 5],
      ];
      const delta = StoreHelpers.delta.fogReveal(cells);

      const newState = applyDelta(state, delta);

      expect(newState.fog[5][5]).toBe(true);
    });

    it('should create a new fog array reference', () => {
      const state = initializeFromVisible(StoreHelpers.visibleGameState());
      const delta = StoreHelpers.delta.fogReveal([[1, 1]]);

      const newState = applyDelta(state, delta);

      expect(newState.fog).not.toBe(state.fog);
    });
  });

  describe('applyDelta - tiles_reveal', () => {
    it('should reveal specified tiles', () => {
      const state = initializeFromVisible(StoreHelpers.visibleGameState());
      const tiles = [
        StoreHelpers.tile({ x: 10, y: 10, type: 'floor' }),
        StoreHelpers.tile({ x: 11, y: 11, type: 'wall' }),
        StoreHelpers.tile({ x: 12, y: 12, type: 'stairs' }),
      ];
      const delta = StoreHelpers.delta.tilesReveal(tiles);

      const newState = applyDelta(state, delta);

      expect(newState.map[10][10]).toEqual(tiles[0]);
      expect(newState.map[11][11]).toEqual(tiles[1]);
      expect(newState.map[12][12]).toEqual(tiles[2]);
    });

    it('should not mutate original map array', () => {
      const state = initializeFromVisible(StoreHelpers.visibleGameState());
      const originalMap = state.map;

      const tiles = [StoreHelpers.tile({ x: 10, y: 10, type: 'floor' })];
      const delta = StoreHelpers.delta.tilesReveal(tiles);

      applyDelta(state, delta);

      expect(state.map).toBe(originalMap);
      expect(state.map[10][10]).toBeNull();
    });

    it('should overwrite existing tiles', () => {
      const state = initializeFromVisible(StoreHelpers.visibleGameState());
      state.map[5][5] = StoreHelpers.tile({ x: 5, y: 5, type: 'floor' });

      const newTile = StoreHelpers.tile({ x: 5, y: 5, type: 'wall' });
      const delta = StoreHelpers.delta.tilesReveal([newTile]);

      const newState = applyDelta(state, delta);

      expect(newState.map[5][5]).toEqual(newTile);
    });
  });

  describe('applyDelta - game_status', () => {
    it('should update game status to dead', () => {
      const state = initializeFromVisible(StoreHelpers.visibleGameState());
      const delta = StoreHelpers.delta.gameStatus('dead');

      const newState = applyDelta(state, delta);

      expect(newState.status).toBe('dead');
    });

    it('should update game status to won', () => {
      const state = initializeFromVisible(StoreHelpers.visibleGameState());
      const delta = StoreHelpers.delta.gameStatus('won');

      const newState = applyDelta(state, delta);

      expect(newState.status).toBe('won');
    });

    it('should update game status back to active', () => {
      const state = initializeFromVisible(
        StoreHelpers.visibleGameState({ status: 'dead' }),
      );
      const delta = StoreHelpers.delta.gameStatus('active');

      const newState = applyDelta(state, delta);

      expect(newState.status).toBe('active');
    });
  });

  describe('applyDelta - event', () => {
    it('should return state unchanged', () => {
      const state = initializeFromVisible(StoreHelpers.visibleGameState());
      const event = StoreHelpers.event({
        id: 'event-1',
        type: 'player_moved',
        message: 'Player moved',
      });
      const delta = StoreHelpers.delta.event(event);

      const newState = applyDelta(state, delta);

      expect(newState).toBe(state);
    });
  });

  describe('applyDelta - new_floor', () => {
    it('should reinitialize entire state from VisibleGameState', () => {
      const oldState = initializeFromVisible(
        StoreHelpers.visibleGameState({ floor: 1, score: 100 }),
      );

      const newFloorVisible = StoreHelpers.visibleGameState({
        floor: 2,
        score: 150,
        player: {
          x: 3,
          y: 3,
          hp: 20,
        },
      });

      const delta = StoreHelpers.delta.newFloor(newFloorVisible);
      const newState = applyDelta(oldState, delta);

      expect(newState.floor).toBe(2);
      expect(newState.score).toBe(150);
      expect(newState.player.x).toBe(3);
      expect(newState.player.y).toBe(3);
      expect(newState.player.hp).toBe(20);
    });

    it('should clear previous enemies and items', () => {
      const enemy = StoreHelpers.enemy();
      const item = StoreHelpers.item();
      const oldState = initializeFromVisible(
        StoreHelpers.visibleGameState({
          visibleEnemies: [enemy],
          visibleItems: [item],
        }),
      );

      const newFloorVisible = StoreHelpers.visibleGameState({
        floor: 2,
        visibleEnemies: [],
        visibleItems: [],
      });

      const delta = StoreHelpers.delta.newFloor(newFloorVisible);
      const newState = applyDelta(oldState, delta);

      expect(newState.enemies.size).toBe(0);
      expect(newState.items.size).toBe(0);
    });
  });

  describe('Zustand store - initState', () => {
    it('should initialize state from VisibleGameState', () => {
      const visible = StoreHelpers.visibleGameState();

      useGameStore.getState().initState(visible);

      const state = useGameStore.getState().state;
      expect(state).not.toBeNull();
      expect(state?._id).toBe(visible._id);
      expect(state?.playerName).toBe(visible.playerName);
      expect(state?.floor).toBe(visible.floor);
    });

    it('should replace existing state', () => {
      const visible1 = StoreHelpers.visibleGameState({ floor: 1 });
      const visible2 = StoreHelpers.visibleGameState({ floor: 2 });

      useGameStore.getState().initState(visible1);
      useGameStore.getState().initState(visible2);

      const state = useGameStore.getState().state;
      expect(state?.floor).toBe(2);
    });
  });

  describe('Zustand store - applyDeltas', () => {
    it('should apply multiple deltas sequentially', () => {
      const visible = StoreHelpers.visibleGameState({
        player: { x: 5, y: 5, hp: 25 },
      });
      useGameStore.getState().initState(visible);

      const deltas = [
        StoreHelpers.delta.playerPos(6, 6, 'right'),
        StoreHelpers.delta.playerStats({ hp: 20 }),
        StoreHelpers.delta.score(50),
      ];

      useGameStore.getState().applyDeltas(deltas);

      const state = useGameStore.getState().state;
      expect(state?.player.x).toBe(6);
      expect(state?.player.y).toBe(6);
      expect(state?.player.hp).toBe(20);
      expect(state?.score).toBe(50);
    });

    it('should do nothing if state is null', () => {
      const deltas = [StoreHelpers.delta.playerPos(10, 10, 'left')];

      expect(() => {
        useGameStore.getState().applyDeltas(deltas);
      }).not.toThrow();

      expect(useGameStore.getState().state).toBeNull();
    });

    it('should handle empty deltas array', () => {
      const visible = StoreHelpers.visibleGameState();
      useGameStore.getState().initState(visible);

      const originalState = useGameStore.getState().state;

      useGameStore.getState().applyDeltas([]);

      expect(useGameStore.getState().state).toBe(originalState);
    });

    it('should apply deltas in order', () => {
      const visible = StoreHelpers.visibleGameState();
      useGameStore.getState().initState(visible);

      // Move right, then reveal enemy, then damage enemy
      const enemy = StoreHelpers.enemy({ id: 'enemy-1', hp: 20 });
      const deltas = [
        StoreHelpers.delta.playerPos(6, 5, 'right'),
        StoreHelpers.delta.enemyVisible(enemy),
        StoreHelpers.delta.enemyDamaged('enemy-1', 15),
      ];

      useGameStore.getState().applyDeltas(deltas);

      const state = useGameStore.getState().state;
      expect(state?.player.x).toBe(6);
      expect(state?.enemies.get('enemy-1')?.hp).toBe(15);
    });
  });

  describe('Zustand store - addEvents', () => {
    it('should prepend new events to events array', () => {
      const event1: GameEvent = {
        id: 'event-1',
        type: 'player_moved',
        message: 'Moved',
      };
      const event2: GameEvent = {
        id: 'event-2',
        type: 'player_attacked',
        message: 'Attacked',
      };

      useGameStore.getState().addEvents([event1]);
      useGameStore.getState().addEvents([event2]);

      const events = useGameStore.getState().events;
      expect(events).toHaveLength(2);
      expect(events[0]).toEqual(event2);
      expect(events[1]).toEqual(event1);
    });

    it('should limit events to 30', () => {
      const events: GameEvent[] = Array.from({ length: 35 }, (_, i) => ({
        id: `event-${i}`,
        type: 'player_moved',
        message: `Event ${i}`,
      }));

      useGameStore.getState().addEvents(events);

      const storedEvents = useGameStore.getState().events;
      expect(storedEvents).toHaveLength(30);
    });

    it('should keep most recent 30 events', () => {
      // Add 20 old events
      const oldEvents: GameEvent[] = Array.from({ length: 20 }, (_, i) => ({
        id: `old-${i}`,
        type: 'player_moved',
        message: `Old ${i}`,
      }));
      useGameStore.getState().addEvents(oldEvents);

      // Add 15 new events
      const newEvents: GameEvent[] = Array.from({ length: 15 }, (_, i) => ({
        id: `new-${i}`,
        type: 'player_attacked',
        message: `New ${i}`,
      }));
      useGameStore.getState().addEvents(newEvents);

      const storedEvents = useGameStore.getState().events;
      expect(storedEvents).toHaveLength(30);
      // Should have all 15 new events
      expect(storedEvents.filter((e) => e.id.startsWith('new-'))).toHaveLength(
        15,
      );
      // Should have 15 most recent old events
      expect(storedEvents.filter((e) => e.id.startsWith('old-'))).toHaveLength(
        15,
      );
    });

    it('should handle empty events array', () => {
      const event: GameEvent = {
        id: 'event-1',
        type: 'player_moved',
        message: 'Moved',
      };
      useGameStore.getState().addEvents([event]);

      useGameStore.getState().addEvents([]);

      expect(useGameStore.getState().events).toHaveLength(1);
    });
  });

  describe('Zustand store - connection state', () => {
    it('should update connected state', () => {
      useGameStore.getState().setConnected(true);
      expect(useGameStore.getState().connected).toBe(true);

      useGameStore.getState().setConnected(false);
      expect(useGameStore.getState().connected).toBe(false);
    });

    it('should update reconnecting state', () => {
      useGameStore.getState().setReconnecting(true);
      expect(useGameStore.getState().reconnecting).toBe(true);

      useGameStore.getState().setReconnecting(false);
      expect(useGameStore.getState().reconnecting).toBe(false);
    });

    it('should update reconnect attempt number', () => {
      useGameStore.getState().setReconnectAttempt(3);
      expect(useGameStore.getState().reconnectAttempt).toBe(3);

      useGameStore.getState().setReconnectAttempt(0);
      expect(useGameStore.getState().reconnectAttempt).toBe(0);
    });

    it('should update error state', () => {
      useGameStore.getState().setError('Connection failed');
      expect(useGameStore.getState().error).toBe('Connection failed');

      useGameStore.getState().setError(null);
      expect(useGameStore.getState().error).toBeNull();
    });
  });

  describe('Zustand store - setDamagedEntities', () => {
    it('should update damaged entities array', () => {
      useGameStore.getState().setDamagedEntities(['enemy-1', 'enemy-2']);

      expect(useGameStore.getState().damagedEntities).toEqual([
        'enemy-1',
        'enemy-2',
      ]);
    });

    it('should replace previous damaged entities', () => {
      useGameStore.getState().setDamagedEntities(['enemy-1']);
      useGameStore.getState().setDamagedEntities(['enemy-2', 'enemy-3']);

      expect(useGameStore.getState().damagedEntities).toEqual([
        'enemy-2',
        'enemy-3',
      ]);
    });

    it('should handle empty array', () => {
      useGameStore.getState().setDamagedEntities(['enemy-1']);
      useGameStore.getState().setDamagedEntities([]);

      expect(useGameStore.getState().damagedEntities).toEqual([]);
    });
  });

  describe('Zustand store - reset', () => {
    it('should clear all state', () => {
      // Set up some state
      const visible = StoreHelpers.visibleGameState();
      useGameStore.getState().initState(visible);
      useGameStore
        .getState()
        .addEvents([{ id: 'event-1', type: 'player_moved', message: 'Moved' }]);
      useGameStore.getState().setConnected(true);
      useGameStore.getState().setReconnecting(true);
      useGameStore.getState().setReconnectAttempt(5);
      useGameStore.getState().setError('Test error');
      useGameStore.getState().setDamagedEntities(['enemy-1']);

      // Reset
      useGameStore.getState().reset();

      // Verify all state is cleared
      const state = useGameStore.getState();
      expect(state.state).toBeNull();
      expect(state.events).toEqual([]);
      expect(state.connected).toBe(false);
      expect(state.reconnecting).toBe(false);
      expect(state.reconnectAttempt).toBe(0);
      expect(state.error).toBeNull();
      expect(state.damagedEntities).toEqual([]);
    });

    it('should allow reinitializing after reset', () => {
      const visible1 = StoreHelpers.visibleGameState({ floor: 1 });
      useGameStore.getState().initState(visible1);
      useGameStore.getState().reset();

      const visible2 = StoreHelpers.visibleGameState({ floor: 2 });
      useGameStore.getState().initState(visible2);

      expect(useGameStore.getState().state?.floor).toBe(2);
    });
  });

  describe('Integration - complex delta sequences', () => {
    it('should handle combat sequence', () => {
      const visible = StoreHelpers.visibleGameState({
        player: { x: 5, y: 5, hp: 25 },
      });
      useGameStore.getState().initState(visible);

      const enemy = StoreHelpers.enemy({ id: 'enemy-1', hp: 20, x: 6, y: 5 });

      const combatDeltas = [
        StoreHelpers.delta.enemyVisible(enemy),
        StoreHelpers.delta.playerPos(6, 5, 'right'), // Move to enemy
        StoreHelpers.delta.enemyDamaged('enemy-1', 15), // Damage enemy
        StoreHelpers.delta.playerStats({ hp: 22 }), // Take damage
        StoreHelpers.delta.enemyDamaged('enemy-1', 10), // Damage again
        StoreHelpers.delta.playerStats({ hp: 19 }), // Take more damage
        StoreHelpers.delta.enemyDamaged('enemy-1', 0), // Enemy at 0 hp
        StoreHelpers.delta.enemyKilled('enemy-1'), // Enemy dies
        StoreHelpers.delta.score(50), // Gain score
        StoreHelpers.delta.playerStats({ xp: 25 }), // Gain XP
      ];

      useGameStore.getState().applyDeltas(combatDeltas);

      const state = useGameStore.getState().state;
      expect(state?.player.hp).toBe(19);
      expect(state?.player.xp).toBe(25);
      expect(state?.score).toBe(50);
      expect(state?.enemies.size).toBe(0);
    });

    it('should handle exploration sequence', () => {
      const visible = StoreHelpers.visibleGameState();
      useGameStore.getState().initState(visible);

      const explorationDeltas = [
        StoreHelpers.delta.playerPos(6, 5, 'right'),
        StoreHelpers.delta.fogReveal([
          [7, 5],
          [8, 5],
          [9, 5],
        ]),
        StoreHelpers.delta.tilesReveal([
          StoreHelpers.tile({ x: 7, y: 5, type: 'floor' }),
          StoreHelpers.tile({ x: 8, y: 5, type: 'wall' }),
        ]),
        StoreHelpers.delta.itemVisible(
          StoreHelpers.item({ id: 'item-1', x: 7, y: 5 }),
        ),
        StoreHelpers.delta.playerPos(7, 5, 'right'),
        StoreHelpers.delta.itemRemoved('item-1'),
        StoreHelpers.delta.playerStats({ hp: 30, maxHp: 30 }), // Picked up health potion
      ];

      useGameStore.getState().applyDeltas(explorationDeltas);

      const state = useGameStore.getState().state;
      expect(state?.player.x).toBe(7);
      expect(state?.player.hp).toBe(30);
      expect(state?.fog[5][7]).toBe(true);
      expect(state?.fog[5][8]).toBe(true);
      expect(state?.items.size).toBe(0);
    });

    it('should handle floor transition', () => {
      const visible1 = StoreHelpers.visibleGameState({ floor: 1, score: 100 });
      useGameStore.getState().initState(visible1);

      const enemy = StoreHelpers.enemy({ id: 'floor1-enemy' });
      useGameStore
        .getState()
        .applyDeltas([StoreHelpers.delta.enemyVisible(enemy)]);

      expect(useGameStore.getState().state?.enemies.size).toBe(1);

      // New floor should reset everything
      const visible2 = StoreHelpers.visibleGameState({
        floor: 2,
        score: 150,
        player: { x: 3, y: 3 },
      });

      useGameStore
        .getState()
        .applyDeltas([StoreHelpers.delta.newFloor(visible2)]);

      const state = useGameStore.getState().state;
      expect(state?.floor).toBe(2);
      expect(state?.score).toBe(150);
      expect(state?.enemies.size).toBe(0);
      expect(state?.player.x).toBe(3);
    });
  });
});
