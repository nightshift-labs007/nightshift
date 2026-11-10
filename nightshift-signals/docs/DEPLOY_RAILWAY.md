# Deploying the backend on Railway

The backend is two long-running processes from this folder, built from one image (`Dockerfile`):

| Railway service | Config file | What it runs | Public domain |
|---|---|---|---|
| `api` | `railway.api.json` | Hono REST `/v1`, WebSocket `/ws`, health check `/health` | yes |
| `worker` | `railway.worker.json` | ingest → triage → map → size → commit → publish, crons, grading | no |

Both need **Postgres with pgvector** and **Redis**. They talk only through Redis Streams and share Postgres.
The web app stays on Vercel; the root site (`nightshift.buzz`) is unaffected (`.vercelignore` skips this folder).

## 1. Create the project and data services

1. New Railway project → **Deploy from GitHub repo** → `nightshift-labs007/nightshift`. (That first service becomes `api`; see step 2.)
2. **+ New → Template → `pgvector`** (Postgres with the pgvector extension). The default Railway Postgres image
   does not include pgvector, and migration `0000_enable_pgvector.sql` runs `CREATE EXTENSION vector`.
3. **+ New → Database → Redis.**

## 2. Configure the two app services

Create a second service from the same repo for the worker. Then, for **each** service, open **Settings**:

| Setting | `api` | `worker` |
|---|---|---|
| Root Directory | `/nightshift-signals` | `/nightshift-signals` |
| Config-as-code file path | `/nightshift-signals/railway.api.json` | `/nightshift-signals/railway.worker.json` |
| Networking | **Generate Domain** | none |
| Watch paths (optional) | `/nightshift-signals/**` | `/nightshift-signals/**` |

The config file path is absolute from the repo root; Railway does not resolve it relative to the Root Directory.
Watch paths stop pushes to the main site from redeploying the backend.

Keep the worker at **1 replica**: it owns the cron schedules, so a second copy would ingest and grade twice.
The api can scale horizontally.

## 3. Variables

Set these on **both** services. A shared variable group is easiest.

```
DATABASE_URL=${{pgvector.DATABASE_URL}}          # use the name of your Postgres service
REDIS_URL=${{Redis.REDIS_URL}}?family=0          # family=0 lets ioredis resolve Railway's IPv6 private network
NIGHTSHIFT_SIGNALS_MODE=live                     # or "local" for a simulated staging stack (see below)
APP_URL=https://<your web app domain>
JWT_SECRET=<32+ random chars, same value on api and worker>
```

**Live mode** also requires these (the process exits on boot if any is missing; values come from official
Robinhood Chain / Uniswap docs, never guesses):
`ANTHROPIC_API_KEY, ROBINHOOD_CHAIN_RPC_URL, ROBINHOOD_CHAIN_ID, LEDGER_CONTRACT_ADDRESS, COMMITTER_PRIVATE_KEY,
UNISWAP_QUOTER_ADDRESS, USDG_ADDRESS, TOKEN_REGISTRY`.

Optional, as in `.env.example`: `VOYAGE_API_KEY`, `VAPID_*` (web push; **required for push in live mode**,
since keys are only auto-generated in local mode), `TELEGRAM_*`, `X_*`, `ELEVENLABS_*`, `APNS_*`, `EXPO_ACCESS_TOKEN`,
`UNISWAP_CHAIN_SLUG`, `MAX_SLIP_BPS`, `MIN_POOL_LIQUIDITY_USDG`.
`APNS_PRIVATE_KEY` can be pasted with literal `\n` for newlines.

`api` only:
```
API_PUBLIC_URL=https://<api service domain>      # for `pnpm telegram:setup`
```
Do **not** set `PORT` or `API_PORT`; Railway injects `PORT` and the api listens on it.

**Staging without vendor keys:** `NIGHTSHIFT_SIGNALS_MODE=local` with the real Postgres and Redis runs a simulated
market, ledger and scripted headlines. Everything is labeled simulated. Don't leave `DATABASE_URL` unset:
it would fall back to embedded PGlite inside each container, and the services would not share data.

## 4. Deploy and verify

- Migrations run on boot in both services, behind a Postgres advisory lock, so whichever starts first applies them.
- `api` is healthy when `GET https://<api domain>/health` returns `{"ok":true,"mode":"live"}`.
- `worker` logs `[worker] up in live mode`.
- OpenAPI: `https://<api domain>/v1/openapi.json`. WebSocket: `wss://<api domain>/ws`.

## 5. Point the clients at it

- Web (Vercel, `apps/web`): `NEXT_PUBLIC_API_URL=https://<api domain>`, `NEXT_PUBLIC_APP_URL=<web domain>`.
- Mobile (`apps/mobile`): `EXPO_PUBLIC_API_URL=https://<api domain>`.
- Telegram webhook: run `pnpm telegram:setup` locally with `API_PUBLIC_URL` set to the api domain.
