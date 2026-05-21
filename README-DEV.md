# SIGN Platform — Local Development Guide

> **First time setting up?** See [docs/SETUP.md](./docs/SETUP.md) for the complete from-scratch setup guide covering prerequisites, all four `.env` files, Docker startup, seed users, test commands, and common failures.

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
| MANAGEX (landing page) | http://localhost:5175 | Cyan |

Press `Ctrl+C` to stop both.

You can also run them individually:

```bash
npm run dev:sign    # SIGN app only → http://localhost:5173
npm run dev:managex  # MANAGEX landing only → http://localhost:5175
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
apps/managex/     → Landing page (port 5175)
packages/tokens/  → Shared design tokens (@managex/tokens)
backend/          → NestJS API (port 3000)
ai-backend/       → Python AI service (port 8000)
```

## Auto Startup

All containers are configured with `restart: unless-stopped`.

To enable fully automatic startup when your Mac boots:
1. Open Docker Desktop
2. Go to Settings → General
3. Enable "Start Docker Desktop when you log in"

After that, every time you turn on your Mac, Docker will start automatically
and all containers (SIGN frontend, MANAGEX, backend, AI backend, database,
Redis, Celery worker) will come back up on their own with no manual commands needed.

To manually start everything:
```bash
docker-compose up -d
```

To manually stop everything:
```bash
docker-compose down
```
