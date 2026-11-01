# Going live on testnet (all free)

## Current deployment: Base Sepolia + Algorand TestNet (since 2026-11-01)

Base mainnet is retired (its record is kept in `lib/chain/deployment-base-mainnet.json`). The two chains have separate jobs:

- **Base Sepolia (chain 84532):** the product. Vault and Guardian, Stack, Cloak proofs, test tokens, Morpho-style adapters and Chainlink-style feeds.
- **Algorand TestNet:** the public record. Pre-open prediction stamps, leaderboard joins, proof-manifest anchors, and the Algorand Oracle app.

| Contract | Address |
|---|---|
| tUSDG | [`0xc86322b80a84ebf428daea6976ac65e500776930`](https://sepolia.basescan.org/address/0xc86322b80a84ebf428daea6976ac65e500776930) |
| NightshiftOracle | [`0xb4ccde5d8497c568d8b41249bfa3b560d9ac1acc`](https://sepolia.basescan.org/address/0xb4ccde5d8497c568d8b41249bfa3b560d9ac1acc) |
| NightshiftVault | [`0xbf565f01a9534175d21aeb12f0a94052b8eed1be`](https://sepolia.basescan.org/address/0xbf565f01a9534175d21aeb12f0a94052b8eed1be) |
| Groth16Verifier | [`0x34741d5cd97dcf4b040d7a344168cd73771dd7ad`](https://sepolia.basescan.org/address/0x34741d5cd97dcf4b040d7a344168cd73771dd7ad) |
| CloakRegistry | [`0x15834d9c8cdcb5773235db6840e0ced62b4a0374`](https://sepolia.basescan.org/address/0x15834d9c8cdcb5773235db6840e0ced62b4a0374) |
| StackPlan | [`0x40e8edf7bbb1a7074821fd02e851b79b74dd023b`](https://sepolia.basescan.org/address/0x40e8edf7bbb1a7074821fd02e851b79b74dd023b) |
| StackDemoPool | [`0x25b0c9f15bec09c096ed61865f930ef6ee58163e`](https://sepolia.basescan.org/address/0x25b0c9f15bec09c096ed61865f930ef6ee58163e) |
| tSPY (LLTV 0.77) | [`0x671df7bd033d8a8da2b0a63f1bdb4b13e4affd85`](https://sepolia.basescan.org/address/0x671df7bd033d8a8da2b0a63f1bdb4b13e4affd85) |
| tQQQ (LLTV 0.77) | [`0x13d2033b8c21e49f40ab90e9c04c0f8163f43437`](https://sepolia.basescan.org/address/0x13d2033b8c21e49f40ab90e9c04c0f8163f43437) |
| tGLD (LLTV 0.77) | [`0x2a81fc5d4885d1a5f16494c0e4b369a0c72d2cb9`](https://sepolia.basescan.org/address/0x2a81fc5d4885d1a5f16494c0e4b369a0c72d2cb9) |
| tSLV (LLTV 0.625) | [`0x36c4b6e156304df0ea337e763bf4f22e876d9edf`](https://sepolia.basescan.org/address/0x36c4b6e156304df0ea337e763bf4f22e876d9edf) |
| tIBIT (LLTV 0.625) | [`0x5507ad4cba6bfe88e0702f703fffc05fa7d3a66e`](https://sepolia.basescan.org/address/0x5507ad4cba6bfe88e0702f703fffc05fa7d3a66e) |

Each token also has a Morpho adapter and a Chainlink-style feed, listed in `lib/chain/deployment.json`. The keeper pushes prices only while markets are open: it never puts simulated (weekend) prices on-chain.

Redeploy everything with `node --env-file=.env.local scripts/deploy-testnet.mjs`. Rehearse it on a fork first with `DRY_RUN=1 RPC_URL=http://127.0.0.1:8547`. The script shares the deployer's ETH out to the updater, keeper, faucet and demo wallets. Demo activity: `scripts/demo-activity.mjs <1|2|3>` and `scripts/stack-smoke.mjs`.

**Funding tip:** many faucets pay out on *Ethereum* Sepolia, not Base Sepolia. Move it across with Base's L1 bridge: call `depositETH(200000, 0x)` on `0xfd0Bf71F60660E2f608ed56e1659C450eB113120` (Ethereum Sepolia). It arrives at the same address on Base Sepolia in a few minutes.

---

## Original setup notes

Everything is built and tested locally (15/15 contract tests, full browser flow). These steps put it on public testnets.
Secrets are already generated and stored in Vercel (project **nightshift3**) and in `.env.local` (never uploaded).
Public addresses are in `.nightshift-addresses.txt`.

## 1. Fund the deployer / keeper wallet with free Base Sepolia ETH (~5 min)
Address: see `.nightshift-addresses.txt` (line 1). It needs about **0.02 ETH**: deploying is ~0.005, the rest pays for keeper updates and the visitor gas drip.

Faucets (each needs a quick sign-in):
- Coinbase Developer Platform: https://portal.cdp.coinbase.com/products/faucet (choose Base Sepolia)
- Superchain faucet: https://console.optimism.io/faucet
- Alchemy: https://www.alchemy.com/faucets/base-sepolia

## 2. Deploy the contracts (Claude does this, or run it yourself)
```
npm run contracts:compile
node --env-file=.env.local scripts/deploy-contracts.mjs
npx vercel --prod
```
The script deploys the test tokens, on-chain Oracle, Morpho adapters, Vault and ZK verifier; seeds liquidity and prices; and writes `lib/chain/deployment.json`. Redeploying the site bakes in the addresses.

## 3. Fund the Algorand Ledger account (~2 min)
Address: `.nightshift-addresses.txt` (line 2). Get free TestNet ALGO at https://bank.testnet.algorand.network or https://lora.algokit.io/testnet/fund.
The daily cron then stamps predictions automatically. To test immediately: open `/api/commit` with the `CRON_SECRET` as a Bearer token.

## 4. Run the keeper every 5 minutes (free, ~3 min)
Vercel's free plan only runs crons once a day (already configured as a fallback). For 5-minute updates:
1. Create a free account at https://cron-job.org
2. New cron job → URL: `https://nightshift3.vercel.app/api/keeper?key=<CRON_SECRET>` (the value is in `.env.local`), every 5 minutes.

The keeper pushes Oracle prices on-chain when they move more than 0.1% (or every 30 min) and runs the Guardian on every opted-in loan.

## 5. Optional: Claude news agent
Create an API key at https://console.anthropic.com, then:
```
npx vercel env add ANTHROPIC_API_KEY production
npx vercel --prod
```
It runs at most once an hour (cached), using Claude Opus 5.5 at low effort. Set `NEWS_MODEL` to a cheaper model if you prefer.
Without a key, the Oracle runs on its four market signals and says the news agent is off.

## What visitors can then do
- Connect MetaMask (or Coinbase Wallet) → "Get test funds" (free test ETH for gas + test SPY/QQQ/GLD/IBIT)
- Deposit, borrow tUSDG, repay, withdraw: real Base Sepolia transactions with explorer links
- Opt into the on-chain Guardian; the keeper protects the loan automatically
- Generate a ZK proof and "Verify on-chain" against the deployed verifier contract
- See every pre-open prediction stamped on Algorand

## Still not possible for free
- Fully shielded (private) on-chain positions: research-scale work plus an audit
- Licensed market data, security audit, legal review: these belong in the raise
