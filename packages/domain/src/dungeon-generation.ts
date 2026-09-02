import { createEnemy } from './enemies.js';
import {
  type CharacterType,
  type Coordinate,
  type Enemy,
  type EnemyType,
  type EquipmentItem,
  getEquipmentForFloor,
  type Item,
  MAP_HEIGHT,
  MAP_WIDTH,
  type Tile,
} from './model.js';
import type { RandomSource } from './random.js';

interface Room {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GeneratedDungeon {
  map: Tile[][];
  playerStart: Coordinate;
  enemies: Enemy[];
  items: Item[];
}

function roomsOverlap(a: Room, b: Room): boolean {
  return (
    a.x < b.x + b.width + 1 &&
    a.x + a.width + 1 > b.x &&
    a.y < b.y + b.height + 1 &&
    a.y + a.height + 1 > b.y
  );
}

function coordinateKey(coordinate: Coordinate): string {
  return `${coordinate.x},${coordinate.y}`;
}

function roomCoordinates(rooms: Room[]): Coordinate[] {
  return rooms.flatMap((room) =>
    Array.from({ length: room.height }, (_, yOffset) =>
      Array.from({ length: room.width }, (_, xOffset) => ({
        x: room.x + xOffset,
        y: room.y + yOffset,
      })),
    ).flat(),
  );
}

export function takeUnoccupiedCoordinate(
  candidates: readonly Coordinate[],
  occupied: Set<string>,
  random: RandomSource,
): Coordinate | undefined {
  const eligible = candidates.filter(
    (coordinate) => !occupied.has(coordinateKey(coordinate)),
  );
  if (eligible.length === 0) return undefined;

  const selected = eligible[random.integer(0, eligible.length - 1)];
  occupied.add(coordinateKey(selected));
  return selected;
}

export function generateDungeon(
  floor: number,
  character: CharacterType,
  random: RandomSource,
): GeneratedDungeon {
  const map: Tile[][] = Array.from({ length: MAP_HEIGHT }, (_, y) =>
    Array.from({ length: MAP_WIDTH }, (_, x) => ({ type: 'wall', x, y })),
  );

  const rooms: Room[] = [];
  const roomCount = random.integer(5, 8);
  for (let attempt = 0; attempt < 100 && rooms.length < roomCount; attempt++) {
    const room: Room = {
      x: random.integer(1, MAP_WIDTH - 10),
      y: random.integer(1, MAP_HEIGHT - 8),
      width: random.integer(4, 8),
      height: random.integer(4, 6),
    };
    if (room.x + room.width >= MAP_WIDTH - 1) continue;
    if (room.y + room.height >= MAP_HEIGHT - 1) continue;
    if (!rooms.some((existing) => roomsOverlap(room, existing)))
      rooms.push(room);
  }

  if (rooms.length === 0) {
    rooms.push({ x: 2, y: 2, width: 6, height: 5 });
  }

  for (const room of rooms) {
    for (let y = room.y; y < room.y + room.height; y++) {
      for (let x = room.x; x < room.x + room.width; x++) {
        map[y][x] = { type: 'floor', x, y };
      }
    }
  }

  const carveCorridor = (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
  ): void => {
    for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) {
      map[y1][x] = { type: 'floor', x, y: y1 };
    }
    for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) {
      map[y][x2] = { type: 'floor', x: x2, y };
    }
  };

  rooms.sort((a, b) => {
    const aOrder = a.x + a.width / 2 + (a.y + a.height / 2) * 0.5;
    const bOrder = b.x + b.width / 2 + (b.y + b.height / 2) * 0.5;
    return aOrder - bOrder;
  });

  const center = (room: Room): Coordinate => ({
    x: Math.floor(room.x + room.width / 2),
    y: Math.floor(room.y + room.height / 2),
  });

  for (let index = 1; index < rooms.length; index++) {
    const previous = center(rooms[index - 1]);
    const current = center(rooms[index]);
    carveCorridor(previous.x, previous.y, current.x, current.y);
  }

  if (rooms.length >= 2) {
    const first = center(rooms[0]);
    const last = center(rooms[rooms.length - 1]);
    carveCorridor(first.x, first.y, last.x, last.y);
  }

  const playerStart = center(rooms[0]);
  const occupied = new Set<string>([coordinateKey(playerStart)]);
  const preferredStairs = center(rooms[rooms.length - 1]);
  const stairs =
    takeUnoccupiedCoordinate([preferredStairs], occupied, random) ??
    takeUnoccupiedCoordinate(roomCoordinates(rooms), occupied, random);
  if (!stairs) {
    throw new Error('Generated dungeon has no distinct coordinate for stairs');
  }
  map[stairs.y][stairs.x] = { type: 'stairs', x: stairs.x, y: stairs.y };

  const enemyTypes: EnemyType[] = ['rat', 'skeleton', 'orc', 'dragon'];
  const availableTypes = enemyTypes.slice(
    0,
    Math.min(1 + Math.floor(floor / 3), enemyTypes.length),
  );
  const enemies: Enemy[] = [];
  const enemyCount = random.integer(3, 5) + Math.floor(floor / 2);
  const enemyCoordinates = roomCoordinates(rooms.slice(1));
  for (let index = 0; index < enemyCount && rooms.length > 1; index++) {
    const coordinate = takeUnoccupiedCoordinate(
      enemyCoordinates,
      occupied,
      random,
    );
    if (!coordinate) break;
    const type = availableTypes[random.integer(0, availableTypes.length - 1)];
    enemies.push(
      createEnemy(
        random.id('enemy'),
        type,
        coordinate.x,
        coordinate.y,
        floor,
        random,
      ),
    );
  }

  const items: Item[] = [];
  const itemCoordinates = roomCoordinates(rooms);
  const potionCount = random.integer(1, 3);
  for (let index = 0; index < potionCount; index++) {
    const coordinate = takeUnoccupiedCoordinate(
      itemCoordinates,
      occupied,
      random,
    );
    if (!coordinate) break;
    items.push({
      id: random.id('item'),
      type: 'health_potion',
      name: 'Health Potion',
      x: coordinate.x,
      y: coordinate.y,
      value: 10,
    });
  }

  const availableEquipment = getEquipmentForFloor(floor).filter((equipment) => {
    if (equipment.slot !== 'ranged') return true;
    if (character === 'wizard') return equipment.id.includes('staff');
    if (character === 'bandit') return equipment.id.includes('crossbow');
    return equipment.id.includes('dagger');
  });

  const equipmentCount = random.integer(1, 2);
  for (
    let index = 0;
    index < equipmentCount && availableEquipment.length > 0;
    index++
  ) {
    const coordinate = takeUnoccupiedCoordinate(
      itemCoordinates,
      occupied,
      random,
    );
    if (!coordinate) break;
    const equipment =
      availableEquipment[random.integer(0, availableEquipment.length - 1)];
    const item: EquipmentItem = {
      id: random.id('item'),
      type: 'equipment',
      name: equipment.name,
      x: coordinate.x,
      y: coordinate.y,
      value: 0,
      equipment,
    };
    items.push(item);
  }

  return { map, playerStart, enemies, items };
}

export function createVisibilityMask(
  width = MAP_WIDTH,
  height = MAP_HEIGHT,
): boolean[][] {
  return Array.from({ length: height }, () =>
    Array.from({ length: width }, () => false),
  );
}
