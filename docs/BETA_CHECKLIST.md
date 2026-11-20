# 10-person beta checklist (points game only)

Goal: learn whether people come back daily. No real money is involved. Work through each section in order and tick it off.

## A. Before inviting anyone

- [ ] Production deployed from `main` following `docs/DEPLOY.md`, steps 1–9.
- [ ] `https://nightshift.buzz/api/ops/health` returns **200**:
  - `redis`, `email`, `playSecret`, `cronSecret` and `schedulerPlay` are all `true`;
  - `testMode` is `false`.
- [ ] The scheduler has run for at least **one full trading day**:
  - a round locked at 16:00 ET;
  - the evening call was taken at 20:00 ET;
  - the round settled after 09:30 ET.
  - Check `jobs.*.lastOkAt` in health and your own pick's result.
- [ ] Smoke test against production: `CRON_SECRET=… SMOKE_EMAIL=<you> node scripts/smoke.mjs https://nightshift.buzz` shows 0 failed.
- [ ] You received a real results email and its **unsubscribe** link worked.
- [ ] Share card checked by pasting one share link into X and Telegram: the preview image shows.
- [ ] Uptime monitor on `/api/ops/health` alerts you (test it once by pausing the scheduler for 20 minutes).
- [ ] Privacy and Terms:
  - **contact address filled in** (currently a placeholder);
  - legal review requested (the pages say "draft").
- [ ] `X_POSTING` unset (no automated X posts). No real-stakes promotion anywhere in the beta invite.
- [ ] You know the kill switches: `PLAY_REMINDERS=off` and Vercel rollback.

## B. Inviting the 10

- [ ] Pick 10 people who'd plausibly check a market game daily. Mix them: at least 3 in India and 3 in another time zone, so the ET timing gets tested.
- [ ] Send each one the invite below and ask them to **save their progress** (email sign-in) on day 1, so they're on the leaderboard.

> I'm testing a free game: each day, guess whether Nvidia, Apple, Tesla, the S&P 500 and gold will open up or down, and try to beat our AI's overnight call. Points only, no money, takes 30 seconds a day. Link: https://nightshift.buzz/app#predict. Please play for a week and tell me what annoyed you.

- [ ] Note each tester's **nickname** (not their email) in your own tracking sheet.

## C. Every trading day (≈5 minutes)

| When (ET) | Check |
|---|---|
| 09:45 | Yesterday's round settled (history shows results) and results emails went out (`reminder_sent` in metrics) |
| 16:05 | The round locked and a new one is open |
| 20:10 | Beat the AI call is up (`jobs.aiCall.lastSummary` shows `taken: true`, or the game shows the call) |
| Any time | `GET /api/ops/errors` (Bearer) has no new errors you don't understand |

## D. What to measure (`GET /api/ops/metrics?days=14`, Bearer)

| Metric | Where | Healthy for a 10-person beta |
|---|---|---|
| Day-1 return | `cohorts[].d1 / users` | ≥ 50% |
| Day-7 return | `cohorts[].d7 / users` | ≥ 30% |
| Picks per player per day | `daily[].picksPerPicker` | ≥ 3 (of 5 assets) |
| Sign-up rate | `signup` ÷ distinct players | ≥ 70% (you asked them to) |
| Shares | `share_created` | any is a good sign |
| Reminder clicks | `reminder_click` ÷ `reminder_sent` | ≥ 20% |

These are starting targets for a small, hand-picked group, not industry benchmarks. Adjust after the first week.

## E. Ask testers (end of week 1)

1. What made you come back, or not, on day 2?
2. Was anything confusing about "up or down vs the close" or "above or below Nightshift's call"?
3. Were the reminder emails useful, annoying, or wrongly timed for your time zone?
4. Would you share a result card? Why or why not?
5. What would make you play every day?

## F. When to stop or pause

- Settlement is wrong (a result doesn't match the real open): pause by telling testers, fix, re-settle if needed.
- Emails go to the wrong people or too often: set `PLAY_REMINDERS=off` immediately.
- A data leak or a security doubt: take the site down (Vercel → pause the project) and investigate.

## G. Exit criteria to widen the beta

- [ ] 2 weeks with no settlement errors and no unexplained server errors.
- [ ] Day-7 return ≥ 30% in at least one cohort.
- [ ] Legal review of Privacy and Terms done.
- [ ] Decision on a licensed price feed (Yahoo is unofficial and throttles).
