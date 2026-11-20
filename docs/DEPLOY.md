# Deploying Nightshift: runbook

How to take this repo from a laptop to a live site for the points-game beta. Do the steps **in order**: each one assumes the previous ones are done.

Written 2026-11-21 for the state of `main` after Phase 3.5. Real-money features are out of scope; don't turn any on.

## 0. What runs where

| Piece | What it does | Service |
|---|---|---|
| Web app + API | Next.js 15 (pages, `/api/*`) | Vercel (or any Node 22 host) |
| Game data | picks, results, accounts, reminders, rate limits, heartbeats, analytics | Upstash Redis |
| Email | sign-in codes, reminder emails | Resend |
| Scheduler | calls the job endpoints on time | cron-job.org (free) |
| Uptime alerts | watches `/api/ops/health` | UptimeRobot, Better Stack or similar (free tier) |
| Prices | official close and open for settlement | Yahoo by default (`lib/prices`); a licensed feed can replace it |

**Current status (2026-11-20):** nightshift.buzz returns `402 DEPLOYMENT_DISABLED` from Vercel. The owner of the Vercel account has to resolve that first (billing or plan limits), or create a new project.
- Vercel's Hobby plan only allows **daily** cron jobs, which is why the scheduler below runs outside Vercel.
- Check whether Vercel's Hobby plan terms allow this use. They are written for personal, non-commercial projects; if in doubt, use Pro.

## 1. Generate two secrets

```bash
node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))'   # run twice
```

- `CRON_SECRET`: lets the scheduler call the job endpoints; also unlocks `/api/ops/metrics` and `/api/ops/errors`.
- `PLAY_SECRET`: signs sign-in codes, unsubscribe links and share cards.

Use **different** values. Store them in a password manager.
- Changing `PLAY_SECRET` invalidates existing share links and unsubscribe links.
- Changing `CRON_SECRET` means updating the scheduler too.

## 2. Upstash Redis

1. Create **two** databases, in the region closest to the hosting region:
   - `nightshift-prod`;
   - `nightshift-preview`, so test data never mixes with real players.
2. Copy each one's REST URL and token.

Vercel's Upstash integration sets `KV_REST_API_URL` and `KV_REST_API_TOKEN` instead of `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`; the code accepts either pair. Without Redis the game falls back to memory and **loses everything on every restart**, and `/api/ops/health` reports `redis: false`.

## 3. Resend (email)

1. In Resend, go to **Domains**, then **Add domain**, and enter `nightshift.buzz`. Add the DNS records it shows (SPF, DKIM, and the MX for bounces), then wait until the domain is verified.
2. Create an API key with **send-only** access.
3. Sender: `RESEND_FROM="Nightshift <hello@nightshift.buzz>"`. A personal mailbox (gmail.com, outlook.com …) can't be a sender; the code falls back to the address above.

Without Resend, sign-in says "Email isn't set up on this server yet" and no reminders go out.

## 4. Optional services

| Service | Settings | Why |
|---|---|---|
| Cloudflare Turnstile | `TURNSTILE_SECRET_KEY`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | A bot check on the sign-in form. Recommended if fake sign-ups appear. |
| Twelve Data | `TWELVEDATA_API_KEY` | Fallback for the live price board when Yahoo throttles. Settlement still uses `lib/prices`. |
| Telegram | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Keeper alerts. |

## 5. Environment variables

Set these in Vercel under **Project → Settings → Environment Variables**, choosing the scope for each. Values pasted with quotes are tolerated.

### Required for the points-game beta

| Variable | Production | Preview | Notes |
|---|---|---|---|
| `CRON_SECRET` | ✅ | ✅ (its own value) | 32+ chars |
| `PLAY_SECRET` | ✅ | ✅ (its own value) | 32+ chars |
| `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` | ✅ prod DB | ✅ **preview DB** | or the `KV_REST_API_*` pair |
| `RESEND_API_KEY` | ✅ | optional | Without it, a preview in test mode uses the dev outbox instead |
| `RESEND_FROM` | ✅ | with the key | |
| `SITE_URL` | ✅ `https://nightshift.buzz` | leave unset | Previews use their own URL automatically |
| `PLAY_TEST_MODE` | ❌ **never** | `1` | Turns on the test clock and dev outbox for the smoke test. Ignored in production even if set. |

### Leave unset (or as stated)

| Variable | Why |
|---|---|
| `X_POSTING` | X posting is off unless this is `on`. Keep it off until decided. |
| `PLAY_REMINDERS` | Set to `off` only to pause every reminder email (kill switch). |
| `PRICE_PROVIDER` | Defaults to `yahoo`. Change only when a licensed feed is added. |

### Other features (not needed for the points game)

`ORACLE_UPDATER_PRIVATE_KEY`, `KEEPER_PRIVATE_KEY`, `FAUCET_PRIVATE_KEY` (on-chain keeper and faucet), `ANTHROPIC_API_KEY` (news signal), `GROQ_API_KEY` (Nyx voice), `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`, `PRIVY_APP_SECRET`, `SENTORA_*`, `ETH_RPC_URL`, `X_API_*`, `X_ACCESS_*`. See `.env.example`.
- If the on-chain keys are set, `/api/ops/health` also requires the keeper scheduler.
- **The on-chain keys control contracts that hold real USDC (the prediction rounds). Don't add them for this beta unless that's decided.**

## 6. Deploy a preview and run the smoke test

1. Push a branch, or open a pull request, so Vercel builds a **preview** deployment with the Preview variables above, including `PLAY_TEST_MODE=1`.
2. From a laptop:
   ```bash
   CRON_SECRET=<preview secret> node scripts/smoke.mjs https://<preview-url>
   ```
3. Expect **0 failed**. On a preview with test mode, the script runs the full cycle on a past round: sign in → pick → lock at the close → settle from real prices → results email. That email lands in the dev outbox if Resend isn't set on Preview; otherwise check the inbox.
4. Also test real email delivery once:
   ```bash
   SMOKE_EMAIL=<your inbox> CRON_SECRET=… node scripts/smoke.mjs https://<preview-url>
   ```
   The script asks for the code from the email.

A "skip" line means a check couldn't run (for example, prices rate-limited). Read it rather than ignoring it.

## 7. Go to production

1. Deploy `main` to production with the Production variables. Make sure `PLAY_TEST_MODE` isn't set there; it's ignored anyway, but keep it clean.
2. Run the smoke test against production:
   ```bash
   CRON_SECRET=<prod secret> SMOKE_EMAIL=<you> node scripts/smoke.mjs https://nightshift.buzz
   ```
   It runs the production-safety checks instead of the test cycle: the dev outbox and test routes return 404, the test clock is ignored, and metrics need the secret.

## 8. Scheduler (cron-job.org)

Create two jobs. For each, use method GET, add the header `Authorization: Bearer <CRON_SECRET>`, set the timeout to 60 s, and turn on failure notifications.

| Job | URL | Every | Runs |
|---|---|---|---|
| Points games | `https://nightshift.buzz/api/jobs/play` | 5 min | Nightshift's 20:00 ET call (Beat the AI), settling rounds after the open, reminder emails |
| On-chain keeper | `https://nightshift.buzz/api/keeper` | 10 min | Oracle prices, Guardian, Stack, Call the Open rounds. Only does real work if its keys are set. |

- Each job records a heartbeat. `/api/ops/health` shows `lastScheduledAt`, `lastOkAt` and `lastError` for each, and marks a job **stale** after three missed intervals.
- Page loads also run the game jobs as a backstop, but those runs don't count toward "not stale", so a stopped scheduler can't hide.
- `vercel.json` keeps two daily Vercel crons (`/api/commit` and `/api/keeper`); Vercel sends the `CRON_SECRET` automatically. They're a backup, not the schedule.

## 9. Monitoring

| What | Where | Who can see it |
|---|---|---|
| Ready / not ready | `GET /api/ops/health`: 200 when ready, 503 when not (`?soft=1` always returns 200) | public (booleans and timestamps only) |
| Last 50 errors (server and browser, scrubbed) | `GET /api/ops/errors` | `Authorization: Bearer <CRON_SECRET>` |
| Beta metrics | `GET /api/ops/metrics?days=14` | Bearer `CRON_SECRET` |
| Older health page (oracle, wallets) | `GET /api/health` | public |

- **Uptime monitor:** add one check on `https://nightshift.buzz/api/ops/health` every 5 minutes, alerting on anything but 200, and one on `https://nightshift.buzz/`.
- **Metrics:** visits, picks, sign-ups, codes sent, shares created and viewed, reminders sent and clicked, active players, picks per player, and day-1 / day-7 return by first-seen cohort.
  - Reminder **clicks** are counted through `/r/{kind}` links. Opens aren't tracked (pixels are unreliable and more invasive).
  - Share views include link-preview bots, so treat them as an upper bound.
- **Errors:** server errors come through `instrumentation.ts`, browser errors through `components/ErrorReporter.tsx`. There's no third-party service. To add Sentry later, install `@sentry/nextjs` and call it from `instrumentation.ts`.

## 10. Abuse limits (already in the code)

| What | Limit |
|---|---|
| Sign-in codes per IP | 10 per hour, 20 per day |
| Sign-in codes per address | 3 per 10 minutes, 5 per day |
| Emails of any kind per address | 10 per day |
| Code checks per IP | 20 per 10 minutes; 5 wrong tries kill a code |
| Picks per IP | 60 per minute, 2,000 per day |
| Pick changes per player | 120 per hour |
| Share links per player | 30 per hour |
| Browser error reports per IP | 20 per 10 minutes |

These are durable only with Redis. Without it they're per server instance and reset on restart. Turnstile (step 4) adds a bot check to sign-in.

## 11. When something goes wrong

| Symptom | Do this |
|---|---|
| `/api/ops/health` 503 with `schedulerPlay: false` | Check cron-job.org's history and the job's `lastError`. Run the job by hand with curl and the Bearer header. |
| Rounds stuck "waiting" after the open | `prices.coolingDown` in health shows a throttled source. Rounds retry by themselves and void after 72 h. Consider `TWELVEDATA_API_KEY` or a licensed feed. |
| Reminder emails misfiring | Set `PLAY_REMINDERS=off` and redeploy (or just change the setting; Vercel needs a redeploy). |
| A bad deploy | Vercel → Deployments → the previous good one → **Promote** (instant rollback). |
| Abuse or spam sign-ups | Turn on Turnstile (step 4). Look at `/api/ops/metrics` for spikes in `code_sent`. |
| Offensive nickname | Rename it in Redis (`play:nick` hash plus the account's `nick`) or delete the account (`lib/play/account.ts` `deleteAccount`). There's no admin page yet. |

## 12. Before inviting anyone

Follow `docs/BETA_CHECKLIST.md`.
