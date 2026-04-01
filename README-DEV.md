# SIGN Platform — Local Development Guide

## Prerequisites

- Node.js 20+
- npm 10+
- Docker Desktop (optional, for containerized frontends)

## Running the Frontends

### Option A — Single command (recommended)

```bash
npm run dev:all
```

This starts both frontends in one terminal with color-coded output:

| App | URL | Color |
|-----|-----|-------|
| SIGN (main app) | http://localhost:5173 | Blue |
| CENVOX (landing page) | http://localhost:5174 | Magenta |

Press `Ctrl+C` to stop both.

You can also run them individually:

```bash
npm run dev:sign    # SIGN app only → http://localhost:5173
npm run dev:cenvox  # CENVOX landing only → http://localhost:5174
```

### Option B — Docker frontends only

```bash
docker-compose -f docker-compose.frontend.yml up -d
```

This runs both frontends as background Docker containers that:

- Survive Terminal closure
- Restart automatically after Mac reboot (via `restart: unless-stopped`)
- Support hot reload through volume mounts

To stop the Docker frontends:

```bash
docker-compose -f docker-compose.frontend.yml down
```

## Running the Full Stack (Docker)

To run everything in Docker (postgres, redis, backend, ai-backend, and both frontends):

```bash
docker-compose up -d
```

> **Note:** This requires port 3000 to be free. If you are running the backend locally outside Docker, use `docker-compose.frontend.yml` for the frontends instead.

## Project Structure

```
apps/sign/        → Main frontend (port 5173)
apps/cenvox/      → Landing page (port 5174)
packages/tokens/  → Shared design tokens (@cenvox/tokens)
backend/          → NestJS API (port 3000)
ai-backend/       → Python AI service (port 8000)
```
