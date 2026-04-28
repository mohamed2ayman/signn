# SIGN for Word

A Microsoft Word add-in that brings SIGN's contract intelligence into the document the user is actually editing — risk analysis, AI summary, clause library, AI chat, and one-click upload to the SIGN platform.

Part of the CENVOX product suite. The add-in is a separate deliverable from the SIGN web app and is hosted under `apps/word-addin/` in the SIGN monorepo.

---

## Capabilities

| Tab | What it does |
|-----|--------------|
| **Risk** | Parses the open document into clauses on the server, runs clause-level risk analysis, and applies traffic-light highlights inline (green / yellow / red) anchored by `Word.ContentControl`. Suggests standard alternatives from the user's clause library and supports one-click replacement with single-clause re-analysis. |
| **Summary** | Sends the document text to `POST /ai/summarize`, polls the async job, and renders a concise summary plus key highlights. |
| **Library** | Searches the user's `CONTRACT_TEMPLATE` knowledge assets and inserts the selected clause at the cursor. |
| **Upload** | Streams the open `.docx` to a chosen contract via `POST /contracts/:id/documents`. |
| **Chat** | Conversational AI grounded in the current selection. The selected text is sent as `system_context` (system-level prefix, never appended to the user message). "Copy to document" inserts the assistant's reply at the cursor. Conversation history is held in `sessionStorage` for the taskpane lifetime. |

---

## Prerequisites

- **Node.js ≥ 18** (LTS recommended).
- **Microsoft Word** — desktop (Windows or Mac, build with WordApi 1.3+) or Word Online.
- **SIGN backend running** at `http://localhost:3000` (default) or the URL you set via `SIGN_API_URL`.
- **A SIGN account** that can sign in via `POST /auth/login`. Both Owner Admin and any project-level role work.

---

## Quick start (local development)

```bash
# from apps/word-addin/
npm install

# Trust the office-addin dev cert (one-time per machine)
npx office-addin-dev-certs install

# Start the dev server (HTTPS on https://localhost:3001)
npm run dev

# In a new terminal: sideload + open Word with the add-in attached
npm run start
```

`npm run start` uses `office-addin-debugging` to:

1. Start a Word document.
2. Sideload `manifest.localhost.xml`.
3. Show the **SIGN** group on the **Home** tab → click **Open SIGN** to open the taskpane.

`npm run stop` removes the sideloaded manifest.

### Manual sideload (if `office-addin-debugging` isn't available)

- **Word desktop (Windows/Mac):** Insert → My Add-ins → Upload My Add-in → choose `manifest.localhost.xml`.
- **Word Online:** Insert → Add-ins → Upload My Add-in → choose `manifest.localhost.xml`.

---

## Configuration

| Env var | Used by | Default |
|---------|---------|---------|
| `SIGN_API_URL` | Compiled into the bundle by webpack `DefinePlugin`. The taskpane prefixes every request with this. | `http://localhost:3000/api/v1` |
| `ADDIN_ORIGIN` | `scripts/package.js` — substituted into `manifest.xml` for production. | _(required for `npm run package`)_ |
| `SIGN_API_ORIGIN` | `scripts/package.js` — substituted into `<AppDomains>`. | _(required for `npm run package`)_ |

Set them inline:

```bash
SIGN_API_URL=https://api-staging.sign.ai/api/v1 npm run dev
```

---

## Authentication model

The add-in re-uses the SIGN web-app JWT auth flow.

- **Login** — taskpane login screen calls `POST /auth/login`. Successful login persists `access_token`, `refresh_token`, JWT `exp`, and the user object in `localStorage` (so a Word restart doesn't sign the user out while the refresh token is still valid).
- **MFA** — if `requires_mfa` comes back, the user is prompted for a code and `POST /auth/verify-mfa` is called.
- **Proactive refresh** — every API call routes through `refreshIfNeeded()`, which refreshes via `POST /auth/refresh` whenever the access token is within **30 seconds** of expiry. There is no reactive-on-401 handling — the user does not get bounced mid-edit because of a stale 15-min token.
- **Inline re-login** — if the refresh token itself is rejected, an overlay re-login modal appears above the active tab. In-flight risk results, parsed clauses, and chat history are preserved underneath; nothing is lost.
- **SSO upgrade path** — Document SSO via `OfficeRuntime.auth.getAccessToken()` is **a future upgrade**, not implemented in v0.1. It would replace the email/password login screen with an On-Behalf-Of token exchange against the backend; the rest of the auth pipeline (proactive refresh, AuthRequiredError handling) does not need to change.

Every outgoing request includes:

- `Authorization: Bearer <access_token>`
- `X-Client: word-addin` — used server-side to mark `NegotiationEvent.source = WORD_ADDIN`.

---

## Building a distributable package

```bash
ADDIN_ORIGIN=https://word-addin.sign.ai \
SIGN_API_ORIGIN=https://api.sign.ai \
SIGN_API_URL=https://api.sign.ai/api/v1 \
npm run package
```

This will:

1. `webpack --mode production` → `dist/`
2. Substitute `${ADDIN_ORIGIN}` / `${SIGN_API_ORIGIN}` placeholders in `dist/manifest.xml`
3. Validate the manifest with `office-addin-manifest`
4. Emit `dist/word-addin.zip`

The zip is the artifact you sideload into Word, distribute via your tenant's Centralized Deployment, or submit to AppSource.

---

## Production hosting (TODO before deployment)

> **Status:** the add-in works fully in local development. Hosting decisions are deferred until the SIGN platform itself is being deployed.

When the time comes, hosting must satisfy:

1. **HTTPS-only origin.** Office rejects http:// taskpane URLs in production.
2. **Stable Add-in `Id` GUID.** Never change `9b3a8e74-0c0a-4b5d-9f1e-2c6d7e8f9a01` across releases — Office identifies installed add-ins by it.
3. **Versioned bundle URL or proper cache headers.** Word caches the taskpane HTML aggressively; ship `taskpane.html` with `Cache-Control: no-store` and let webpack content-hash JS/CSS.
4. **CORS allow-list on the SIGN backend** must include `${ADDIN_ORIGIN}`.
5. **`<AppDomains>`** in `manifest.xml` must list both `${ADDIN_ORIGIN}` and `${SIGN_API_ORIGIN}` — Office blocks fetches to anything not declared.

Likely hosting choices (decision pending): the SIGN frontend's CDN under a `/word-addin/` path, or a dedicated Cloudflare Pages / S3+CloudFront bucket.

---

## Project layout

```
apps/word-addin/
├── manifest.localhost.xml      # dev manifest (https://localhost:3001)
├── manifest.xml                # production template with placeholders
├── webpack.config.js           # taskpane + commands entries, HTTPS dev server
├── scripts/package.js          # build → substitute → validate → zip
├── src/
│   ├── commands/               # ribbon FunctionFile (headless host)
│   └── taskpane/
│       ├── App.tsx             # auth + tab router + re-login overlay
│       ├── index.tsx           # Office.onReady → React mount
│       ├── components/         # ReLoginInline, RiskLegend, ClauseProgress
│       ├── lib/
│       │   ├── auth.ts         # login / MFA / proactive refresh
│       │   ├── api.ts          # authenticated fetch + AuthRequiredError
│       │   ├── jobs.ts         # async job polling (60s ceiling)
│       │   ├── word.ts         # Word JS API helpers (anchor, highlight, replace)
│       │   └── types.ts        # DTOs mirroring the SIGN backend
│       ├── styles/global.css
│       └── tabs/
│           ├── LoginTab.tsx
│           ├── RiskTab.tsx
│           ├── SummaryTab.tsx
│           ├── LibraryTab.tsx
│           ├── UploadTab.tsx
│           └── ChatTab.tsx
└── public/assets/              # icon-16.png, icon-32.png, icon-80.png, icon-128.png
```

---

## Backend dependencies

The add-in calls the following SIGN backend endpoints. They were either pre-existing or added as part of this deliverable:

| Endpoint | Purpose | Added by this deliverable? |
|----------|---------|----------------------------|
| `POST /auth/login`, `/auth/verify-mfa`, `/auth/refresh`, `/auth/logout` | Auth flow | no |
| `POST /contracts/parse-from-docx` | Parse document → clauses with paragraph/char boundaries | **yes** |
| `POST /ai/risk-analysis` | Async clause-level risk job | no |
| `POST /ai/summarize` | Async summary job | no |
| `POST /ai/chat` (now accepts `system_context` field) | Async chat job | **field added** |
| `GET /ai/jobs/:jobId` | Poll job status | no |
| `GET /knowledge-assets?asset_type=CONTRACT_TEMPLATE` | Clause library | no |
| `GET /projects`, `GET /projects/:id/contracts` | Upload tab pickers | no |
| `POST /contracts/:id/documents` (multipart) | Upload `.docx` | no |
| `POST /negotiation/events` | Log CLAUSE_FLAGGED / CLAUSE_REPLACED / AI_SUGGESTION_APPLIED | **yes** |
| `GET /contracts/:id/negotiation-history` | Negotiation timeline (consumed by web app Phase 4) | **yes** |

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Taskpane is blank / Office.js never resolves | Dev cert not trusted | `npx office-addin-dev-certs install` and re-launch Word |
| `ERR_CERT_AUTHORITY_INVALID` in dev | Same as above | same fix |
| 401s on every request | Backend reachable but JWT rejected | Re-login; verify `SIGN_API_URL` matches the backend you're authenticated against |
| `AuthRequiredError` loops | Refresh-token clock skew | Sign out → sign in. If persistent, check the backend's JWT clock |
| Highlights don't appear | Word.ContentControls don't anchor (Word Online on a protected document) | Ensure the document is editable and not opened in protected view |
| `Sideload failed: manifest invalid` | Stale icon paths or non-HTTPS URLs | `npm run validate` and read the report; fix `manifest.xml` |
| Risk analysis times out at 60s | AI backend slow under load | Click **Retry** — the polling ceiling is intentional, the job often completes shortly after |
| Chat: copy-to-document inserts at wrong place | User moved the cursor between sending and copying | Click in the document where you want the text first, then **Copy to document** |

---

## What's not in v0.1

- Document SSO (`OfficeRuntime.auth.getAccessToken`) — uses email/password instead.
- Production hosting — local-only, dev cert.
- Negotiation timeline UI — backend endpoint exists, web-app frontend lands in Phase 4.
- Track-changes integration on clause replacement — current behavior is a hard `insertText("Replace")` inside the content control.
- Bulk multi-document workflows — one document at a time.

---

Powered by **CENVOX** — Build Smarter. Deliver Certain.
