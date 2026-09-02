# Dungeon Crawler

A browser-based, server-authoritative dungeon crawler built with TypeScript, React, Fastify, and MongoDB. The player fights monsters, collects equipment, and tries to escape 20 procedurally generated floors.

## Architecture

Gameplay uses authenticated HTTP commands. MongoDB is the durable source of truth, every accepted action advances a revision, and compact retained action receipts make exact retries idempotent without duplicating full game state. The browser receives only a filtered projection of explored terrain, remembered items on explored tiles, and currently visible enemies.

The workspace has five code packages:

```text
dungeon-crawler/
├── apps/
│   ├── api/          Fastify API, MongoDB persistence, health checks, and leaderboard routes
│   └── ui/           React application and demand-driven Canvas 2D renderer
├── packages/
│   ├── domain/       Deterministic game rules, generation, combat, progression, and visibility
│   ├── protocol/     Runtime schemas, wire types, and filtered client projections
│   └── shared/       Compatibility exports for domain and protocol consumers
├── docker-compose.yml
├── pnpm-workspace.yaml
└── vitest.workspace.ts
```

`GameGateway` is the browser's only authenticated gameplay boundary, and `GameClientModel` is its only gameplay representation. The API's command service is the only production mutation path. Gameplay does not use WebSockets or polling.

## Pinned toolchain

Development, package metadata, and both application Dockerfiles use these exact versions:

- Node.js 24.19.0
- pnpm 11.24.0

The tracked `.node-version` works with version managers such as fnm, nodenv, and asdf configurations that honor that file. Activate Node, then let Corepack select the `packageManager` version from `package.json`:

```bash
fnm use
corepack enable
corepack prepare pnpm@11.24.0 --activate
node --version
pnpm --version
```

The two version commands must print `v24.19.0` and `11.24.0` before installation.

## Installation

Install only from the committed lockfile:

```bash
pnpm install --frozen-lockfile
```

A stale manifest or lockfile is an error. Do not replace the frozen install with an unfrozen fallback.

## Environment contract

Environment files are local inputs and must not be committed. Never print or store MongoDB credentials or session tokens in source, documentation, build arguments, image labels, URLs, action bodies, or logs.

| Variable | Scope | Requirement and default | Sensitive | Timing and behavior |
| --- | --- | --- | --- | --- |
| `MONGODB_URI` | API | Required; no default | Yes | API runtime. Startup fails before listening if it is missing or MongoDB cannot be reached. The selected database is taken from the URI. |
| `PORT` | API | Optional; default `3000` | No | API runtime. Values outside `1` through `65535` stop startup. |
| `ALLOWED_ORIGINS` | API | Optional; default `http://localhost:5173` | No | API runtime. Comma-separated exact origins are allowed. Development and localhost requests may omit `Origin`; production requests to a non-local host must supply an allowed origin. `/health` is always allowed. |
| `NODE_ENV` | API | Optional; behavior defaults to non-production development mode | No | API runtime. `production` uses warning-level JSON logging and stricter null-origin CORS behavior; `test` suppresses normal command outcome logs. |
| `VITE_API_URL` | UI | Optional; default `/api` | No | UI build time. Empty and whitespace-only values use `/api`; malformed values stop the build. Vite embeds the value in the static JavaScript bundle. An nginx-served image cannot change it at runtime. |
| `RUN_MONGODB_INTEGRATION` | Tests | Test script sets it to `1` | No | Test process only. It enables the five real-MongoDB migration, durability, and concurrency cases; the standard suite skips them. |
| `MONGODB_TEST_URI` | Tests | Optional; default `mongodb://127.0.0.1:27017/?directConnection=true` | Treat as sensitive when it contains credentials | Test process only. It must target a disposable local test service, never a production or shared database. Each run creates and drops its own UUID-named database. |

The API process loads `apps/api/.env` through dotenv when present. `apps/api/.env.example` and `apps/ui/.env.example` are placeholder references only. Keep real values in untracked local files or the owner's deployment secret store.

## Local development

Start a local MongoDB service if one is not already listening on port 27017, then run the API and UI:

```bash
docker compose up -d mongo
pnpm dev
```

The UI listens on `http://localhost:5173`, proxies same-origin `/api` requests to the API at `http://127.0.0.1:3000`, and keeps the session credential out of the URL. Focused commands are also available:

```bash
pnpm dev:api
pnpm dev:ui
```

Each focused command starts the selected application plus the workspace dependency watchers it needs, so it works from a clean checkout and refreshes generated runtime exports after source edits.

## Legacy save migration

The HTTP client recognizes the exact one-hour legacy browser record written by the WebSocket release. It preserves the old game identifier, carries the player name and character into versioned preferences, and requests a one-time server migration. The API atomically wraps the root-level legacy game document in the authenticated persistence envelope, initializes deterministic random state, and returns a new session token. The browser removes the legacy record only after storing the new credential pair.

The migration endpoint matches only active documents that lack both the authenticated envelope and token hash. Possession of the unguessable legacy game identifier remains the migration credential, matching the access boundary of the legacy API, and the endpoint cannot be reused after the atomic conversion succeeds.

## Verification

The normal check is read-only:

```bash
pnpm run verify
```

It checks formatting, TypeScript, lint rules, and all five standard Vitest projects. It does not enable the MongoDB integration gate and does not rewrite source. Apply formatting explicitly with `pnpm format`.

Run the extended checks before a release handoff:

```bash
pnpm test:coverage
pnpm test:integration
pnpm build
pnpm build:ui
git diff --check
```

`pnpm typecheck` resolves workspace imports to source through typecheck-only configurations. Runtime exports still point to built JavaScript and declarations in each package's `dist` directory. Type checking is non-emitting and does not require a preliminary build.

## Production builds

The root production build runs the required order: domain, protocol, shared, API, then UI. The UI-only production command builds domain, protocol, shared, then UI.

```bash
pnpm build
pnpm build:ui
```

Generated `dist`, coverage, and TypeScript build artifacts are ignored and must not be committed.

## Containers

Both application images use Node 24.19.0 and Corepack-managed pnpm 11.24.0. Their dependency layers copy every workspace manifest and require a frozen lockfile. The API image builds and carries domain, protocol, shared, and API output. The UI image contains the Vite bundle plus the nginx `/api` proxy and SPA fallback.

Build the images directly:

```bash
docker build --no-cache -f apps/api/Dockerfile -t dungeon-crawler-api:local .
docker build --no-cache -f apps/ui/Dockerfile -t dungeon-crawler-ui:local .
```

For an isolated Compose smoke run, choose a unique project name and host port so its network, MongoDB volume, and port cannot collide with another run:

```bash
MONGO_HOST_PORT=27018 docker compose -p dc-smoke up -d --build --wait
curl --fail http://localhost:5173/
curl --fail http://localhost:5173/api/health
curl --fail http://localhost:5173/nonexistent-spa-route
docker compose -p dc-smoke down --volumes
```

MongoDB remains a separate Compose service. API startup creates the required indexes through normal application behavior, and `/health` reports database connectivity. The API port is exposed only inside the Compose network so nginx is the sole trusted proxy boundary. The nginx container serves the built UI, forwards client identity for per-client rate limiting, falls back to `index.html` for client routes, and proxies `/api` to the API service.

## How to play

1. Enter a player name and choose Dwarf, Elf, Bandit, or Wizard.
2. Move with WASD or the arrow keys.
3. Walk into an enemy for melee combat, or press Space for a ranged attack.
4. Pick up potions and stronger equipment.
5. Walk onto the stairs to descend.
6. Escape floor 20 to win.

## Deployment

The API Docker image is configured for Fly through `fly.toml`. Set `MONGODB_URI` and `ALLOWED_ORIGINS` as Fly secrets, then deploy from the repository root with `fly deploy`.

The UI builds as a static Vite application and can deploy to Vercel with `pnpm build:ui` and the `apps/ui/dist` output directory. Set `VITE_API_URL` to the public Fly API URL before building because Vite embeds it in the browser bundle.

## License

MIT
