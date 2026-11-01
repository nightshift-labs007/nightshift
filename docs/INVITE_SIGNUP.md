# Invite-only sign-up

## The flow

1. **Browse and connect.** Anyone can see the whole site and connect a wallet. On connect, the wallet is counted as a user (`users:seen`) and listed on the leaderboard as **Connected**.
2. **Sign in.** The user signs one free message (no transaction), which gives a 7-day session.
3. **Invite code.** The user enters a code like `NS-7KQ2-M9XD`. Each code has a use limit; a wallet uses one code, once.
4. **Email.** The user enters an email and gets a 6-digit code through Resend. The code expires in 10 minutes and allows 5 tries. One email can belong to one wallet only.
5. **Username and profile.** The user picks a unique username (3 to 20 characters: `a-z`, `0-9`, `_`), and optionally adds a name, photo, X, Telegram, website and bio. Saving registers the wallet: it gets **Registered**, +15 points and its username on the leaderboard.

**What needs sign-up:** Borrow *with wallet*, Stack, the test-funds faucet, and profile photos. Practice mode (no wallet) and every read-only page stay open to everyone.

## Switching it on

The gate turns on only when all of these are set in Vercel (Production):

| Variable | Value |
|---|---|
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | already set |
| `CRON_SECRET` | already set |
| `RESEND_API_KEY` | the Resend key (send-only is enough) |
| `RESEND_FROM` | for example `Nightshift <hello@nightshift.buzz>`, on a domain verified in Resend |

Until then, the gate stays open, so nobody is locked out.

**Verify the domain first.** In Resend, go to **Domains**, then **Add domain**, enter `nightshift.buzz`, and add the DNS records it shows (SPF, DKIM and an MX for bounces). The sender `onboarding@resend.dev` works without a domain, but it only delivers to the Resend account owner's own inbox.

## Invite codes (team)

```
node --env-file=.env.local scripts/invites.mjs create 10 1 "first wave"     # 10 single-use codes
node --env-file=.env.local scripts/invites.mjs create 1 50 "X giveaway"     # one code, 50 seats
node --env-file=.env.local scripts/invites.mjs list                         # seats used, by which wallets
```

The script calls `/api/admin/invites` on nightshift.buzz with `CRON_SECRET`. Set `SITE_URL` to target a local server instead.

## Storage (Upstash Redis)

| Key | What it holds |
|---|---|
| `users:seen` | address → first connect time |
| `members` | address → registration time |
| `member:<address>` | the invite used, and the verified email. Written only by the server. |
| `invite:<CODE>`, `invite-uses:<CODE>`, `invites` | codes, seats, and who used them |
| `username:<name>`, `email-owner:<email>` | uniqueness locks |
| `otp:<address>` | the hashed email code. Expires after 10 minutes. |

Deleting a profile frees the username and email. The invite stays used, so coming back means verifying the email again.

## Tests

`scripts/test-signup.mjs` runs 45 end-to-end checks against a local server and an in-memory Upstash stand-in (`scripts/mock-upstash.mjs`). The steps are in the script header.
