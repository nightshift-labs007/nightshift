# Nightshift: on-chain proof of operation

Status as of 2026-10-22. Everything below is live at [nightshift.buzz](https://nightshift.buzz) and checkable on public explorers.

## Overview

Every product flow now leaves a public footprint, and all of it is readable in one place:

- **[Transactions](https://nightshift.buzz/transactions):** one list of every transaction across Base, Ethereum and Algorand, newest first, with filters. Each row links to Basescan, Etherscan or the Algorand explorer.
- **[Activity summary](https://nightshift.buzz/transparency#activity):** a count and a latest-transaction link for each flow.
- **[Leaderboard](https://nightshift.buzz/leaderboard):** people and Nightshift's own services ranked together.

Nothing is stored by the site. Every figure is read back from the chains, so it can't be edited after the fact.

## Coverage by product

| Product | What is on-chain | Network | Where to see it |
|---|---|---|---|
| **Vault** | Collateral deposits, withdrawals | Base | Transactions → Vault |
| **Borrow** | Loans and repayments against ETF tokens | Base | Transactions → Vault |
| **Guardian** | Auto-protection rules switched on; loan saves | Base | Transactions → Guardian |
| **Oracle** | Fair-value price updates, pushed every ~10 minutes | Base | Transactions → Oracle |
| **Cloak** | Zero-knowledge solvency proofs attested on-chain | Base | Transactions → Cloak |
| **Ledger** | Pre-open predictions stamped before the bell; leaderboard sign-ups | Algorand | Transactions → Algorand |
| **Earn** | A live position in the Sentora Protected RWA vault | Ethereum | Earn page, Transactions → Earn |

## Verification on mainnet

To confirm the flows work end to end on the live contracts, the team ran each of them from three of its own wallets: claim demo tokens, deposit, borrow, switch Guardian on, repay and withdraw. These are real transactions, using demo assets with no value. The wallets are labelled "Team demo wallet" on the leaderboard and "Team" on Transactions, so they are never mistaken for outside users.

- [`0x00d1fc81…B700`](https://basescan.org/address/0x00d1fc81629c9309F10F76827ce02bEE758fB700): SPY
- [`0x191a0A09…B351`](https://basescan.org/address/0x191a0A09D4185d13044e2989C62764612368B351): QQQ
- [`0x88799e8F…2415`](https://basescan.org/address/0x88799e8FD1c139B7b60540e10eC63DfE34F92415): GLD

Each wallet still holds an open, healthy loan (health factor about 7) with Guardian protection on.

## Earn

The team holds a real position in the Sentora Protected RWA vault on Ethereum: 9 PYUSD deposited from [`0xF86fC0d9…A205`](https://etherscan.io/address/0xF86fC0d9346CFac2ce7ea9C72150dD656700A205), giving about 8.686 vault shares.

- Approve: [Etherscan](https://etherscan.io/tx/0xfce2fac87262bf9798a50026d252a116ef68b3e160052a5ff5932b83b3e684f8). Deposit: [Etherscan](https://etherscan.io/tx/0x8827492e9b367e5d5f2da61804a9b24fd282cc8d0b0bbadf6bf7883249a66a92).
- The Earn page shows the live position next to the vault's own data.
- Exit terms: instant redemption costs about 0.2%; the normal route has no fee and takes about 3 days.
- For users nothing changes: Nightshift does not hold anyone's funds, and Earn links out to Sentora to deposit.

## Data notes

- Base history on the site currently reaches back a few hours, because free public nodes don't serve older logs. Connecting an archive RPC (`BASE_RPC_URL`) extends it to launch. The pages state the start time. Algorand history is complete.
- The vault before the security upgrade is not included in the Transactions list.
- Part of the activity shown is the team's own, as described above.
