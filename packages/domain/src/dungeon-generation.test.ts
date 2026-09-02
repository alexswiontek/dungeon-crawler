import { describe, expect, it } from 'vitest';
import {
  generateDungeon,
  takeUnoccupiedCoordinate,
} from './dungeon-generation.js';
import {
  type CharacterType,
  type Coordinate,
  MAP_HEIGHT,
  MAP_WIDTH,
  type Tile,
} from './model.js';
import {
  createSeededRandom,
  type RandomSource,
  type StatefulRandomSource,
} from './random.js';

const CHARACTERS: CharacterType[] = ['dwarf', 'elf', 'bandit', 'wizard'];
const FLOORS = [1, 5, 10, 19];

function key(coordinate: Coordinate): string {
  return `${coordinate.x},${coordinate.y}`;
}

function findStairs(map: Tile[][]): Coordinate {
  for (const row of map) {
    const stairs = row.find((tile) => tile.type === 'stairs');
    if (stairs) return { x: stairs.x, y: stairs.y };
  }
  throw new Error('Expected generated stairs');
}

function canReach(
  map: Tile[][],
  start: Coordinate,
  target: Coordinate,
): boolean {
  const queue = [start];
  const visited = new Set([key(start)]);
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index];
    if (current.x === target.x && current.y === target.y) return true;
    for (const offset of [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
    ]) {
      const next = { x: current.x + offset.x, y: current.y + offset.y };
      if (map[next.y]?.[next.x]?.type === 'wall' || visited.has(key(next))) {
        continue;
      }
      visited.add(key(next));
      queue.push(next);
    }
  }
  return false;
}

class RecordingRandomSource implements StatefulRandomSource {
  enemyBaseCount: number | undefined;
  potionCount: number | undefined;
  equipmentCount: number | undefined;

  constructor(private readonly delegate: StatefulRandomSource) {}

  next(): number {
    return this.delegate.next();
  }

  integer(min: number, max: number): number {
    const value = this.delegate.integer(min, max);
    if (min === 3 && max === 5) this.enemyBaseCount = value;
    if (min === 1 && max === 3) this.potionCount = value;
    if (min === 1 && max === 2) this.equipmentCount = value;
    return value;
  }

  id(prefix?: string): string {
    return this.delegate.id(prefix);
  }

  snapshot() {
    return this.delegate.snapshot();
  }
}

describe('dungeon generation', () => {
  it('places every generated occupant on a unique valid coordinate across many seeds', () => {
    for (const character of CHARACTERS) {
      for (const floor of FLOORS) {
        for (let seed = 0; seed < 20; seed++) {
          const dungeon = generateDungeon(
            floor,
            character,
            createSeededRandom(`${character}-${floor}-${seed}`),
          );
          const stairs = findStairs(dungeon.map);
          const occupants = [
            dungeon.playerStart,
            stairs,
            ...dungeon.enemies,
            ...dungeon.items,
          ];

          expect(new Set(occupants.map(key))).toHaveLength(occupants.length);
          expect(dungeon.map).toHaveLength(MAP_HEIGHT);
          expect(dungeon.map.every((row) => row.length === MAP_WIDTH)).toBe(
            true,
          );
          expect(
            dungeon.map[dungeon.playerStart.y][dungeon.playerStart.x].type,
          ).toBe('floor');
          for (const entity of [...dungeon.enemies, ...dungeon.items]) {
            expect(dungeon.map[entity.y][entity.x].type).toBe('floor');
          }
          expect(canReach(dungeon.map, dungeon.playerStart, stairs)).toBe(true);
        }
      }
    }
  });

  it('preserves each requested spawn count when eligible room cells are available', () => {
    for (let seed = 0; seed < 20; seed++) {
      const floor = 10;
      const random = new RecordingRandomSource(
        createSeededRandom(`requested-counts-${seed}`),
      );
      const dungeon = generateDungeon(floor, 'wizard', random);

      expect(dungeon.enemies).toHaveLength(
        (random.enemyBaseCount ?? 0) + Math.floor(floor / 2),
      );
      expect(
        dungeon.items.filter((item) => item.type === 'health_potion'),
      ).toHaveLength(random.potionCount ?? 0);
      expect(
        dungeon.items.filter((item) => item.type === 'equipment'),
      ).toHaveLength(random.equipmentCount ?? 0);
    }
  });

  it('produces equal dungeons, IDs, and final RNG snapshots for equal inputs', () => {
    for (const character of CHARACTERS) {
      const firstRandom = createSeededRandom(`deterministic-${character}`);
      const secondRandom = createSeededRandom(`deterministic-${character}`);
      const first = generateDungeon(12, character, firstRandom);
      const second = generateDungeon(12, character, secondRandom);

      expect(second).toEqual(first);
      expect(second.enemies.map((enemy) => enemy.id)).toEqual(
        first.enemies.map((enemy) => enemy.id),
      );
      expect(second.items.map((item) => item.id)).toEqual(
        first.items.map((item) => item.id),
      );
      expect(secondRandom.snapshot()).toEqual(firstRandom.snapshot());
    }
  });

  it('continues the same random and deterministic ID sequence from a stored cursor', () => {
    const uninterrupted = createSeededRandom('stored-seed');
    uninterrupted.next();
    uninterrupted.id('event');
    const stored = uninterrupted.snapshot();
    const expected = [
      uninterrupted.integer(1, 100),
      uninterrupted.id('enemy'),
      uninterrupted.next(),
    ];
    const restored = createSeededRandom('stored-seed', stored);

    expect([
      restored.integer(1, 100),
      restored.id('enemy'),
      restored.next(),
    ]).toEqual(expected);
    expect(restored.snapshot()).toEqual(uninterrupted.snapshot());
  });

  it('stops safely when a synthetic reachable map has fewer free cells than requested', () => {
    const map: Tile[][] = [
      Array.from({ length: 6 }, (_, x) => ({ type: 'wall', x, y: 0 })),
      [
        { type: 'wall', x: 0, y: 1 },
        { type: 'floor', x: 1, y: 1 },
        { type: 'floor', x: 2, y: 1 },
        { type: 'floor', x: 3, y: 1 },
        { type: 'stairs', x: 4, y: 1 },
        { type: 'wall', x: 5, y: 1 },
      ],
      Array.from({ length: 6 }, (_, x) => ({ type: 'wall', x, y: 2 })),
    ];
    const candidates = map.flat().filter((tile) => tile.type !== 'wall');
    const occupied = new Set(['1,1', '4,1']);
    const random: RandomSource = createSeededRandom('scarce-map');
    const selected = Array.from({ length: 5 }, () =>
      takeUnoccupiedCoordinate(candidates, occupied, random),
    ).filter(
      (coordinate): coordinate is Coordinate => coordinate !== undefined,
    );

    expect(selected).toHaveLength(2);
    expect(new Set(selected.map(key))).toHaveLength(2);
    expect(canReach(map, { x: 1, y: 1 }, { x: 4, y: 1 })).toBe(true);
  });
});
