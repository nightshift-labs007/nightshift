# Split hosting: frontend on Vercel, backend on Railway

The site is one Next.js app. It is deployed twice from the same repo, and each copy plays one role:

| | Vercel (frontend) | Railway (backend) |
|---|---|---|
| Serves | every page | every `/api/*` route |
| Domain | `nightshift.buzz` (unchanged, no DNS move) | `<service>.up.railway.app` |
| Server secrets | none needed | all of them |

`middleware.ts` does the routing. When `BACKEND_URL` is set (Vercel), every `/api/*` request is forwarded to Railway
under the same origin, so the browser's relative `fetch("/api/…")` calls and the session cookies on `nightshift.buzz`
keep working, with no CORS. The forwarded request carries `BACKEND_PROXY_SECRET`. Railway answers `/api` only when it
matches, so the backend can't be called directly to skip the per-IP rate limits. The one exception is `/api/ping`,
the liveness probe. The visitor's IP is passed along for those rate limits.

The Nightshift Signals services (`nightshift-signals/`, see its `docs/DEPLOY_RAILWAY.md`) are separate and unaffected.

## 1. Railway: the backend service

1. In the Railway project: **+ New → GitHub Repo → `nightshift-labs007/nightshift`**.
   Leave **Root Directory empty** (repo root). `railway.json` at the root sets the build, start and the `/api/ping` health check.
2. **Variables:** copy every variable from Vercel (`vercel env pull .env.railway` downloads them; then paste them into the Raw
   Editor), then add `BACKEND_PROXY_SECRET`. Don't set `BACKEND_URL` or `PORT` here.
3. **Networking → Generate Domain.**
4. **Watch paths (optional):** `!nightshift-signals/**` keeps Signals-only pushes from rebuilding the site.

Checks:
- `https://<railway domain>/api/ping` → `{"ok":true}`
- `https://<railway domain>/api/health` → `404` (refused: no proxy secret, which is correct)

### Variables the backend reads
Set whichever you use today. Each feature switches itself off when its variables are missing.

```
CRON_SECRET                      scheduled jobs + profile sessions (16+ chars)
BACKEND_PROXY_SECRET             same value as on Vercel
ORACLE_UPDATER_PRIVATE_KEY       KEEPER_PRIVATE_KEY      FAUCET_PRIVATE_KEY
BASE_RPC_URL                     ETH_RPC_URL             PRICE_STALE_MINUTES
ANTHROPIC_API_KEY                NEWS_MODEL
GROQ_API_KEY                     NYX_MODEL
TWELVEDATA_API_KEY
UPSTASH_REDIS_REST_URL           UPSTASH_REDIS_REST_TOKEN    (or KV_REST_API_URL / KV_REST_API_TOKEN)
PRIVY_APP_SECRET                 NEXT_PUBLIC_PRIVY_APP_ID
RESEND_API_KEY                   RESEND_FROM
TURNSTILE_SECRET_KEY             NEXT_PUBLIC_TURNSTILE_SITE_KEY
TELEGRAM_BOT_TOKEN               TELEGRAM_CHAT_ID
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
SENTORA_VAULT_ADDRESS  SENTORA_VAULT_CONFIRMED  SENTORA_FIRELIGHT_COVER  SENTORA_VAULT_NAME
SENTORA_LLAMA_POOL     SENTORA_DEPOSIT_URL      SENTORA_APY_7D           SENTORA_APY_AS_OF
```
`ALGORAND_MNEMONIC`, if you have it set on Vercel, goes here too.

## 2. Vercel: switch the frontend over

1. Add `BACKEND_URL=https://<railway domain>` and the same `BACKEND_PROXY_SECRET`.
2. Redeploy. These are read by the middleware, so a redeploy is needed.
3. Check `https://nightshift.buzz/api/health`: it is now answered by Railway (the Railway deploy logs show the request).
   Then sign in, open a stock page, and try the Nyx voice question, the faucet and an avatar upload.

**Rollback:** delete `BACKEND_URL` on Vercel and redeploy; the API routes are still in the Vercel build.

Once it has run cleanly for a while, remove the server secrets from Vercel. Keep `NEXT_PUBLIC_*`, `BACKEND_URL`
and `BACKEND_PROXY_SECRET`.

## 3. Scheduled jobs (cron-job.org)

`vercel.json` no longer has crons; every schedule lives on cron-job.org and calls `nightshift.buzz`, which forwards to
Railway. Each job sends the header `Authorization: Bearer <CRON_SECRET>`.

| Job | URL | Schedule |
|---|---|---|
| Keeper (already there) | `https://nightshift.buzz/api/keeper` | every 10 minutes |
| Commit (new, was a Vercel cron) | `https://nightshift.buzz/api/commit` | weekdays 12:00 UTC |
| ~~Hourly X post~~ | ~~`/api/x/post?slot=hourly`~~ | **delete this job**; the route no longer exists |

The X agent has been removed entirely: the `/api/x/*` routes, `lib/x*.ts`, the `x-agent` workflow and the `X_*` variables.
Delete the `X_*` variables from Vercel too.
