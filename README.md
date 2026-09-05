# Dungeon Crawler

Demo project to demonstrate how a React client, a Fastify API, WebSockets, Redis, MongoDB, automated tests, containers, and cloud deployment can work together in a full game project. 

To play the deployed version, use the website link in this repository's GitHub About section. The game itself is a browser-based dungeon crawler: choose a character, fight monsters, collect equipment, and try to escape 20 procedurally generated floors.

## What the demo covers

- Server-authoritative game rules with no client prediction
- Authenticated WebSocket gameplay with an HTTP fallback
- Redis command journaling and MongoDB checkpoints
- Recovery through deterministic command replay
- Filtered client state that hides unexplored terrain and enemies
- A React interface with a Canvas 2D game renderer
- Unit, integration, network, and browser-facing test coverage
- Docker, Fly.io, and static UI deployment configuration

The current deployment assumes one API machine. Redis checks revisions and action identity atomically, but the API does not implement distributed locks or ownership across multiple machines.

## How to play

1. Enter a player name and choose Dwarf, Elf, Bandit, or Wizard.
2. Move with WASD, the arrow keys, or the on-screen controls.
3. Walk into an enemy for melee combat, or press Space for a ranged attack.
4. Pick up potions and stronger equipment.
5. Walk onto the stairs to descend.
6. Escape floor 20 to win.

## Architecture

Gameplay commands travel over an authenticated WebSocket connection. The API keeps active games in memory and records each accepted command in Redis before acknowledging it. A background worker periodically writes complete checkpoints to MongoDB and removes confirmed journal entries from Redis.

If the API restarts or loses an in-memory game, it loads the latest MongoDB checkpoint and replays newer Redis entries. Revision, protocol, reducer, random-state, and state-hash checks prevent partial or incompatible state from loading.

The browser receives a filtered view of the game: explored terrain, remembered items on explored tiles, and currently visible enemies. Session creation, recovery, migration, deletion, health checks, leaderboards, and the degraded gameplay fallback use HTTP.

`GameGateway` is the browser's gameplay boundary. It can pipeline up to eight accepted inputs. The server processes up to 16 unfinished commands per socket in order. After four consecutive socket failures, the gateway switches to sequential HTTP while preserving command order and identity.

```text
dungeon-crawler/
├── apps/
│   ├── api/          Fastify API, persistence, health checks, and leaderboards
│   ├── redis/        Redis image with AOF persistence for Fly.io
│   └── ui/           React application and Canvas 2D renderer
├── packages/
│   ├── domain/       Game rules, generation, combat, progression, and visibility
│   ├── protocol/     Runtime schemas, wire types, and client projections
│   └── shared/       Compatibility exports for domain and protocol consumers
├── docker-compose.yml
├── pnpm-workspace.yaml
└── vitest.workspace.ts
```

## Requirements

- Node.js 24.19.0
- pnpm 11.24.0
- MongoDB
- Redis

The repository pins Node in `.node-version` and pnpm in `package.json`.

```bash
fnm use
corepack enable
corepack prepare pnpm@11.24.0 --activate
pnpm install --frozen-lockfile
```

## Local development

Start MongoDB and Redis, then run the API and UI:

```bash
docker compose up -d mongo redis
pnpm dev
```

The UI runs at `http://localhost:5173` and proxies API requests and WebSocket upgrades to `http://127.0.0.1:3000`.

To run either application with its required workspace watchers:

```bash
pnpm dev:api
pnpm dev:ui
```

If Redis already runs through Homebrew, start only MongoDB and set `REDIS_URL=redis://127.0.0.1:6379` in `apps/api/.env` before starting the applications.

## Configuration

Environment files are local inputs and must not be committed. Keep MongoDB credentials, Redis credentials, and session tokens out of source, documentation, build arguments, URLs, action bodies, and logs.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `MONGODB_URI` | Yes | None | MongoDB connection used by the API. Startup fails if the database is unavailable. |
| `REDIS_URL` | Yes | None | Redis connection used by the API. Startup fails if Redis is unavailable. |
| `PORT` | No | `3000` | API port. |
| `ALLOWED_ORIGINS` | No | `http://localhost:5173` | Comma-separated browser origins allowed by the API. |
| `NODE_ENV` | No | Development behavior | Enables production logging and CORS behavior or test log suppression. |
| `CHECKPOINT_COMMAND_INTERVAL` | No | `20` | Commands allowed between scheduled MongoDB checkpoints. |
| `CHECKPOINT_TIME_INTERVAL_MS` | No | `30000` | Maximum time a dirty active game waits for a checkpoint. |
| `VITE_API_URL` | No | `/api` | API base URL embedded in the UI build. The client derives its WebSocket URL from it. |

The API reads `apps/api/.env` when present. The example environment files contain placeholders only.

### Test and benchmark configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `MONGODB_TEST_URI` | `mongodb://127.0.0.1:27017/?directConnection=true` | Disposable local MongoDB used by integration tests. |
| `REDIS_TEST_URL` | `redis://127.0.0.1:6379` | Local Redis used by integration tests with isolated key prefixes. |
| `BENCHMARK_API_URL` | `http://127.0.0.1:3000` | API tested by the command benchmarks. |
| `BENCHMARK_ORIGIN` | None | Allowed UI origin sent with benchmark requests when required. |
| `BENCHMARK_MOVEMENTS` | `20` | Valid movements measured by each benchmark. |
| `BENCHMARK_INPUT_INTERVAL_MS` | `80` | Delay between WebSocket inputs. Use `0` for a capacity burst. |

The test scripts set their own integration flags. Test services must be disposable and must never point to production or shared databases.

## Verification

Run the standard checks:

```bash
pnpm run verify
```

This checks formatting, types, lint rules, and the standard test projects without changing source files. Run `pnpm format` to apply formatting.

The extended checks require local MongoDB and Redis services:

```bash
pnpm test:coverage
pnpm test:integration
pnpm build
pnpm build:ui
git diff --check
```

With the API running, the command benchmarks compare sequential HTTP movement with pipelined WebSocket movement:

```bash
pnpm --filter @dungeon-crawler/api benchmark:commands
pnpm --filter @dungeon-crawler/api benchmark:websocket
```

## Production builds

The root build compiles the workspace packages, API, and UI in dependency order. The UI build compiles only the packages needed by the browser application.

```bash
pnpm build
pnpm build:ui
```

Generated `dist`, coverage, and TypeScript build files are ignored.

## Containers

Build the API and UI images:

```bash
docker build --no-cache -f apps/api/Dockerfile -t dungeon-crawler-api:local .
docker build --no-cache -f apps/ui/Dockerfile -t dungeon-crawler-ui:local .
```

Run an isolated Compose smoke test with a unique project name and host ports:

```bash
MONGO_HOST_PORT=27018 REDIS_HOST_PORT=6380 docker compose -p dc-smoke up -d --build --wait
curl --fail http://localhost:5173/
curl --fail http://localhost:5173/api/health
curl --fail http://localhost:5173/api/health/dependencies
curl --fail http://localhost:5173/nonexistent-spa-route
docker compose -p dc-smoke down --volumes
```

The Compose stack runs MongoDB and Redis as separate services. The API port stays inside the Compose network, so nginx is the browser-facing proxy for HTTP and WebSocket traffic.

## Persistence limits

MongoDB is the long-term checkpoint store. Redis holds newer accepted commands so the API can rebuild current state after a restart.

The Fly.io Redis configuration uses one machine, one volume, and AOF persistence with `appendfsync everysec`. A sudden Redis host failure can lose about one second of acknowledged commands. Losing the Redis volume restores each game only to its latest confirmed MongoDB checkpoint.

## Legacy save migration

The client can migrate the browser save format from the earlier WebSocket release. It keeps the game ID and player preferences, requests a one-time server migration, stores the new session credentials, and then removes the legacy record.

The migration applies only to active legacy documents without the authenticated persistence envelope or token hash. It cannot be repeated after conversion.

## Deployment

The checked-in Fly.io configuration expects a Redis app named `dungeon-crawler-redis` with one 1 GB volume in `lax`. Change `app` in `fly.redis.toml` if that name is unavailable.

Provision Redis and attach its private URL to the API. Keep the generated password and connection URL out of chat, source files, and command output.

```bash
export REDIS_APP=dungeon-crawler-redis
export REDIS_PASSWORD="$(openssl rand -hex 32)"
fly apps create "$REDIS_APP"
fly volumes create redis_data --app "$REDIS_APP" --region lax --size 1 --yes
fly secrets set REDIS_PASSWORD="$REDIS_PASSWORD" --app "$REDIS_APP"
fly deploy --config fly.redis.toml --app "$REDIS_APP"
fly secrets set REDIS_URL="redis://default:${REDIS_PASSWORD}@${REDIS_APP}.internal:6379" --app dungeon-crawler-api
unset REDIS_PASSWORD
```

Set `MONGODB_URI` and `ALLOWED_ORIGINS` as API secrets, then deploy the API:

```bash
fly deploy --config fly.toml --app dungeon-crawler-api
fly status --app dungeon-crawler-api
curl --fail https://dungeon-crawler-api.fly.dev/health/dependencies
```

Build the UI with the public API URL:

```bash
VITE_API_URL=https://dungeon-crawler-api.fly.dev pnpm build:ui
```

Deploy `apps/ui/dist` through the Vercel project. Because Vite embeds `VITE_API_URL` in the static bundle, changing the API URL requires a new UI build.

## License

MIT
