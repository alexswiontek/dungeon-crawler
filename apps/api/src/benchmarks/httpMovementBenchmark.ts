import { performance } from 'node:perf_hooks';
import {
  GAMEPLAY_PROTOCOL_HEADER,
  GAMEPLAY_PROTOCOL_VERSION,
  type GameCommandResult,
  GameCommandResultSchema,
  type NewGameResponse,
  NewGameResponseSchema,
  type VisibleGameState,
} from '@dungeon-crawler/protocol';

const apiUrl = (
  process.env.BENCHMARK_API_URL ?? 'http://127.0.0.1:3000'
).replace(/\/$/, '');
const requestedSamples = Number(process.env.BENCHMARK_MOVEMENTS ?? 20);

if (!Number.isInteger(requestedSamples) || requestedSamples < 1) {
  throw new Error('BENCHMARK_MOVEMENTS must be a positive integer');
}

interface DirectionCandidate {
  direction: 'up' | 'down' | 'left' | 'right';
  reverse: 'up' | 'down' | 'left' | 'right';
  x: number;
  y: number;
}

const candidates: DirectionCandidate[] = [
  { direction: 'up', reverse: 'down', x: 0, y: -1 },
  { direction: 'down', reverse: 'up', x: 0, y: 1 },
  { direction: 'left', reverse: 'right', x: -1, y: 0 },
  { direction: 'right', reverse: 'left', x: 1, y: 0 },
];

function headers(token?: string): HeadersInit {
  return {
    [GAMEPLAY_PROTOCOL_HEADER]: GAMEPLAY_PROTOCOL_VERSION,
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function createBenchmarkGame(): Promise<NewGameResponse> {
  const response = await fetch(`${apiUrl}/games`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      playerName: `Benchmark-${Date.now().toString(36)}`,
      character: 'dwarf',
    }),
  });
  if (!response.ok)
    throw new Error(`Game creation failed with HTTP ${response.status}`);
  return NewGameResponseSchema.parse(await response.json());
}

function findOpenPair(state: VisibleGameState): DirectionCandidate {
  const occupied = new Set(
    state.visibleEnemies.map((enemy) => `${enemy.x}:${enemy.y}`),
  );
  const tile = new Map(
    state.visibleTiles.map((candidate) => [
      `${candidate.x}:${candidate.y}`,
      candidate,
    ]),
  );
  const candidate = candidates.find(({ x, y }) => {
    const targetX = state.player.x + x;
    const targetY = state.player.y + y;
    const target = tile.get(`${targetX}:${targetY}`);
    return (
      target && target.type !== 'wall' && !occupied.has(`${targetX}:${targetY}`)
    );
  });
  if (!candidate)
    throw new Error(
      'No known open adjacent tile is available for the benchmark',
    );
  return candidate;
}

async function sendMovement(
  created: NewGameResponse,
  revision: number,
  direction: DirectionCandidate['direction'],
  actionId: string,
): Promise<{ result: GameCommandResult; durationMs: number; retries: number }> {
  const body = JSON.stringify({
    actionId,
    expectedRevision: revision,
    command: { type: 'move', direction },
  });
  let retries = 0;
  for (;;) {
    const startedAt = performance.now();
    try {
      const response = await fetch(
        `${apiUrl}/games/${encodeURIComponent(created.gameId)}/actions`,
        {
          method: 'POST',
          headers: headers(created.sessionToken),
          body,
        },
      );
      const durationMs = performance.now() - startedAt;
      if (!response.ok)
        throw new Error(`Movement failed with HTTP ${response.status}`);
      return {
        result: GameCommandResultSchema.parse(await response.json()),
        durationMs,
        retries,
      };
    } catch (error) {
      if (retries >= 1) throw error;
      retries += 1;
    }
  }
}

function percentile(sorted: number[], ratio: number): number {
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)] ?? 0;
}

const created = await createBenchmarkGame();
let state = created.state;
let revision = created.revision;
let pair = findOpenPair(state);
let direction = pair.direction;
const durations: number[] = [];
let retryCount = 0;
let errorCount = 0;
let rejectedCount = 0;

for (
  let attempts = 0;
  durations.length < requestedSamples && attempts < requestedSamples * 5;
  attempts++
) {
  try {
    const response = await sendMovement(
      created,
      revision,
      direction,
      crypto.randomUUID(),
    );
    retryCount += response.retries;
    revision = response.result.revision;
    state = response.result.state;
    if (response.result.events.some((event) => event.type === 'player_moved')) {
      durations.push(response.durationMs);
      direction = direction === pair.direction ? pair.reverse : pair.direction;
    } else {
      rejectedCount += 1;
      pair = findOpenPair(state);
      direction = pair.direction;
    }
    if (state.status !== 'active')
      throw new Error('Benchmark game reached a terminal state');
  } catch (error) {
    errorCount += 1;
    if (errorCount >= 3) throw error;
  }
}

if (durations.length < requestedSamples) {
  throw new Error(
    `Collected only ${durations.length} valid movements out of ${requestedSamples}`,
  );
}

const sorted = [...durations].sort((left, right) => left - right);
const median = percentile(sorted, 0.5);
const p95 = percentile(sorted, 0.95);
const maximum = sorted.at(-1) ?? 0;
const metTarget = p95 <= 50;

console.info(
  JSON.stringify(
    {
      samples: durations.length,
      medianMs: Number(median.toFixed(2)),
      p95Ms: Number(p95.toFixed(2)),
      maximumMs: Number(maximum.toFixed(2)),
      errorCount,
      retryCount,
      rejectedInputCount: rejectedCount,
      queueDepth: 0,
      target: { p95Ms: 50, met: metTarget },
    },
    null,
    2,
  ),
);

if (!metTarget) process.exitCode = 1;
