import { randomUUID } from 'node:crypto';
import {
  type CharacterType,
  type Coordinate,
  createEnemy,
  type Enemy,
  type EnemyType,
  type EquipmentItem,
  getEquipmentForFloor,
  type Item,
  MAP_HEIGHT,
  MAP_WIDTH,
  type Tile,
} from '@dungeon-crawler/shared';

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

interface Room {
  x: number;
  y: number;
  width: number;
  height: number;
}

function roomsOverlap(a: Room, b: Room): boolean {
  return (
    a.x < b.x + b.width + 1 &&
    a.x + a.width + 1 > b.x &&
    a.y < b.y + b.height + 1 &&
    a.y + a.height + 1 > b.y
  );
}

export function generateMap(
  floor: number,
  character: CharacterType = 'dwarf',
): {
  map: Tile[][];
  playerStart: Coordinate;
  enemies: Enemy[];
  items: Item[];
} {
  // Initialize map with walls
  const map: Tile[][] = [];
  for (let y = 0; y < MAP_HEIGHT; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < MAP_WIDTH; x++) {
      row.push({ type: 'wall', x, y });
    }
    map.push(row);
  }

  // Generate rooms
  const rooms: Room[] = [];
  const numRooms = randomInt(5, 8);

  for (let i = 0; i < 100 && rooms.length < numRooms; i++) {
    const room: Room = {
      x: randomInt(1, MAP_WIDTH - 10),
      y: randomInt(1, MAP_HEIGHT - 8),
      width: randomInt(4, 8),
      height: randomInt(4, 6),
    };

    if (room.x + room.width >= MAP_WIDTH - 1) continue;
    if (room.y + room.height >= MAP_HEIGHT - 1) continue;

    const overlaps = rooms.some((r) => roomsOverlap(room, r));
    if (!overlaps) {
      rooms.push(room);
    }
  }

  // Carve out rooms
  for (const room of rooms) {
    for (let y = room.y; y < room.y + room.height; y++) {
      for (let x = room.x; x < room.x + room.width; x++) {
        map[y][x] = { type: 'floor', x, y };
      }
    }
  }

  // Helper function to carve a corridor between two points
  function carveCorridor(x1: number, y1: number, x2: number, y2: number) {
    // Horizontal then vertical
    for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) {
      map[y1][x] = { type: 'floor', x, y: y1 };
    }
    for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) {
      map[y][x2] = { type: 'floor', x: x2, y };
    }
  }

  // Sort rooms by position (left to right, top to bottom) for better connectivity
  rooms.sort((a, b) => {
    const aCenterX = a.x + a.width / 2;
    const bCenterX = b.x + b.width / 2;
    const aCenterY = a.y + a.height / 2;
    const bCenterY = b.y + b.height / 2;
    return aCenterX + aCenterY * 0.5 - (bCenterX + bCenterY * 0.5);
  });

  // Connect rooms with corridors
  for (let i = 1; i < rooms.length; i++) {
    const prev = rooms[i - 1];
    const curr = rooms[i];

    const prevCenterX = Math.floor(prev.x + prev.width / 2);
    const prevCenterY = Math.floor(prev.y + prev.height / 2);
    const currCenterX = Math.floor(curr.x + curr.width / 2);
    const currCenterY = Math.floor(curr.y + curr.height / 2);

    carveCorridor(prevCenterX, prevCenterY, currCenterX, currCenterY);
  }

  // Also connect first room to last room directly to ensure path to stairs
  if (rooms.length >= 2) {
    const first = rooms[0];
    const last = rooms[rooms.length - 1];
    const firstCenterX = Math.floor(first.x + first.width / 2);
    const firstCenterY = Math.floor(first.y + first.height / 2);
    const lastCenterX = Math.floor(last.x + last.width / 2);
    const lastCenterY = Math.floor(last.y + last.height / 2);

    carveCorridor(firstCenterX, firstCenterY, lastCenterX, lastCenterY);
  }

  // Place stairs in last room
  const lastRoom = rooms[rooms.length - 1];
  const stairsX = Math.floor(lastRoom.x + lastRoom.width / 2);
  const stairsY = Math.floor(lastRoom.y + lastRoom.height / 2);
  map[stairsY][stairsX] = { type: 'stairs', x: stairsX, y: stairsY };

  // Player starts in first room
  const firstRoom = rooms[0];
  const playerStart = {
    x: Math.floor(firstRoom.x + firstRoom.width / 2),
    y: Math.floor(firstRoom.y + firstRoom.height / 2),
  };

  // Generate enemies (more on deeper floors)
  const enemies: Enemy[] = [];
  const numEnemies = randomInt(3, 5) + Math.floor(floor / 2);

  const enemyTypes: EnemyType[] = ['rat', 'skeleton', 'orc', 'dragon'];
  const availableTypes = enemyTypes.slice(
    0,
    Math.min(1 + Math.floor(floor / 3), 4),
  );

  for (let i = 0; i < numEnemies && rooms.length > 1; i++) {
    const roomIndex = randomInt(1, rooms.length - 1); // Skip first room (player spawn)
    const room = rooms[roomIndex];
    const x = randomInt(room.x, room.x + room.width - 1);
    const y = randomInt(room.y, room.y + room.height - 1);

    const type = availableTypes[randomInt(0, availableTypes.length - 1)];
    enemies.push(createEnemy(randomUUID(), type, x, y, floor));
  }

  // Generate items (health potions)
  const items: Item[] = [];
  const numPotions = randomInt(1, 3);

  for (let i = 0; i < numPotions; i++) {
    const roomIndex = randomInt(0, rooms.length - 1);
    const room = rooms[roomIndex];
    const x = randomInt(room.x, room.x + room.width - 1);
    const y = randomInt(room.y, room.y + room.height - 1);

    items.push({
      id: randomUUID(),
      type: 'health_potion',
      name: 'Health Potion',
      x,
      y,
      value: 10,
    });
  }

  // Generate equipment (1-2 per floor, better gear on deeper floors)
  // Filter ranged weapons based on character type
  const allEquipment = getEquipmentForFloor(floor);
  const availableEquipment = allEquipment.filter((e) => {
    if (e.slot !== 'ranged') return true; // Non-ranged equipment available to all
    // Character-specific ranged weapons
    switch (character) {
      case 'wizard':
        return e.id.includes('staff');
      case 'bandit':
        return e.id.includes('crossbow');
      case 'elf':
      case 'dwarf':
        return e.id.includes('dagger');
      default:
        return true;
    }
  });
  const numEquipment = randomInt(1, 2);

  for (let i = 0; i < numEquipment && availableEquipment.length > 0; i++) {
    const roomIndex = randomInt(0, rooms.length - 1);
    const room = rooms[roomIndex];
    const x = randomInt(room.x, room.x + room.width - 1);
    const y = randomInt(room.y, room.y + room.height - 1);

    // Pick a random equipment from available pool
    const equipment =
      availableEquipment[randomInt(0, availableEquipment.length - 1)];

    const equipmentItem: EquipmentItem = {
      id: randomUUID(),
      type: 'equipment',
      name: equipment.name,
      x,
      y,
      value: 0,
      equipment, // Keep original equipment ID for sprite lookup
    };

    items.push(equipmentItem);
  }

  return { map, playerStart, enemies, items };
}

export function initializeFog(): boolean[][] {
  const fog: boolean[][] = [];
  for (let y = 0; y < MAP_HEIGHT; y++) {
    const row: boolean[] = [];
    for (let x = 0; x < MAP_WIDTH; x++) {
      row.push(false);
    }
    fog.push(row);
  }
  return fog;
}
