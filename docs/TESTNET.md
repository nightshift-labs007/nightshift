# Going live on testnet (all free)

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
