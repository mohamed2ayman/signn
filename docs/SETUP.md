# SIGN Platform — Development Setup Guide

> This guide covers everything needed to get a fresh clone running locally.
> All services run in Docker. External API keys are optional for core features.
> For architecture and project rules, see [CLAUDE.md](../CLAUDE.md).
> For known bugs and lessons learned, see [lessons.md](../lessons.md).

---

## 1. Prerequisites

No `.nvmrc` or `engines` field exists in the repo — canonical versions come from the Dockerfiles and CI workflow.

| Tool | Version | How to check |
|------|---------|--------------|
| Node.js | **20+** | `node --version` |
| npm | **10+** (bundled with Node 20) | `npm --version` |
| Python | **3.11** (only needed to run AI tests locally) | `python --version` |
| Docker Desktop | Latest stable | `docker --version` |
| Docker Compose | v2 (bundled with Docker Desktop) | `docker compose version` |
| git | Any | `git --version` |
| gh CLI | Latest (optional — only needed to open PRs) | `gh --version` |

> Docker Desktop handles all service dependencies. Python is only required if you want to run AI backend tests locally without Docker.

---

## 2. Clone & First-Time Setup

```bash
git clone https://github.com/mohamed2ayman/signn.git
cd signn
```

### No git hooks to configure

There is no Husky, no lint-staged, and no `prepare` script. Nothing extra to run after cloning.

### Dependency installation

Docker handles all dependency installation at runtime. You only need to install locally if you want to run tests outside Docker.

| What | Where to run | Command |
|------|-------------|---------|
| Frontend tests | **Repo root** (not `apps/sign/`) | `npm ci` |
| Backend tests | `backend/` | `cd backend && npm ci` |
| AI backend tests | `ai-backend/` | `cd ai-backend && pip install -r requirements.txt` |

**Why frontend must install from repo root:** `apps/sign` depends on `@managex/tokens` via npm workspaces. Running `npm ci` inside `apps/sign/` directly will fail to resolve this workspace dependency. The root `package.json` defines `"workspaces": ["apps/*", "packages/*"]`.

**Why backend installs separately:** `backend/` is **not** a workspace member. It has its own `package-lock.json` and must be installed independently.

---

## 3. Environment Files

Copy each example file to `.env` before starting the stack:

```bash
cp backend/.env.example   backend/.env
cp ai-backend/.env.example  ai-backend/.env
cp apps/sign/.env.example   apps/sign/.env
cp apps/managex/.env.example  apps/managex/.env
```

### Minimum values to fill in before `docker-compose up`

Only these vars need non-default values. Everything else either has a safe default or is optional (feature disabled when blank).

#### `backend/.env`

| Var | Required? | What to set | Note |
|-----|-----------|-------------|------|
| `DATABASE_URL` | **Required** | `postgresql://sign_user:sign_password@postgres:5432/sign_db` | Use `postgres` (service name), not `localhost`, inside Docker |
| `JWT_SECRET` | **Required** | Any random string, min 16 chars | e.g. `openssl rand -hex 32` |
| `JWT_REFRESH_SECRET` | **Required** | Any random string, min 32 chars, **different from JWT_SECRET** | Dev fallback exists in `docker-compose.yml` — see note below |
| `NESTJS_INTERNAL_TOKEN` | **Required** | Any shared secret string | Must match `ai-backend/.env` |
| `REDIS_URL` | **Required** | `redis://redis:6379` | Use `redis` (service name) inside Docker |
| `FRONTEND_URL` | **Required** | `http://localhost:5173` | Used in email links |
| `BASE_URL` | **Required** | `http://localhost:3000` | Used in email links and PDFs |
| `SEED_ADMIN_PASSWORD_1` | **Required for seeds** | Minimum 12 chars, e.g. `Youssef@1997` | Initial password for `youssef141162@gmail.com` |
| `SEED_ADMIN_PASSWORD_2` | **Required for seeds** | Minimum 12 chars, e.g. `Admin@Sign2026` | Initial password for `admin@sign.com` |
| `SEED_ADMIN_PASSWORD_3` | **Required for seeds** | Minimum 12 chars | Initial password for `mohameddaaymande@gmail.com` |

> **Seed passwords:** If any `SEED_ADMIN_PASSWORD_*` var is missing or under 12 chars, the seed script throws and the backend container will fail to start. Set all three before your first `docker-compose up`.

> **JWT_REFRESH_SECRET dev fallback:** `docker-compose.yml` includes a hardcoded fallback (`dev-only-refresh-secret-minimum-32-chars-please-change`) so the app can start without this var set. For any serious local work, set your own value in `.env`.

**Vars with safe defaults (leave as-is):**
`NODE_ENV=development`, `PORT=3000`, `JWT_ACCESS_EXPIRES_IN=15m`, `JWT_REFRESH_EXPIRES_IN=7d`, `AI_BACKEND_URL=http://ai-backend:8000`, `AWS_REGION=us-east-1`

**Optional (leave blank — feature disabled, no crash):**
All DocuSign vars, all Paymob vars, all AWS S3 vars, `ANTHROPIC_API_KEY`, `SMTP_HOST/PORT/USER/PASS`, `SENDGRID_API_KEY`

---

#### `ai-backend/.env`

| Var | Required? | What to set |
|-----|-----------|-------------|
| `DATABASE_URL` | **Required** | `postgresql://sign_user:sign_password@postgres:5432/sign_db` |
| `REDIS_URL` | **Required** | `redis://redis:6379` |
| `NESTJS_INTERNAL_TOKEN` | **Required** | Same value as `backend/.env` |
| `NESTJS_API_URL` | **Required** | `http://backend:3000/api/v1` |
| `ANTHROPIC_API_KEY` | Optional | All AI features (risk, compliance, chat, extraction) silently fail without this |
| `OPENAI_API_KEY` | Optional | Embeddings only |

---

#### `apps/sign/.env`

| Var | Required? | What to set |
|-----|-----------|-------------|
| `VITE_API_URL` | **Required** | `http://localhost:3000/api/v1` |
| `VITE_SOCKET_URL` | Optional | `http://localhost:3000` |
| `VITE_DEFAULT_LANGUAGE` | Optional | `en` |
| `VITE_MANAGEX_URL` | Optional | `http://localhost:5175` — URL of ManageX landing, used for backlinks in SIGN layouts. Missing = backlinks render as `"undefined"` (no crash, no warning). |

---

#### `apps/managex/.env`

| Var | Required? | What to set |
|-----|-----------|-------------|
| `VITE_SIGN_APP_URL` | Optional | `http://localhost:5173` (only needed if MANAGEX "Sign in" links must work) |

---

## 4. Start the Stack

### First time (must build images)

```bash
docker-compose up --build
```

### Subsequent starts (images already built)

```bash
docker-compose up -d
```

### What happens on startup

```
postgres + redis
    ↓ (healthcheck passes)
backend + ai-backend + celery-worker
    ↓ backend entrypoint auto-runs:
        npm run migration:run → TypeORM migrations → seeds (admin users + compliance knowledge)
    ↓
frontend + managex
```

**The backend takes 60–90 seconds** to compile TypeScript before it's ready to serve requests. The healthcheck has a `start_period: 60s` to account for this.

### Verify everything is up

```bash
# Backend health endpoint
curl http://localhost:3000/api/v1/health
# Expected: {"status":"ok",...}

# Check backend logs for key startup lines
docker logs sign-backend 2>&1 | grep -E "validated|started|seed"
# Expected:
#   [seed] Ensured admin user (password preserved): youssef141162@gmail.com
#   [seed] Ensured admin user (password preserved): admin@sign.com
#   [seed] All seeds completed.
#   ✅ All environment variables validated successfully
#   Nest application successfully started

# Check all services are running
docker-compose ps
```

### Running only the frontends (without the backend stack)

```bash
docker-compose -f docker-compose.frontend.yml up -d
```

---

## 5. Seed Users

These three accounts are created automatically on every `docker-compose up`. Seed uses `ON CONFLICT DO NOTHING` — **existing passwords are never overwritten** on subsequent restarts.

| Email | Password env var | Default (from CLAUDE.md) | Role |
|-------|-----------------|--------------------------|------|
| youssef141162@gmail.com | `SEED_ADMIN_PASSWORD_1` | `Youssef@1997` | SYSTEM_ADMIN |
| admin@sign.com | `SEED_ADMIN_PASSWORD_2` | `Admin@Sign2026` | SYSTEM_ADMIN |
| mohameddaaymande@gmail.com | `SEED_ADMIN_PASSWORD_3` | set manually | SYSTEM_ADMIN |

All three accounts have SYSTEM_ADMIN role — full access to both the client portal (`/app/*`) and the admin portal (`/admin/*`).

In addition, **9 compliance knowledge base assets** are seeded automatically (FIDIC Red Book/Yellow Book, NEC4, Egyptian/UAE/UK law articles, FIDIC vs local law conflict guides). These are platform-level assets and are idempotent.

> If login stops working after a Docker restart, run:
> ```bash
> docker-compose exec backend npm run migration:run
> ```

---

## 6. Port Map

| Service | Container | Port |
|---------|-----------|------|
| SIGN frontend | `sign-frontend` | **5173** |
| MANAGEX landing | `sign-managex` | **5175** |
| NestJS backend | `sign-backend` | **3000** |
| FastAPI AI backend | `sign-ai-backend` | **8000** |
| PostgreSQL | `sign-postgres` | **5432** |
| Redis | `sign-redis` | **6379** |
| Celery worker | `sign-celery-worker` | internal only |

> **Port 5175 and Docker:** Once `docker-compose up` has been run, Docker holds port 5175. Running the MANAGEX landing locally with `npm run dev:managex` will fail with "port in use". Either use the Docker-served version at `localhost:5175` or stop Docker first.

---

## 7. Running Tests

All three test suites run without a live database, Redis, or any external API. Every dependency is mocked.

### Backend — Jest

```bash
# Install deps first (backend has its own lockfile, NOT in the npm workspace)
cd backend
npm ci

# Run all tests
npm test
# → jest --runInBand, 6 suites, 33 tests

# Watch mode
npm run test:watch

# With coverage
npm run test:cov
```

### Frontend — Vitest

```bash
# CRITICAL: install from REPO ROOT, not from apps/sign/
# apps/sign depends on @managex/tokens (workspace dep) — cd apps/sign && npm ci will fail
cd ..   # back to repo root (or just be at repo root already)
npm ci

# Run tests
npm -w @managex/sign run test
# → vitest run, 2 suites, 8 tests

# Watch mode
npm -w @managex/sign run test:watch

# With coverage
npm -w @managex/sign run test:cov
```

### AI Backend — pytest

**Option A: Inside Docker (recommended — no local Python setup needed)**

```bash
docker exec sign-celery-worker python -m pytest tests/ -v
# → 3 files, 8 tests
```

**Option B: Locally (requires Python 3.11 + system packages)**

```bash
# Ubuntu/Debian: install system dependencies first
sudo apt-get install -y tesseract-ocr tesseract-ocr-ara poppler-utils libpq-dev

cd ai-backend
pip install -r requirements.txt
python -m pytest tests/ -v
```

> `pytest.ini` sets `pythonpath = .` — this is required. Without it, all `from app.*` imports fail with `ModuleNotFoundError`.

---

## 8. What Works Without External API Keys

### Works with zero external keys (pure local Docker stack)

- Full authentication: register, login, TOTP MFA, invitations, password reset
- Organization and team management
- Project and contractor management
- Contract creation, clause editing, version history
- Approval workflow
- Claims, Notices, Sub-contract submission and tracking
- Obligations dashboard (manual entry)
- Admin portal: user management, plan CRUD, security settings, audit trail
- MANAGEX landing page

### Requires external API keys

| Feature | Keys Required | Free Local Alternative |
|---------|--------------|------------------------|
| All AI features (risk analysis, compliance check, chat, clause extraction, summarize, diff) | `ANTHROPIC_API_KEY` | **None — real key required** |
| E-signatures | `DOCUSIGN_INTEGRATION_KEY`, `DOCUSIGN_SECRET_KEY`, `DOCUSIGN_ACCOUNT_ID`, `DOCUSIGN_WEBHOOK_HMAC_SECRET`, `DOCUSIGN_RSA_PRIVATE_KEY`, `DOCUSIGN_USER_ID` | Free sandbox at [developers.docusign.com](https://developers.docusign.com) |
| Payments | `PAYMOB_API_KEY`, `PAYMOB_INTEGRATION_ID`, `PAYMOB_IFRAME_ID`, `PAYMOB_HMAC_SECRET` | Test-mode keys from Paymob dashboard |
| File uploads to cloud | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_S3_BUCKET` | MinIO Docker container (local S3 emulator) |
| Email sending | `SMTP_HOST/PORT/USER/PASS` or `SENDGRID_API_KEY` | [Mailtrap.io](https://mailtrap.io) (free — catches all outgoing emails) |
| OpenAI embeddings | `OPENAI_API_KEY` | AI degrades but does not crash |

---

## 9. Hot Reload Behaviour

| Service | Hot Reload? | How | Caveat |
|---------|------------|-----|--------|
| **Backend** | Yes (Linux/Mac) | `nest start --watch` via `./backend:/app` volume mount | TypeScript recompile takes ~30–60s after save |
| **AI backend** | Yes (Linux/Mac) | `uvicorn --reload` via `./ai-backend:/app` volume mount | Python reload is instant |
| **Celery worker** | No | Source is mounted but Celery does not auto-reload | Run `docker restart sign-celery-worker` after Python changes |
| **SIGN frontend** | Yes (Linux/Mac) | Vite HMR via full repo mount `.:/app` | Instant |
| **MANAGEX landing** | Yes (Linux/Mac) | Same as SIGN frontend | Instant |
| **Backend** | No (Windows) | `docker-compose.override.yml` removes volume mounts | Run `docker-compose up --build -d backend` to see changes |
| **Frontends** | No (Windows) | `docker-compose.override.yml` sets `volumes: []` to fix CRLF/path issues | Run `docker-compose up --build` to see frontend changes |

> **Windows note:** A `docker-compose.override.yml` file (gitignored) exists at the repo root. Docker automatically merges it with `docker-compose.yml`. It removes volume mounts from frontend services to fix CRLF line-ending and path issues on Windows. Trade-off: no hot reload for frontends on Windows.

---

## 10. Common Failures & Fixes

These are the issues developers **will** hit. All sourced from `lessons.md`.

---

**#14 — bcrypt binary fails on Windows**

*Problem:* Backend container crashes on startup with `invalid ELF header` or `Error loading shared library` for bcrypt.

*Fix:* Already handled automatically. `docker-entrypoint.sh` runs `npm rebuild bcrypt` at container startup to recompile the native binary for Linux. No action needed — just run `docker-compose up --build`.

---

**#15 — CRLF line endings crash entrypoint**

*Problem:* Container crashes with `/usr/bin/env: 'bash\r': No such file or directory`.

*Fix:* Already handled automatically. The `backend/Dockerfile` runs `sed -i 's/\r//'` on the entrypoint script at build time. No action needed.

---

**#28 / #33 — Backend not rebuilt after colleague adds npm packages**

*Problem:* A colleague added npm packages to `backend/package.json`. You pulled, ran `docker-compose up -d` (or even `--build`), and the backend fails with `Cannot find module 'package-name'` — or login breaks silently because the TypeScript compilation fails.

*Root cause:* The backend service has an anonymous Docker volume at `/app/node_modules`. This volume **persists independently of the image**. `docker-compose up --build` rebuilds the image (runs `npm ci` inside) but the container runtime mounts the **old anonymous volume over the new image layer**, hiding the newly installed packages.

*Fix:*
```bash
docker-compose up --force-recreate --renew-anon-volumes -d backend
```
`--renew-anon-volumes` discards the old `/app/node_modules` volume and creates a fresh one from the rebuilt image.

---

**#34 — New required Joi env var breaks your environment**

*Problem:* Backend crashes immediately after pulling: `Config validation error: "SOME_VAR" is required`.

*Fix:* A required env var was added to the Joi schema in `app.module.ts`. Add it to your `backend/.env`. Check `backend/.env.example` for the description and a safe value to use.

---

**#45 — Vite cannot bind port 5175 while Docker is running**

*Problem:* Running `npm run dev:managex` locally fails with "Port 5175 is in use". Docker is holding the port even if the `sign-managex` container is stopped.

*Fix:* Use the Docker-served landing page at `http://localhost:5175` instead of running Vite locally. If you must run locally, stop all Docker containers first:
```bash
docker-compose down
npm run dev:managex
```

---

**#51 — gh CLI push to `.github/workflows/` silently rejected**

*Problem:* `git push` appears to succeed but the remote ref is not updated. Any push touching `.github/workflows/` files is rejected without `workflow` scope.

*Fix:* Re-authenticate with the correct scopes:
```bash
gh auth login --scopes "repo,workflow,read:org,gist" --web
```
Verify: `gh auth status | grep "Token scopes"` — must show `workflow`.

---

**Backend tests: rate-limit spec fails when tests run in parallel**

*Problem:* `rate-limit.spec.ts` fails to compile/run when Jest runs all suites in parallel — `Cannot find module '@nestjs/throttler'` or a `readFileBuffer` runtime error.

*Fix:* Already handled. The `test` script in `backend/package.json` uses `jest --runInBand` (sequential). This was added in commit `87776cc`. If you see this error, confirm your `package.json` has `"test": "jest --runInBand"`.

---

## 11. Database Reset & Recovery

```bash
# Login broken after restart — re-run migrations + seeds
docker-compose exec backend npm run migration:run

# Re-run seeds only (skip migrations)
docker-compose exec backend npm run seed:run

# Stale node_modules after git pull (colleague added npm packages)
docker-compose up --force-recreate --renew-anon-volumes -d backend

# Full clean restart — wipes containers, rebuilds images
docker-compose down && docker-compose up --build

# WIPE DATABASE COMPLETELY and start fresh
# Warning: destroys all data including postgres_data volume
docker-compose down -v
docker-compose up --build

# Port 3000 conflict — run only frontends (skip backend)
docker-compose up --build sign managex

# Check document processing status
docker exec sign-postgres psql -U sign_user -d sign_db -c \
  "SELECT file_name, processing_status, processing_stage FROM document_uploads ORDER BY created_at DESC LIMIT 5;"

# Clean orphaned clauses after a failed AI extraction
docker exec sign-postgres psql -U sign_user -d sign_db -c \
  "DELETE FROM clauses WHERE id NOT IN (SELECT DISTINCT clause_id FROM contract_clauses);"

# Check Celery worker settings (concurrency, time limits)
docker exec sign-celery-worker celery inspect stats 2>/dev/null
```

---

## 12. gh CLI Setup

Required only when opening pull requests or pushing changes to `.github/workflows/`.

### Install

```bash
# Windows
winget install GitHub.cli

# macOS
brew install gh
```

**Windows:** After install, refresh PATH in the same terminal session:
```powershell
$env:PATH = [System.Environment]::GetEnvironmentVariable("PATH","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH","User")
```
Or use the full path directly: `C:\Program Files\GitHub CLI\gh.exe`

### Authenticate (required scopes)

```bash
gh auth login --scopes "repo,workflow,read:org,gist" --web
```

> Default `gh auth login` scopes do **not** include `workflow`. Without it, any push touching `.github/workflows/` files is silently rejected by GitHub. Always use the scopes above. (lesson #51)

### Verify

```bash
gh auth status | grep "Token scopes"
# Must include: workflow
```

---

## 13. Pre-PR Checklist

Run these steps before opening any pull request. Copied from `CLAUDE.md` — see that file for the full rules.

```bash
# 1. Fetch latest main
git fetch origin

# 2. Check if your branch is behind
git log HEAD..origin/main --oneline
# If ANY output appears → rebase before continuing

# 3. Rebase if needed
git rebase origin/main
# When resolving conflicts in CLAUDE.md or lessons.md: keep BOTH sides

# 4. Verify Phase 3.2 artifacts survived (all 5 must return a match)
ls backend/src/common/utils/sanitize.ts
grep "sanitize-html" backend/package.json
grep "@MaxLength" backend/src/modules/clauses/dto/create-clause.dto.ts
grep "@Transform" backend/src/modules/clauses/dto/create-clause.dto.ts
grep "is_internal_note" backend/src/modules/support/support.service.ts

# 5. Run all tests locally
cd backend && npm test         # 33 tests must pass
cd .. && npm -w @managex/sign run test   # 8 tests must pass
docker exec sign-celery-worker python -m pytest tests/ -v   # 8 tests must pass

# 6. Push
git push --force-with-lease origin <your-branch>

# 7. Open PR and wait for green CI before merging
gh pr create --title "..." --body "..."
gh pr checks <PR-number>
```

> **Rule:** Never open a PR from a branch that is behind `origin/main`.

---

*Last updated: 2026-05-21*
*Maintainers: see CLAUDE.md for project rules and architecture decisions.*
