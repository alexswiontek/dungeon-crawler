import { on, once } from 'node:events';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { GAME_WEBSOCKET_CLIENT_QUEUE_LIMIT, GameCommandResultSchema, GAMEPLAY_PROTOCOL_HEADER, GAMEPLAY_PROTOCOL_VERSION, GameWebSocketServerMessageSchema, NewGameResponseSchema } from '@dungeon-crawler/protocol/schemas';
import WebSocket from 'ws';

const mode = process.argv[2];
const apiUrl = new URL(
  process.env.BENCHMARK_API_URL ?? 'http://127.0.0.1:3000',
);
const origin = process.env.BENCHMARK_ORIGIN?.trim();
const samples = Number(process.env.BENCHMARK_MOVEMENTS ?? 20);
const inputIntervalMs = Number(process.env.BENCHMARK_INPUT_INTERVAL_MS ?? 80);

if (mode !== 'http' && mode !== 'websocket') {
  throw new Error('Choose the http or websocket benchmark');
}
if (!Number.isInteger(samples) || samples < 1) {
  throw new Error('BENCHMARK_MOVEMENTS must be a positive integer');
}
if (!Number.isFinite(inputIntervalMs) || inputIntervalMs < 0) {
  throw new Error('BENCHMARK_INPUT_INTERVAL_MS must be nonnegative');
}

const directions = [
  { direction: 'up', reverse: 'down', x: 0, y: -1 },
  { direction: 'down', reverse: 'up', x: 0, y: 1 },
  { direction: 'left', reverse: 'right', x: -1, y: 0 },
  { direction: 'right', reverse: 'left', x: 1, y: 0 },
];

function endpoint(path) {
  const url = new URL(apiUrl);
  url.pathname = `${url.pathname.replace(/\/$/, '')}/${path}`;
  url.search = '';
  url.hash = '';
  return url;
}

function headers(token) {
  return {
    [GAMEPLAY_PROTOCOL_HEADER]: GAMEPLAY_PROTOCOL_VERSION,
    'Content-Type': 'application/json',
    ...(origin ? { Origin: origin } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function request(path, options, schema) {
  const response = await fetch(endpoint(path), options);
  if (!response.ok) {
    const detail = (await response.text()).trim().slice(0, 500);
    throw new Error(`HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
  }
  return schema.parse(await response.json());
}

function createGame() {
  return request(
    'games',
    {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        playerName: `Bench-${mode[0]}-${Date.now().toString(36)}`,
        character: 'dwarf',
      }),
    },
    NewGameResponseSchema,
  );
}

function openPair(state) {
  const enemies = new Set(
    state.visibleEnemies.map(({ x, y }) => `${x}:${y}`),
  );
  const tiles = new Map(
    state.visibleTiles.map((tile) => [`${tile.x}:${tile.y}`, tile]),
  );
  const pair = directions.find(({ x, y }) => {
    const key = `${state.player.x + x}:${state.player.y + y}`;
    const tile = tiles.get(key);
    return tile && tile.type !== 'wall' && !enemies.has(key);
  });
  if (!pair) throw new Error('No known open adjacent tile is available');
  return pair;
}

function latency(durations) {
  const sorted = [...durations].sort((left, right) => left - right);
  const percentile = (ratio) =>
    sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)] ?? 0;
  return {
    medianMs: Number(percentile(0.5).toFixed(2)),
    p95Ms: Number(percentile(0.95).toFixed(2)),
    maximumMs: Number((sorted.at(-1) ?? 0).toFixed(2)),
  };
}

function report(result, passed) {
  console.info(JSON.stringify(result, null, 2));
  if (!passed) process.exitCode = 1;
}

async function runHttp() {
  const game = await createGame();
  let state = game.state;
  let revision = game.revision;
  let pair = openPair(state);
  let direction = pair.direction;
  let rejectedInputCount = 0;
  const durations = [];

  for (
    let attempts = 0;
    durations.length < samples && attempts < samples * 5;
    attempts += 1
  ) {
    const startedAt = performance.now();
    const result = await request(
      `games/${encodeURIComponent(game.gameId)}/actions`,
      {
        method: 'POST',
        headers: headers(game.sessionToken),
        body: JSON.stringify({
          actionId: crypto.randomUUID(),
          expectedRevision: revision,
          command: { type: 'move', direction },
        }),
      },
      GameCommandResultSchema,
    );
    revision = result.revision;
    state = result.state;
    if (result.events.some(({ type }) => type === 'player_moved')) {
      durations.push(performance.now() - startedAt);
      direction = direction === pair.direction ? pair.reverse : pair.direction;
    } else {
      rejectedInputCount += 1;
      pair = openPair(state);
      direction = pair.direction;
    }
  }

  if (durations.length !== samples) {
    throw new Error(`Collected ${durations.length} of ${samples} movements`);
  }
  const result = latency(durations);
  report(
    {
      transport: mode,
      samples,
      ...result,
      rejectedInputCount,
      target: { p95Ms: 50, met: result.p95Ms <= 50 },
    },
    result.p95Ms <= 50,
  );
}

async function connect(gameId) {
  const url = endpoint(`games/${encodeURIComponent(gameId)}/stream`);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const startedAt = performance.now();
  const socket = new WebSocket(url, origin ? { origin } : {});
  await Promise.race([
    once(socket, 'open'),
    delay(15_000, undefined, { ref: false }).then(() => {
      throw new Error('Connection timed out');
    }),
  ]);
  return { socket, durationMs: performance.now() - startedAt };
}

function parseMessage(result) {
  if (result.done) throw new Error('WebSocket closed unexpectedly');
  const [data, binary] = result.value;
  if (binary) throw new Error('Received a binary response');
  return GameWebSocketServerMessageSchema.parse(JSON.parse(data.toString()));
}

async function runWebSocket() {
  const game = await createGame();
  const connection = await connect(game.gameId);
  const messages = on(connection.socket, 'message', { close: ['close'] });
  const nextMessage = async () => parseMessage(await messages.next());

  try {
    const authenticationStartedAt = performance.now();
    connection.socket.send(
      JSON.stringify({
        type: 'authenticate',
        protocolVersion: GAMEPLAY_PROTOCOL_VERSION,
        sessionToken: game.sessionToken,
      }),
    );
    const authenticated = await nextMessage();
    const authenticationDurationMs = performance.now() - authenticationStartedAt;
    if (authenticated.type !== 'authenticated') {
      throw new Error(`Authentication returned ${authenticated.type}`);
    }

    const pair = openPair(authenticated.state);
    const pending = new Map();
    const durations = [];
    let clientPeakQueueDepth = 0;
    let serverPeakQueueDepth = 0;
    let sentBeforeEarlierAcknowledgment = 0;
    const burstStartedAt = performance.now();

    async function send() {
      for (let index = 0; index < samples; index += 1) {
        while (pending.size >= GAME_WEBSOCKET_CLIENT_QUEUE_LIMIT) await delay(1);
        const actionId = crypto.randomUUID();
        if (pending.size > 0) sentBeforeEarlierAcknowledgment += 1;
        pending.set(actionId, performance.now());
        clientPeakQueueDepth = Math.max(clientPeakQueueDepth, pending.size);
        connection.socket.send(
          JSON.stringify({
            type: 'command',
            actionId,
            expectedRevision: game.revision + index,
            command: {
              type: 'move',
              direction: index % 2 === 0 ? pair.direction : pair.reverse,
            },
          }),
        );
        if (inputIntervalMs > 0 && index + 1 < samples) {
          await delay(inputIntervalMs);
        }
      }
    }

    async function receive() {
      while (durations.length < samples) {
        const message = await nextMessage();
        if (message.type === 'command_error') {
          throw new Error(`${message.code}: ${message.error}`);
        }
        if (message.type !== 'acknowledgment') {
          throw new Error(`Unexpected ${message.type} message`);
        }
        const sentAt = pending.get(message.actionId);
        if (sentAt === undefined) throw new Error('Unknown action ID');
        pending.delete(message.actionId);
        durations.push(performance.now() - sentAt);
        serverPeakQueueDepth = Math.max(
          serverPeakQueueDepth,
          message.serverPeakQueueDepth ?? 0,
        );
      }
    }

    await Promise.race([
      Promise.all([send(), receive()]),
      delay(45_000, undefined, { ref: false }).then(() => {
        throw new Error('Benchmark timed out');
      }),
    ]);

    const result = latency(durations);
    const local = ['127.0.0.1', 'localhost', '::1'].includes(apiUrl.hostname);
    const limits = local
      ? { p95Ms: 50, maximumMs: 250 }
      : { medianMs: 100, p95Ms: 175, maximumMs: 250 };
    const met =
      result.p95Ms <= limits.p95Ms &&
      result.maximumMs <= limits.maximumMs &&
      (local || result.medianMs <= limits.medianMs) &&
      pending.size === 0;

    report(
      {
        transport: mode,
        connectionDurationMs: Number(connection.durationMs.toFixed(2)),
        authenticationDurationMs: Number(authenticationDurationMs.toFixed(2)),
        samples: durations.length,
        inputIntervalMs,
        ...result,
        totalBurstDrainMs: Number(
          (performance.now() - burstStartedAt).toFixed(2),
        ),
        clientPeakQueueDepth,
        serverPeakQueueDepth,
        sentBeforeEarlierAcknowledgment,
        lostInputCount: samples - durations.length,
        target: { ...limits, met },
      },
      met,
    );
  } finally {
    await messages.return();
    connection.socket.close();
  }
}

await (mode === 'http' ? runHttp() : runWebSocket());
