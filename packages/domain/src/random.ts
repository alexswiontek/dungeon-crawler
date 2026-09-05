export interface RandomSource {
  next(): number;
  integer(min: number, max: number): number;
  id(prefix?: string): string;
}

export interface SeededRandomState {
  state: number;
  idSequence: number;
}

export interface StatefulRandomSource extends RandomSource {
  snapshot(): SeededRandomState;
}

function hashSeed(seed: number | string): number {
  if (typeof seed === 'number') return seed >>> 0 || 0x6d2b79f5;

  let hash = 2166136261;
  for (let index = 0; index < seed.length; index++) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0 || 0x6d2b79f5;
}

export function createSeededRandom(
  seed: number | string,
  restoredState?: SeededRandomState,
): StatefulRandomSource {
  let state = restoredState?.state ?? hashSeed(seed);
  let idSequence = restoredState?.idSequence ?? 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    integer(min: number, max: number): number {
      if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
        throw new RangeError(`Invalid random integer range: ${min}..${max}`);
      }
      return Math.floor(next() * (max - min + 1)) + min;
    },
    id(prefix = 'id'): string {
      idSequence += 1;
      const randomPart = Math.floor(next() * 0xffffffff)
        .toString(16)
        .padStart(8, '0');
      return `${prefix}-${randomPart}-${idSequence.toString(16)}`;
    },
    snapshot(): SeededRandomState {
      return { state, idSequence };
    },
  };
}

export interface GameClock {
  now(): Date;
}

export interface GameCommandContext {
  clock: GameClock;
  random: RandomSource;
}

export function fixedClock(value: Date | string): GameClock {
  const timestamp = new Date(value);
  return {
    now: () => new Date(timestamp),
  };
}
