# Dungeon Crawler

A browser-based dungeon crawler game built with TypeScript, React, Fastify, and MongoDB. Fight monsters, collect loot, and try to escape 20 floors of procedurally generated dungeons!

## Overview

A full-stack TypeScript game featuring:
- **Real-time WebSocket gameplay** with delta updates (not full state polling)
- **Turn-based dungeon crawler mechanics** with permadeath
- **Procedurally generated dungeons** using Binary Space Partitioning
- **Server-authoritative game logic** with anti-cheat (only visible data sent to client)
- **ASCII-style rendering** with fog of war
- **Persistent leaderboards** in MongoDB
- **Monorepo architecture** with shared types

## Quick Start

### Prerequisites
- Node.js 25+
- pnpm
- Docker & Docker Compose (optional, for MongoDB)

### Installation

```bash
# Install dependencies
pnpm install
```

### Configuration

Each app has its own `.env.example`:

```bash
# API environment
cp apps/api/.env.example apps/api/.env

# UI environment (only needed for production builds)
cp apps/ui/.env.example apps/ui/.env
```

| App | Variable | Description |
|-----|----------|-------------|
| API | `PORT` | Server port (default: `3000`) |
| API | `MONGODB_URI` | MongoDB connection string |
| API | `ALLOWED_ORIGINS` | Comma-separated list of allowed CORS origins (optional) |
| API | `NODE_ENV` | Environment (`development`, `production`, `test`) (default: `development`) |
| UI | `VITE_API_URL` | API URL for production (empty for local dev) |

### Development

```bash
# Start MongoDB (if not using Docker)
# OR run: docker compose up mongo -d

# Run both API and UI
pnpm dev

# Run API only (port 3000)
pnpm dev:api

# Run UI only (port 5173)
pnpm dev:ui
```

The UI will be available at `http://localhost:5173` and connects via WebSocket to the API.

### Docker

```bash
# Start all services (API, MongoDB, UI)
docker compose up

# Stop all services
docker compose down
```

## Common Commands

```bash
# Development
pnpm dev              # Run both API and UI in parallel
pnpm dev:api          # Run API server on port 3000
pnpm dev:ui           # Run UI on port 5173

# Build
pnpm build            # Build all packages

# Type checking
pnpm typecheck        # Check TypeScript types across all packages

# Code quality
pnpm lint             # Run Biome linter
pnpm format           # Auto-fix linting and formatting issues

# Docker
docker compose up     # Start all services
docker compose down   # Stop all services
```

## Project Structure

```
dungeon-crawler/
├── apps/
│   ├── api/          # Fastify backend (game logic + MongoDB)
│   │   └── src/
│   │       ├── index.ts              # Server entry point
│   │       ├── routes/               # HTTP + WebSocket endpoints
│   │       └── services/             # Game logic, map generation, DB
│   └── ui/           # React frontend (UI + rendering)
│       └── src/
│           ├── App.tsx               # Main app controller
│           ├── components/           # UI components
│           └── hooks/                # WebSocket client, API client
├── packages/
│   └── shared/       # Shared TypeScript types + constants
└── docs/             # Documentation
```

## How to Play

1. Enter your name on the start screen
2. Use **WASD** or **Arrow Keys** to move
3. Walk into enemies to attack them or use **Spacebar** for a ranged attack
4. Collect health potions (!) to heal
5. Walk onto stairs to descend to the next floor
6. Reach floor 20 to win!

## Tech Stack

### Backend
- **Fastify** - Fast, low-overhead web framework
- **@fastify/websocket** - WebSocket support for real-time updates
- **MongoDB** - Document database for game state and leaderboards
- **TypeScript** - Type-safe development

### Frontend
- **React 18** - UI framework
- **Vite 5** - Fast build tool and dev server
- **Tailwind CSS v4** - Utility-first CSS
- **TypeScript** - Type-safe development

### Infrastructure
- **pnpm** - Fast, efficient package manager
- **Docker Compose** - Container orchestration
- **Biome** - Fast linter and formatter

## Architecture Highlights

### WebSocket + Delta Updates
Instead of sending the full game state (~50KB) on every move, the server sends only **deltas** (~200 bytes):
- Player position changes
- Enemy movements (only visible enemies)
- Fog of war reveals
- Combat events

### Anti-Cheat
The server never sends data outside the player's fog of war:
- Hidden enemies are not transmitted
- Map tiles only sent when revealed
- All game logic runs server-side

## Deployment

### Environment Variables

**Local development**: Copy each app's `.env.example` to `.env` (see [Configuration](#configuration)).

**Production**: Set environment variables in your hosting platform (never commit `.env` files):
- **Fly.io** (API): Set `MONGODB_URI` to your Atlas connection string and `ALLOWED_ORIGINS` to your frontend URL
- **Amplify** (UI): Set `VITE_API_URL` to your Fly.io API URL

### AWS Deployment (Monorepo)

This monorepo deploys as two separate services:

| Component | Service | Source |
|-----------|---------|--------|
| UI | AWS Amplify Hosting | `apps/ui` |
| API | Fly.io | `apps/api` |
| DB | MongoDB Atlas | External |

#### Manual Fly.io Setup

If you haven't set up Fly.io yet:

```bash
# Install flyctl
brew install flyctl

# Create the app
fly launch

# Deploy it / update
fly deploy
```

#### MongoDB Atlas

1. Create a free cluster at [mongodb.com/atlas](https://www.mongodb.com/atlas)
2. Add your Fly.io IP to the network access list (or allow all IPs for simplicity)
3. Create a database user and get the connection string

## License

MIT
