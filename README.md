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

The workspace packages have no barrel entry point. Each module is its own subpath, so an import names the file it comes from and `package.json` lists the public surface:

```ts
import { FINAL_FLOOR } from '@dungeon-crawler/domain/rules';
import { GameCommandSchema } from '@dungeon-crawler/protocol/schemas';
```

Node enforces this. A module missing from the `exports` map cannot be imported at all, so internals stay internal without a lint rule.

```text
dungeon-crawler/
├── apps/
│   ├── api/          Fastify API, persistence, health checks, and leaderboards
│   ├── redis/        Redis image with AOF persistence for Fly.io
│   └── ui/           React application and Canvas 2D renderer
├── packages/
│   ├── domain/       Game rules, generation, combat, progression, and visibility
│   └── protocol/     Runtime schemas, wire types, and client projections
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

MongoDB is the long-term checkpoint store. Redis holds newer accepted commands so the API can rebuild current state after a restart. Nothing in this repository provisions MongoDB, so its durability is whatever your MongoDB provider gives you.

On Fly.io, Redis runs beside Node on the API machine, bound to loopback, with AOF persistence at `appendfsync everysec` on the `redis_data` volume. A sudden host failure can lose about one second of acknowledged commands, and an API deploy restarts the journal with it. Losing the volume restores each game only to its latest confirmed MongoDB checkpoint.

`GAME_REDUCER_VERSION` in `apps/api/src/services/gameJournal.ts` guards replay. Journal entries written by a different reducer version are discarded, and those games restore from their latest MongoDB checkpoint instead. Bump it whenever a change to the game rules would make an old command replay to a different state.

## Legacy save migration

The client can migrate the browser save format from the earlier WebSocket release. It keeps the game ID and player preferences, requests a one-time server migration, stores the new session credentials, and then removes the legacy record.

The migration applies only to active legacy documents without the authenticated persistence envelope or token hash. It cannot be repeated after conversion.

## Deployment

Two pieces deploy independently: the API as a Fly.io app, and the UI as a static bundle on Vercel. MongoDB is not deployed by anything in this repository.

Fly app names are globally unique. The checked-in configuration uses `dungeon-crawler-api` in `lax`; if that name is taken, change `app` in `fly.toml` and use your name throughout. Keep the MongoDB connection string out of chat, source files, and command output.

### 1. MongoDB

Provision a MongoDB deployment your Fly app can reach and keep its connection string for step 2. MongoDB Atlas is the usual choice, and any provider reachable over the public internet works. The API validates `MONGODB_URI` at startup and exits if the database is unavailable, so this has to exist first.

Atlas rejects connections from addresses outside its access list, and Fly machines have no stable outbound address unless you buy a dedicated one. Either allocate a dedicated egress IP for the app and list it, or allow `0.0.0.0/0` and rely on the database user's credentials.

### 2. The API

Create the app and the journal volume, set the two secrets, then deploy. `ALLOWED_ORIGINS` must exactly match the browser origin serving the UI, with no path or trailing slash, or gameplay requests and WebSocket upgrades are rejected.

```bash
export API_APP=dungeon-crawler-api
fly apps create "$API_APP"
fly volumes create redis_data --app "$API_APP" --region lax --size 1 --yes
fly secrets set \
  MONGODB_URI="<connection string from step 1>" \
  ALLOWED_ORIGINS="https://<your-ui-origin>" \
  --app "$API_APP"
fly deploy --config fly.toml --app "$API_APP"
fly status --app "$API_APP"
curl --fail "https://${API_APP}.fly.dev/health/dependencies"
```

The volume name has to stay `redis_data` to match the mount in `fly.toml`, and it must be in the machine's region. `REDIS_URL` is not among the secrets, because the image points the API at the Redis it starts.

The health response reports MongoDB and Redis separately, so a failure here identifies which dependency is unreachable. Fly also runs this route as the machine's health check, so a machine that loses either dependency stops receiving traffic.

### 3. The UI

```bash
VITE_API_URL=https://dungeon-crawler-api.fly.dev pnpm build:ui
```

Deploy `apps/ui/dist` through the Vercel project. Because Vite embeds `VITE_API_URL` in the static bundle, changing the API URL requires a new UI build. The client derives its WebSocket URL from the same value.

## License

MIT
