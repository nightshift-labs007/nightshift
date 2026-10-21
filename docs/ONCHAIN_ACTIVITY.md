# On-chain activity and transparency: what was built

Status as of 2026-10-21. Everything below is live on `main` unless marked otherwise.

## Why

The ask: show a footprint on-chain that the product works (Vaults, Borrow, Earn and so on), and make every transaction visible in one place.

## What was built

| Item | Where | Notes |
|---|---|---|
| **Transactions page** | `/transactions`, `lib/transactions.ts`, `components/Transactions.tsx` | One newest-first list of the latest 200 transactions: Vault deposits, borrows, repayments, withdrawals, Guardian rules and saves, liquidations, Oracle price updates, Cloak proofs, faucet mints (Base) and prediction stamps and leaderboard joins (Algorand). Each row links to its explorer. Filter by type. Nothing is stored by the site; rows are read from the chains. |
| **Leaderboard includes Nightshift's own services** | `/leaderboard`, `lib/leaderboard.ts` | Oracle Updater, Guardian Keeper, Faucet and the Algorand Ledger are ranked in the same table, scored one point per transaction sent. The stats at the top count people only. |
| **Team demo wallets** | `scripts/demo-activity.mjs`, `lib/team-wallets.ts` | Three wallets ran the full Vault loop on Base mainnet: faucet, deposit, borrow, Guardian rule on, repay, withdraw (about 24 real transactions, demo assets only). They are labelled "Team demo wallet" on the leaderboard and "Team" on Transactions. Private keys are in the git-ignored `.env.local` and are not in the repo. |
| **Proof of activity panel** | `/transparency#activity`, `ActivityProof` in `components/Transactions.tsx` | A count and a latest-transaction link for every flow, counted from Base and Algorand. States that part of the activity is the team's labelled wallets. |

## Team demo wallets (public addresses)

- `0x00d1fc81629c9309F10F76827ce02bEE758fB700`: SPY loop
- `0x191a0A09D4185d13044e2989C62764612368B351`: QQQ loop
- `0x88799e8FD1c139B7b60540e10eC63DfE34F92415`: GLD loop

Each holds an open, healthy loan (health factor about 7) with Guardian protection on.

## Known limits

- **Base history is short on free RPCs.** Free public Base nodes only serve recent logs (about the last few hours when tested), so Base transaction rows, counts and service scores cover that window. The pages state the start time. Set `BASE_RPC_URL` to a keyed archive RPC (for example Alchemy) in Vercel to reach back to launch. Algorand history is complete.
- **Earn has no on-chain footprint of ours.** Earn is a read-only view of a Sentora vault on Ethereum mainnet. Nightshift never touches those funds. A deposit would need real PYUSD and Ethereum gas, and is not done. Describe Earn as a live data view, not a transacting product.
- The previous Vault (before the security upgrade) is not included in the Transactions list.

## Deliberately not done

- No fake or unlabelled "users". Activity from our own wallets is real but is labelled as the team's.

## Re-running the activity loop

```
node --env-file=.env.local scripts/demo-activity.mjs <1|2|3> [SPY|QQQ|GLD|IBIT] [resume-from-step 0-7]
```

The token faucet allows one claim per token per hour per wallet, so a repeat loop on the same token deposits what the wallet already holds.
