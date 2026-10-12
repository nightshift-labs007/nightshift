# NIGHTSHIFT: Use AI to fight AI

Concept demo of an AI-guarded price oracle and lending protocol for tokenized ETFs on Robinhood Chain.
Runs entirely on free tiers (Vercel Hobby, public market data, Algorand TestNet).

Full technical write-up for developers: [docs/TECHNICAL.md](docs/TECHNICAL.md). Testnet go-live steps: [docs/TESTNET.md](docs/TESTNET.md).

## What's in the demo

| Unit | Status | How |
|---|---|---|
| 01 Oracle | **Live** | 4 signal models (anchor futures/BTC/gold, Asia+Europe indices, momentum, Fear & Greed) → weighted fair value + confidence for SPY, QQQ, GLD, IBIT. `/api/oracle` |
| Shift report | **Live** | Replays the anchor signal over the last 10 opens vs the real open and vs a frozen "last close" feed. `/api/shift-report` |
| 02 Vault + 03 Guardian | **Paper trading** | Working paper account (browser): open, borrow, repay, add/withdraw collateral, close. Positions are marked to the live Oracle under Morpho Blue rules; the Guardian checks every loan on each Oracle update and alerts or auto-repays. |
| 04 Cloak | **Real ZK proof** | Groth16 circuit proves `collateral × Oracle price × LLTV > debt` and `commitment = Poseidon(collateral, debt, salt)` without revealing collateral or debt. Proof is generated in the visitor's browser; `/api/zk/verify` checks it independently and also checks the proven price matches the live Oracle. |
| 05 Ledger | **Live (optional)** | Daily Vercel Cron stamps predicted opens onto Algorand TestNet; the page reads them back and grades them. `/api/commit`, `/api/ledger` |

Market data comes from public Yahoo Finance endpoints. If a feed is blocked, that unit falls back to clearly-labelled simulated data, so the site never breaks.

## Project layout

```
app/
  page.tsx               page shell
  api/oracle             live fair values
  api/shift-report       prediction-vs-open backtest
  api/commit             cron: lock predictions on Algorand (needs CRON_SECRET)
  api/ledger             read stamped predictions back + grade them
components/              UI sections (OracleBoard, ShiftReport, VaultGuardian, Cloak, Ledger)
lib/
  config.ts              ETF pairs, anchors, agent weights, LLTVs
  data.ts                market data fetch + simulation fallback
  oracle.ts              signal models → fair value + confidence
  backtest.ts            shift report
  algorand.ts            TestNet stamping / reading
vercel.json              daily cron (weekdays 12:00 UTC, before the US open)
zk/solvency.circom       Cloak circuit source (918 constraints)
public/roboky/           Roboky N—01 sentinel hero (embedded via iframe; media split out of ROBOKY-NIGHTFALL-MOTION.html)
public/fonts/            Neue + Mono fonts shared by the sentinel and the site theme
public/zk/               compiled circuit, proving key, verification key, snarkjs (served to the browser)
app/api/zk/verify        server-side proof verifier
```

### The ZK circuit
- **Proves:** health factor > 1 at the Oracle price, for a position bound to a Poseidon commitment.
- **Public:** Oracle price (cents), market LLTV (bps), commitment. **Private:** collateral, debt, salt.
- **Trusted setup:** phase 1 = PSE Perpetual Powers of Tau (80-contributor public ceremony); phase 2 = a single demo contribution. Fine for a demo; production needs a multi-party phase-2 ceremony.
- The compiled artifacts are committed in `public/zk`, so Vercel doesn't need to compile anything. Only run `npm run zk:build` if you change `zk/solvency.circom`.

---

## Step-by-step: run locally

> On this machine Node is installed at `C:\Program Files\nodejs` but isn't on PATH. Either reinstall Node 20+ from nodejs.org with "Add to PATH" ticked, or run this in PowerShell first: `$env:Path = "C:\Program Files\nodejs;" + $env:Path`

```powershell
cd C:\Users\saura\Project\Night_shift
npm install
npm run dev
```

Open http://localhost:3000.

## Step-by-step: deploy to Vercel (free)

### 1. Put the code on GitHub
1. Create an empty **private** repo on github.com, e.g. `nightshift` (no README, no .gitignore).
2. In the project folder:
   ```powershell
   git init
   git add .
   git commit -m "Nightshift concept demo"
   git branch -M main
   git remote add origin https://github.com/<your-username>/nightshift.git
   git push -u origin main
   ```
   `.gitignore` already excludes `node_modules`, `.next` and `.env*`, so no secrets get pushed.

### 2. Import into Vercel
1. Sign up at https://vercel.com with your GitHub account (Hobby plan = free).
2. **Add New… → Project → Import** your `nightshift` repo.
3. Framework preset: **Next.js** (auto-detected). Leave build settings as default.
4. Click **Deploy**. About 1 minute later you get `https://nightshift-xxxx.vercel.app`.

At this point the Oracle, Shift Report, Vault/Guardian and Cloak all work. The Ledger section shows "offline" until step 3.

### 3. (Optional) Turn on the Algorand Ledger
1. Generate a TestNet account locally:
   ```powershell
   npm run algo:account
   ```
   It prints an **address** and a **25-word mnemonic**. Keep the mnemonic secret: it's TestNet only, but it's still the key.
2. Fund the address with free TestNet ALGO: https://lora.algokit.io/testnet/fund (sign in with GitHub). 10 ALGO lasts years: each stamp costs 0.001.
3. Generate a cron secret (any long random string):
   ```powershell
   [guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N")
   ```
4. In Vercel: **Project → Settings → Environment Variables**, add for *Production*:
   - `ALGORAND_MNEMONIC` = the 25 words
   - `CRON_SECRET` = the random string
5. **Deployments → ⋯ → Redeploy** so the variables take effect.
6. Test it once by hand:
   ```powershell
   curl.exe -H "Authorization: Bearer <CRON_SECRET>" https://<your-app>.vercel.app/api/commit
   ```
   You should get `"committed": true` and an explorer link. Refresh the site: the stamp appears in **The Ledger**, and the "Actual open" column fills in after that session opens.
7. From then on, Vercel Cron calls `/api/commit` every weekday around 12:00 UTC (before the 09:30 ET open). Check runs under **Project → Settings → Cron Jobs**.

### 4. Later updates
Every `git push` to `main` redeploys automatically. Pushes to other branches get their own preview URLs.

### 5. (Optional) Custom domain
**Project → Settings → Domains → Add.** Free on Hobby if you already own the domain.

---

## Free-tier notes
- **Vercel Hobby** is for non-commercial use. Cron jobs run at most once a day, and timing is only accurate to the hour. Fine for this demo.
- API responses are CDN-cached (oracle 60s, shift report 10 min), so traffic spikes don't hammer the data sources.
- Yahoo Finance endpoints are unofficial. If they start blocking Vercel's IPs, the site keeps working on simulated data, labelled as such.

## Disclaimers
Concept demonstration only. Oracle values are data, not investment advice. Vault and Guardian are simulations and the Cloak proves over demo positions; no funds are handled. Stock Tokens are not available to US persons.
