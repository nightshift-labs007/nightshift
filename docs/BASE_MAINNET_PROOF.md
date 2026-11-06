# Nightshift on Base mainnet: on-chain proof

Generated 2026-11-06 12:57 UTC from Base mainnet itself (chain 8453) by `scripts/base-proof.mjs`: event logs read from every Nightshift contract since block 52612393 (2026-10-07 20:47 UTC) up to block 53893950 (2026-11-06 12:46 UTC). Every address and transaction below links to Basescan, so each line can be checked independently.

> Lending, Stack and the Vault use **demo tokens with no value**; prediction rounds use **real USDC with small caps** (10 per prediction, 25 per wallet per round). The contracts are unaudited.

## At a glance

| | |
|---|---|
| Nightshift contracts on Base | **24** (22 source-verified on Sourcify) |
| Contract events since launch | **9,178** in **2,797** transactions |
| Oracle price updates | **8,623** |
| Vault actions (deposit, borrow, repay, withdraw) | **13** |
| Guardian rules set / loans protected | **4** / **0** |
| Stack plans / buys / skipped windows | **2** / **10** / **356** |
| Zero-knowledge proofs recorded | **0** |
| Prediction rounds opened / predictions placed | **17** / **0** |
| Transactions sent by Nightshift's operator wallets | **2,992** |

## Contracts

| Contract | What it does | Address | Source verified | Events |
|---|---|---|---|---|
| NightshiftOracle | On-chain fair values + confidence (pushed by the updater) | [`0x5507ad4cba6bfe88e0702f703fffc05fa7d3a66e`](https://basescan.org/address/0x5507ad4cba6bfe88e0702f703fffc05fa7d3a66e) | ✅ Sourcify (exact_match) | 8,623 |
| NightshiftVault | Lending: deposit, borrow, repay, withdraw, Guardian protect, liquidation | [`0x2aae4bcf7eec8cc842bacfcf9e13a54cba649071`](https://basescan.org/address/0x2aae4bcf7eec8cc842bacfcf9e13a54cba649071) | ✅ Sourcify (exact_match) | 22 |
| Groth16Verifier | Zero-knowledge solvency proof verifier (Cloak) | [`0xbf565f01a9534175d21aeb12f0a94052b8eed1be`](https://basescan.org/address/0xbf565f01a9534175d21aeb12f0a94052b8eed1be) | ✅ Sourcify (exact_match) | 0 |
| CloakRegistry | Records accepted solvency proofs against the Oracle price | [`0xe3a3cd6ce59a3c5e9d5449189d58a90d1ca04341`](https://basescan.org/address/0xe3a3cd6ce59a3c5e9d5449189d58a90d1ca04341) | ✅ Sourcify (exact_match) | 0 |
| StackPlan | Recurring gold/silver buys, only at a fair price | [`0xfba9ef8a0e3b8dcc5b2b966b0616dd8f1e4e364e`](https://basescan.org/address/0xfba9ef8a0e3b8dcc5b2b966b0616dd8f1e4e364e) | bytecode live | 370 |
| StackDemoPool | Venue Stack buys from (demo tokens) | [`0x6a29df50b4fbd9a67b85cf1e378a46bb4ad55a0b`](https://basescan.org/address/0x6a29df50b4fbd9a67b85cf1e378a46bb4ad55a0b) | bytecode live | 12 |
| NightshiftPredictions | "Call the Open" prediction rounds (USDC stakes) | [`0xb8eb03befbc88fdcc5ca089ebb224c80057b64ea`](https://basescan.org/address/0xb8eb03befbc88fdcc5ca089ebb224c80057b64ea) | ✅ Sourcify (exact_match) | 36 |
| NightshiftPredictions (retired, demo stakes) | First prediction contract, replaced by the USDC one; no rounds | [`0xf401c66015d55fe0ae69b1caa9fbeac170f69f12`](https://basescan.org/address/0xf401c66015d55fe0ae69b1caa9fbeac170f69f12) | ✅ Sourcify (exact_match) | 7 |
| dUSDG | Demo dollar (loan token for the Vault and Stack); no value | [`0xc86322b80a84ebf428daea6976ac65e500776930`](https://basescan.org/address/0xc86322b80a84ebf428daea6976ac65e500776930) | ✅ Sourcify (exact_match) | 64 |
| dSPY | Demo SPY token (collateral); no value | [`0x671df7bd033d8a8da2b0a63f1bdb4b13e4affd85`](https://basescan.org/address/0x671df7bd033d8a8da2b0a63f1bdb4b13e4affd85) | ✅ Sourcify (exact_match) | 6 |
| SPY Morpho oracle adapter | Nightshift price in Morpho Blue's IOracle format | [`0x0c0b7d5d8bc355449b405a95b0c9340ddab0aea7`](https://basescan.org/address/0x0c0b7d5d8bc355449b405a95b0c9340ddab0aea7) | ✅ Sourcify (exact_match) | 0 |
| SPY / USD feed | Nightshift price in Chainlink AggregatorV3 format | [`0xe48aecf355d5cd22665ec6f7aa6767ca9a9f2e6b`](https://basescan.org/address/0xe48aecf355d5cd22665ec6f7aa6767ca9a9f2e6b) | ✅ Sourcify (exact_match) | 0 |
| dQQQ | Demo QQQ token (collateral); no value | [`0x13d2033b8c21e49f40ab90e9c04c0f8163f43437`](https://basescan.org/address/0x13d2033b8c21e49f40ab90e9c04c0f8163f43437) | ✅ Sourcify (exact_match) | 5 |
| QQQ Morpho oracle adapter | Nightshift price in Morpho Blue's IOracle format | [`0x58b906b7ed814ca0908324e5aae666b09b827d5b`](https://basescan.org/address/0x58b906b7ed814ca0908324e5aae666b09b827d5b) | ✅ Sourcify (exact_match) | 0 |
| QQQ / USD feed | Nightshift price in Chainlink AggregatorV3 format | [`0xd59903410ad53fdeedd678775ff0a1a76e9f0aaa`](https://basescan.org/address/0xd59903410ad53fdeedd678775ff0a1a76e9f0aaa) | ✅ Sourcify (exact_match) | 0 |
| dGLD | Demo GLD token (collateral); no value | [`0x2a81fc5d4885d1a5f16494c0e4b369a0c72d2cb9`](https://basescan.org/address/0x2a81fc5d4885d1a5f16494c0e4b369a0c72d2cb9) | ✅ Sourcify (exact_match) | 16 |
| GLD Morpho oracle adapter | Nightshift price in Morpho Blue's IOracle format | [`0x7f1c89ab95facabb360695480beeafbb30706645`](https://basescan.org/address/0x7f1c89ab95facabb360695480beeafbb30706645) | ✅ Sourcify (exact_match) | 0 |
| GLD / USD feed | Nightshift price in Chainlink AggregatorV3 format | [`0x3f18b88a652b4148af88dc9f739080ac91245bcb`](https://basescan.org/address/0x3f18b88a652b4148af88dc9f739080ac91245bcb) | ✅ Sourcify (exact_match) | 0 |
| dIBIT | Demo IBIT token (collateral); no value | [`0x36c4b6e156304df0ea337e763bf4f22e876d9edf`](https://basescan.org/address/0x36c4b6e156304df0ea337e763bf4f22e876d9edf) | ✅ Sourcify (exact_match) | 1 |
| IBIT Morpho oracle adapter | Nightshift price in Morpho Blue's IOracle format | [`0x5118e7e20ac6ab2429695a45d584025e8054c0b7`](https://basescan.org/address/0x5118e7e20ac6ab2429695a45d584025e8054c0b7) | ✅ Sourcify (exact_match) | 0 |
| IBIT / USD feed | Nightshift price in Chainlink AggregatorV3 format | [`0x146c622c99d5a1bbd89df2af3939861eef13946e`](https://basescan.org/address/0x146c622c99d5a1bbd89df2af3939861eef13946e) | ✅ Sourcify (exact_match) | 0 |
| dSLV | Demo SLV token (collateral); no value | [`0xafc5b9d90655353224d6f2f6f81a3ea37153e3fa`](https://basescan.org/address/0xafc5b9d90655353224d6f2f6f81a3ea37153e3fa) | ✅ Sourcify (exact_match) | 16 |
| SLV Morpho oracle adapter | Nightshift price in Morpho Blue's IOracle format | [`0x8c09069f08ac5a57aa308ccd6c65d60dc0b2627d`](https://basescan.org/address/0x8c09069f08ac5a57aa308ccd6c65d60dc0b2627d) | ✅ Sourcify (exact_match) | 0 |
| SLV / USD feed | Nightshift price in Chainlink AggregatorV3 format | [`0xb2aa75305d74d9d1d59077d39688dbd9d7d75bd4`](https://basescan.org/address/0xb2aa75305d74d9d1d59077d39688dbd9d7d75bd4) | ✅ Sourcify (exact_match) | 0 |

Owner of the contracts: [`0x155CF8D8A187d9fa17C5f5F619662b920c130239`](https://basescan.org/address/0x155CF8D8A187d9fa17C5f5F619662b920c130239) (a single wallet; a multisig is planned before any larger real-money use).

## What happened on each contract

Counts of each event, with the first and the latest transaction for it.

| Contract | Event | Count | First | Latest |
|---|---|---|---|---|
| NightshiftOracle | `PriceUpdated` | 8,623 | [0x0b33d6b8…40c880](https://basescan.org/tx/0x0b33d6b8aa0b820f92e8fb511b78b284b57ca7202fface950df7ad2eb640c880) · 2026-10-07 20:56 UTC | [0x613f5bac…df37d6](https://basescan.org/tx/0x613f5bac7f55fa56fc789400ce1617763ac50a5904764795e760c1993adf37d6) · 2026-11-06 11:51 UTC |
| StackPlan | `Skipped` | 356 | [0xa3b4ea14…6c40b2](https://basescan.org/tx/0xa3b4ea149fe8ac867e3b1a196ef9fb8bcae671a63bc0cd716cdd40258c6c40b2) · 2026-10-20 02:15 UTC | [0x15ad0b6c…acf077](https://basescan.org/tx/0x15ad0b6c44d75ed6984e00a7f8f79ff4cb31d78022e683dbcd810f5b11acf077) · 2026-11-06 06:51 UTC |
| dUSDG | `Transfer` | 35 | [0xfea8f4a7…671c7b](https://basescan.org/tx/0xfea8f4a73da52020bd2b278b8ff794b45e91b294f7fcb0a7aecba3540e671c7b) · 2026-10-07 20:47 UTC | [0x69955f8e…dda870](https://basescan.org/tx/0x69955f8eddcf86531c1096da50fdb565b3827121e0d387ab95d4a4d133dda870) · 2026-10-20 00:15 UTC |
| dUSDG | `Approval` | 29 | [0x2a860927…495cba](https://basescan.org/tx/0x2a860927995624d21e2bdb6736fb916b53f52ea9e3d440e767e8c62bfa495cba) · 2026-10-14 17:25 UTC | [0x912572f8…2346c8](https://basescan.org/tx/0x912572f884fa2dd59578e727c163c684048ee99878db00734ca81933f82346c8) · 2026-10-28 18:31 UTC |
| NightshiftPredictions | `RoundCreated` | 17 | [0x88db1d26…8a9224](https://basescan.org/tx/0x88db1d2690ff4c69d589385118e441d4ce03b5c55b889181ff4fbf87e88a9224) · 2026-10-28 20:35 UTC | [0x72f8760e…891e8e](https://basescan.org/tx/0x72f8760ef6c0844aef02a222a86660fa834eea485432cef95942990e64891e8e) · 2026-11-01 15:18 UTC |
| dGLD | `Transfer` | 15 | [0x1968fa97…201b7b](https://basescan.org/tx/0x1968fa97102afecf15632f14bd4ddf3e0c75b6b0be1d398e25afed45f3201b7b) · 2026-10-09 21:03 UTC | [0x3c8a85cd…2b3177](https://basescan.org/tx/0x3c8a85cde1a322c36842bdbdbe0a1ca988530efb5ebcd0b51d731340222b3177) · 2026-10-20 00:15 UTC |
| dSLV | `Transfer` | 14 | [0xf9594919…d8ee0b](https://basescan.org/tx/0xf9594919d5ac8a794cee18b709adac4e9411a577e277492527e4d5b0c3d8ee0b) · 2026-10-19 19:45 UTC | [0x69955f8e…dda870](https://basescan.org/tx/0x69955f8eddcf86531c1096da50fdb565b3827121e0d387ab95d4a4d133dda870) · 2026-10-20 00:15 UTC |
| StackPlan | `Executed` | 10 | [0x456c79c7…2a5d34](https://basescan.org/tx/0x456c79c7beb868a344ee78f67cf875d986b981b205aac84c1a5d13ea7d2a5d34) · 2026-10-19 20:10 UTC | [0x69955f8e…dda870](https://basescan.org/tx/0x69955f8eddcf86531c1096da50fdb565b3827121e0d387ab95d4a4d133dda870) · 2026-10-20 00:15 UTC |
| StackDemoPool | `Bought` | 10 | [0x456c79c7…2a5d34](https://basescan.org/tx/0x456c79c7beb868a344ee78f67cf875d986b981b205aac84c1a5d13ea7d2a5d34) · 2026-10-19 20:10 UTC | [0x69955f8e…dda870](https://basescan.org/tx/0x69955f8eddcf86531c1096da50fdb565b3827121e0d387ab95d4a4d133dda870) · 2026-10-20 00:15 UTC |
| NightshiftVault | `MarketSet` | 5 | [0xf48d983e…ef29cd](https://basescan.org/tx/0xf48d983eea0ca84dad44e79feb2231f03073f0dbe81784d099c3b876c7ef29cd) · 2026-10-07 20:47 UTC | [0x4f246cba…9de3a7](https://basescan.org/tx/0x4f246cbac59cc92ff8ffe8e2a068b177d4b72b7ef343bdf7d4628a0e8a9de3a7) · 2026-10-19 19:43 UTC |
| NightshiftPredictions | `PythFeedSet` | 5 | [0x73544c24…d183c3](https://basescan.org/tx/0x73544c241b8dfc8d092b016b969c59fcc5d8d03da63868805c7e6c7f8dd183c3) · 2026-10-28 18:47 UTC | [0x6f8918cc…a171ad](https://basescan.org/tx/0x6f8918cc5815dd73d3e6e5462f37bd156dd5ffae915c6047f3ccd44e85a171ad) · 2026-10-28 18:48 UTC |
| NightshiftPredictions | `Proposed` | 5 | [0x45fe2978…b205cb](https://basescan.org/tx/0x45fe2978e4ac28309681e8176f7eb9b7323a77eb47e9eac21e00680946b205cb) · 2026-10-29 13:45 UTC | [0x5ece545a…0efee6](https://basescan.org/tx/0x5ece545ae3690b7c76a89b972fae276c5f0d16e37637944b4f4481eb2d0efee6) · 2026-10-29 14:06 UTC |
| NightshiftPredictions | `Settled` | 5 | [0x2d461481…619762](https://basescan.org/tx/0x2d461481d0bca6e7472b082774bda731eb60483ad3af553ad37e645cad619762) · 2026-10-29 15:55 UTC | [0xfeb7726d…16984d](https://basescan.org/tx/0xfeb7726d05879efa49de5f3b40148e408e5b895bc10d248b47c289a7e616984d) · 2026-10-29 16:25 UTC |
| NightshiftPredictions (retired, demo stakes) | `PythFeedSet` | 5 | [0xf41a519c…7352a6](https://basescan.org/tx/0xf41a519c7ad790d98e2a9189c40409a7c5ccfa2f6b3b4ca48f54a4e5327352a6) · 2026-10-28 18:07 UTC | [0x27cd8aca…98ac14](https://basescan.org/tx/0x27cd8acac86b4d550a311b07dd1b19f93a0619ac13ba468d98f9809ebb98ac14) · 2026-10-28 18:07 UTC |
| NightshiftVault | `Borrow` | 4 | [0x3702e24a…cb4454](https://basescan.org/tx/0x3702e24a8f5b82d756b180ee6d8e99d792a2b2b74982e98badbb58a430cb4454) · 2026-10-14 17:25 UTC | [0xa4dfa0fc…d42258](https://basescan.org/tx/0xa4dfa0fcdbf0b9d8c3ec622a47422238e15caeee4b1679db58a6fca019d42258) · 2026-10-14 17:26 UTC |
| NightshiftVault | `RuleSet` | 4 | [0xf0908896…cc01d3](https://basescan.org/tx/0xf0908896bf2892361c9df5bb590f3e0ab0bb68ca314ff17ffb7dcc2d1ecc01d3) · 2026-10-14 17:25 UTC | [0x999eea09…e8cf01](https://basescan.org/tx/0x999eea09a0185a1f3c22dd4c76a630940b278f945c5ef3fed85b36cc52e8cf01) · 2026-10-14 17:26 UTC |
| dSPY | `Transfer` | 4 | [0x7b6adbbe…c39ab5](https://basescan.org/tx/0x7b6adbbee574d2fb981091e802f7dbb00f2c4f3e0b5d147ecc975b4b1fc39ab5) · 2026-10-09 21:03 UTC | [0x4d9d4d56…46bd06](https://basescan.org/tx/0x4d9d4d56536761e1b40d35bacfb7c0027536fab6dbc9699de0c73a031646bd06) · 2026-10-14 17:26 UTC |
| dQQQ | `Transfer` | 4 | [0xc7fcd8e5…0d3bc0](https://basescan.org/tx/0xc7fcd8e5ddfeafc7b1926f46addefd1ed3c8aae17d8a706163d5806f650d3bc0) · 2026-10-09 21:03 UTC | [0xdfc9c6a9…03832f](https://basescan.org/tx/0xdfc9c6a9991e8fb5eb47bb455ca2473a4a0409a729c48486580b440af503832f) · 2026-10-14 17:26 UTC |
| NightshiftVault | `Deposit` | 3 | [0x70232a8c…687327](https://basescan.org/tx/0x70232a8c9e2eedaec25d2e9a2153cce00fe37f712aeef5b9af2060bb8f687327) · 2026-10-14 17:25 UTC | [0xb4d32d26…56e788](https://basescan.org/tx/0xb4d32d2621b1e296322ca57a9f133048082a13696be4d37e82a6fb7d8056e788) · 2026-10-14 17:26 UTC |
| NightshiftVault | `Repay` | 3 | [0x031c6ef4…abfea4](https://basescan.org/tx/0x031c6ef4396673560e0b8df995a75e4f90d522a2494435d3934c671a67abfea4) · 2026-10-14 17:25 UTC | [0x93dcd23a…83bb06](https://basescan.org/tx/0x93dcd23a6c2eb413225e20e6511f81c9009633f02462c212d6816c736c83bb06) · 2026-10-14 17:27 UTC |
| NightshiftVault | `Withdraw` | 3 | [0x4d9d4d56…46bd06](https://basescan.org/tx/0x4d9d4d56536761e1b40d35bacfb7c0027536fab6dbc9699de0c73a031646bd06) · 2026-10-14 17:26 UTC | [0x508f9ba1…461a64](https://basescan.org/tx/0x508f9ba1fe7be1c3c685a4083da725ed4d5bd96af8a8a840d8f5bfc855461a64) · 2026-10-14 17:27 UTC |
| StackPlan | `AssetSet` | 2 | [0x161868ad…944256](https://basescan.org/tx/0x161868ad85c981dffe494190b32169537f34a2e056f69b45f2c7ff2776944256) · 2026-10-19 20:07 UTC | [0x25aa4d43…7095a0](https://basescan.org/tx/0x25aa4d438c87a61f4e8185b425a86a5d8c9f2704154ece8a15fba1c8127095a0) · 2026-10-19 20:07 UTC |
| StackPlan | `PlanCreated` | 2 | [0x98e53bf3…fb0310](https://basescan.org/tx/0x98e53bf3f922bfd74f16708d7a9e0c3ea3c528c6d0308bcc228b1d654dfb0310) · 2026-10-19 20:08 UTC | [0x57d981c2…5b5fab](https://basescan.org/tx/0x57d981c2a53afbe7da580a35ab868b5960e9719b4f61975608690d76c65b5fab) · 2026-10-19 20:13 UTC |
| StackDemoPool | `SpreadSet` | 2 | [0x45a8b6c2…cd7e03](https://basescan.org/tx/0x45a8b6c25e8a9ea8843cf1c00795a16b5bd88ceb77fc3498e0e1277baecd7e03) · 2026-10-19 20:07 UTC | [0x276b50d9…50b02c](https://basescan.org/tx/0x276b50d9611c757e562dbf9de57a8cf9f142bfe5981d996cf09f5aa99950b02c) · 2026-10-19 20:07 UTC |
| NightshiftPredictions | `MembersSet` | 2 | [0x995b7835…7db744](https://basescan.org/tx/0x995b78357e87eb8306074eb17b66e056ae25a36a3625d3af2f2d34cc4c7db744) · 2026-10-28 18:51 UTC | [0x27248f69…a79e9e](https://basescan.org/tx/0x27248f69b96f08ae1cb99f46952928185c9ae42c706173d6e2f52bc68ca79e9e) · 2026-10-29 07:55 UTC |
| dSPY | `Approval` | 2 | [0xa4b7a5bc…dce837](https://basescan.org/tx/0xa4b7a5bcfe6cf7508a4d77063a33bda9be38ad26fb253f853be8f16f86dce837) · 2026-10-14 17:25 UTC | [0xc8e352d7…ae5d4b](https://basescan.org/tx/0xc8e352d7455a9eebfc9d4caf8b7aac648f2d8225f9c787672ecb6e0d5fae5d4b) · 2026-10-14 17:25 UTC |
| NightshiftPredictions | `OperatorSet` | 1 | [0x9c6ae44c…ca0605](https://basescan.org/tx/0x9c6ae44c95b97808aae02116796dcbc41e2c4e0d045305ec8ed5d51455ca0605) · 2026-10-28 18:47 UTC | [0x9c6ae44c…ca0605](https://basescan.org/tx/0x9c6ae44c95b97808aae02116796dcbc41e2c4e0d045305ec8ed5d51455ca0605) · 2026-10-28 18:47 UTC |
| NightshiftPredictions | `LimitsSet` | 1 | [0xa58ffbe2…155291](https://basescan.org/tx/0xa58ffbe2569cc7015a8c2e8a85c9e31fac2557d38f0ed4408685010822155291) · 2026-10-28 18:48 UTC | [0xa58ffbe2…155291](https://basescan.org/tx/0xa58ffbe2569cc7015a8c2e8a85c9e31fac2557d38f0ed4408685010822155291) · 2026-10-28 18:48 UTC |
| NightshiftPredictions (retired, demo stakes) | `OperatorSet` | 1 | [0x87ad6473…06da57](https://basescan.org/tx/0x87ad64730beb3b2b07e27a8fbbb5c3b103cf0ccde827c81818a62091ba06da57) · 2026-10-28 18:07 UTC | [0x87ad6473…06da57](https://basescan.org/tx/0x87ad64730beb3b2b07e27a8fbbb5c3b103cf0ccde827c81818a62091ba06da57) · 2026-10-28 18:07 UTC |
| NightshiftPredictions (retired, demo stakes) | `MembersSet` | 1 | [0xa96f7e0f…f9d7b8](https://basescan.org/tx/0xa96f7e0f1f5d9853cbdc3b066fa47f7f50df9bbac4fd84067df2046490f9d7b8) · 2026-10-28 18:17 UTC | [0xa96f7e0f…f9d7b8](https://basescan.org/tx/0xa96f7e0f1f5d9853cbdc3b066fa47f7f50df9bbac4fd84067df2046490f9d7b8) · 2026-10-28 18:17 UTC |
| dQQQ | `Approval` | 1 | [0x87bae7e2…d4a0a5](https://basescan.org/tx/0x87bae7e2445f5c24165f8ab0f399d7cb80db8d36571b0df50233616ef6d4a0a5) · 2026-10-14 17:26 UTC | [0x87bae7e2…d4a0a5](https://basescan.org/tx/0x87bae7e2445f5c24165f8ab0f399d7cb80db8d36571b0df50233616ef6d4a0a5) · 2026-10-14 17:26 UTC |
| dGLD | `Approval` | 1 | [0xe29de48f…aacc7b](https://basescan.org/tx/0xe29de48fe91e30cd5c8ebb5688af5475fa88bd9a2a825fba7e0ca0c519aacc7b) · 2026-10-14 17:26 UTC | [0xe29de48f…aacc7b](https://basescan.org/tx/0xe29de48fe91e30cd5c8ebb5688af5475fa88bd9a2a825fba7e0ca0c519aacc7b) · 2026-10-14 17:26 UTC |
| dIBIT | `Transfer` | 1 | [0x5b3e37e3…d0163a](https://basescan.org/tx/0x5b3e37e3a872679f2e2b7eb654073965f2517733d4ed93a50d74052e1bd0163a) · 2026-10-09 21:03 UTC | [0x5b3e37e3…d0163a](https://basescan.org/tx/0x5b3e37e3a872679f2e2b7eb654073965f2517733d4ed93a50d74052e1bd0163a) · 2026-10-09 21:03 UTC |
| dSLV | `MinterSet` | 1 | [0xdb4a2ef1…99cddc](https://basescan.org/tx/0xdb4a2ef1442ab02f78a413988982212140087e1fb7ad33e5c8e6335c2c99cddc) · 2026-10-19 19:43 UTC | [0xdb4a2ef1…99cddc](https://basescan.org/tx/0xdb4a2ef1442ab02f78a413988982212140087e1fb7ad33e5c8e6335c2c99cddc) · 2026-10-19 19:43 UTC |
| dSLV | `Approval` | 1 | [0x0f5698e9…cd64c8](https://basescan.org/tx/0x0f5698e976e8a40219b59d6cfe46625dcac2be73c8e238e53239881d09cd64c8) · 2026-10-19 19:45 UTC | [0x0f5698e9…cd64c8](https://basescan.org/tx/0x0f5698e976e8a40219b59d6cfe46625dcac2be73c8e238e53239881d09cd64c8) · 2026-10-19 19:45 UTC |

## Prediction rounds (USDC)

Each round's call is recorded on Base before predictions open; the round stores that record's transaction hash.

| Round | ETF | Open | Nightshift's call | Opened in | Call recorded in |
|---|---|---|---|---|---|
| #0 | SPY | 2026-11-05 | $767.77 | [0x88db1d26…8a9224](https://basescan.org/tx/0x88db1d2690ff4c69d589385118e441d4ce03b5c55b889181ff4fbf87e88a9224) | [0x05d839b8…cf9f91](https://basescan.org/tx/0x05d839b8788ff38632c51df9222ff3635d1210d69db0c5e5a815e05dabcf9f91) |
| #1 | QQQ | 2026-11-05 | $693.07 | [0x88db1d26…8a9224](https://basescan.org/tx/0x88db1d2690ff4c69d589385118e441d4ce03b5c55b889181ff4fbf87e88a9224) | [0x05d839b8…cf9f91](https://basescan.org/tx/0x05d839b8788ff38632c51df9222ff3635d1210d69db0c5e5a815e05dabcf9f91) |
| #2 | GLD | 2026-11-05 | $372.60 | [0x88db1d26…8a9224](https://basescan.org/tx/0x88db1d2690ff4c69d589385118e441d4ce03b5c55b889181ff4fbf87e88a9224) | [0x05d839b8…cf9f91](https://basescan.org/tx/0x05d839b8788ff38632c51df9222ff3635d1210d69db0c5e5a815e05dabcf9f91) |
| #3 | SLV | 2026-11-05 | $47.22 | [0x88db1d26…8a9224](https://basescan.org/tx/0x88db1d2690ff4c69d589385118e441d4ce03b5c55b889181ff4fbf87e88a9224) | [0x05d839b8…cf9f91](https://basescan.org/tx/0x05d839b8788ff38632c51df9222ff3635d1210d69db0c5e5a815e05dabcf9f91) |
| #4 | IBIT | 2026-11-05 | $45.33 | [0x88db1d26…8a9224](https://basescan.org/tx/0x88db1d2690ff4c69d589385118e441d4ce03b5c55b889181ff4fbf87e88a9224) | [0x05d839b8…cf9f91](https://basescan.org/tx/0x05d839b8788ff38632c51df9222ff3635d1210d69db0c5e5a815e05dabcf9f91) |
| #5 | SPY | 2026-11-06 | $733.16 | [0x72f8760e…891e8e](https://basescan.org/tx/0x72f8760ef6c0844aef02a222a86660fa834eea485432cef95942990e64891e8e) | [0x8930e8b3…d001c9](https://basescan.org/tx/0x8930e8b3d69c9df343f50abeda56ced1033476099f7bdc98f23f1b7fabd001c9) |
| #6 | QQQ | 2026-11-06 | $649.36 | [0x72f8760e…891e8e](https://basescan.org/tx/0x72f8760ef6c0844aef02a222a86660fa834eea485432cef95942990e64891e8e) | [0x8930e8b3…d001c9](https://basescan.org/tx/0x8930e8b3d69c9df343f50abeda56ced1033476099f7bdc98f23f1b7fabd001c9) |
| #7 | GLD | 2026-11-06 | $374.97 | [0x72f8760e…891e8e](https://basescan.org/tx/0x72f8760ef6c0844aef02a222a86660fa834eea485432cef95942990e64891e8e) | [0x8930e8b3…d001c9](https://basescan.org/tx/0x8930e8b3d69c9df343f50abeda56ced1033476099f7bdc98f23f1b7fabd001c9) |
| #8 | SLV | 2026-11-06 | $46.88 | [0x72f8760e…891e8e](https://basescan.org/tx/0x72f8760ef6c0844aef02a222a86660fa834eea485432cef95942990e64891e8e) | [0x8930e8b3…d001c9](https://basescan.org/tx/0x8930e8b3d69c9df343f50abeda56ced1033476099f7bdc98f23f1b7fabd001c9) |
| #9 | IBIT | 2026-11-06 | $43.08 | [0x72f8760e…891e8e](https://basescan.org/tx/0x72f8760ef6c0844aef02a222a86660fa834eea485432cef95942990e64891e8e) | [0x8930e8b3…d001c9](https://basescan.org/tx/0x8930e8b3d69c9df343f50abeda56ced1033476099f7bdc98f23f1b7fabd001c9) |
| #10 | DIA | 2026-11-06 | $512.85 | [0x72f8760e…891e8e](https://basescan.org/tx/0x72f8760ef6c0844aef02a222a86660fa834eea485432cef95942990e64891e8e) | [0x8930e8b3…d001c9](https://basescan.org/tx/0x8930e8b3d69c9df343f50abeda56ced1033476099f7bdc98f23f1b7fabd001c9) |
| #11 | IWM | 2026-11-06 | $270.86 | [0x72f8760e…891e8e](https://basescan.org/tx/0x72f8760ef6c0844aef02a222a86660fa834eea485432cef95942990e64891e8e) | [0x8930e8b3…d001c9](https://basescan.org/tx/0x8930e8b3d69c9df343f50abeda56ced1033476099f7bdc98f23f1b7fabd001c9) |
| #12 | TLT | 2026-11-06 | $81.90 | [0x72f8760e…891e8e](https://basescan.org/tx/0x72f8760ef6c0844aef02a222a86660fa834eea485432cef95942990e64891e8e) | [0x8930e8b3…d001c9](https://basescan.org/tx/0x8930e8b3d69c9df343f50abeda56ced1033476099f7bdc98f23f1b7fabd001c9) |
| #13 | USO | 2026-11-06 | $148.68 | [0x72f8760e…891e8e](https://basescan.org/tx/0x72f8760ef6c0844aef02a222a86660fa834eea485432cef95942990e64891e8e) | [0x8930e8b3…d001c9](https://basescan.org/tx/0x8930e8b3d69c9df343f50abeda56ced1033476099f7bdc98f23f1b7fabd001c9) |
| #14 | ETHA | 2026-11-06 | $50.67 | [0x72f8760e…891e8e](https://basescan.org/tx/0x72f8760ef6c0844aef02a222a86660fa834eea485432cef95942990e64891e8e) | [0x8930e8b3…d001c9](https://basescan.org/tx/0x8930e8b3d69c9df343f50abeda56ced1033476099f7bdc98f23f1b7fabd001c9) |
| #15 | GDX | 2026-11-06 | $85.56 | [0x72f8760e…891e8e](https://basescan.org/tx/0x72f8760ef6c0844aef02a222a86660fa834eea485432cef95942990e64891e8e) | [0x8930e8b3…d001c9](https://basescan.org/tx/0x8930e8b3d69c9df343f50abeda56ced1033476099f7bdc98f23f1b7fabd001c9) |
| #16 | SMH | 2026-11-06 | $449.83 | [0x72f8760e…891e8e](https://basescan.org/tx/0x72f8760ef6c0844aef02a222a86660fa834eea485432cef95942990e64891e8e) | [0x8930e8b3…d001c9](https://basescan.org/tx/0x8930e8b3d69c9df343f50abeda56ced1033476099f7bdc98f23f1b7fabd001c9) |

## The public record on Base

Nightshift writes its pre-open calls, the evening calls behind prediction rounds and sign-ups as 0-ETH transactions from the updater wallet to itself; the input data is the note in plain text (Basescan → *Input Data* → *View as UTF-8*).

| Note | Transaction |
|---|---|
| Pre-open call for 2026-11-06 | [0x23d3295c…023f94](https://basescan.org/tx/0x23d3295c8595287aceebb824af09fe3a58605e67c51faa0bc8c9754c76023f94) |
| Pre-open call for 2026-11-05 | [0xeef80b39…cce0ee](https://basescan.org/tx/0xeef80b3958faed4ab3eaad50146422a11b1fd9f161fdd8229597b5fa6ecce0ee) |
| Evening call (strike of a prediction round) | [0x8930e8b3…d001c9](https://basescan.org/tx/0x8930e8b3d69c9df343f50abeda56ced1033476099f7bdc98f23f1b7fabd001c9) |
| Evening call (strike of a prediction round) | [0x05d839b8…cf9f91](https://basescan.org/tx/0x05d839b8788ff38632c51df9222ff3635d1210d69db0c5e5a815e05dabcf9f91) |
| Formal-proof manifest fingerprint `a97614aa79d54485…` (24 Lean-proven safety rules) | [0xf04da4d2…90b768](https://basescan.org/tx/0xf04da4d2400d9d43afc2187e8ae48bd1dfe2a9c2cc054dcb644ef7b42e90b768) |

All record notes come from [`0x594F0e1D57f88f7FAd91d09002c25f3a1253C6b7`](https://basescan.org/address/0x594F0e1D57f88f7FAd91d09002c25f3a1253C6b7).

## Operator wallets

| Role | Address | Transactions sent | ETH now |
|---|---|---|---|
| Owner | [`0x155CF8D8A187d9fa17C5f5F619662b920c130239`](https://basescan.org/address/0x155CF8D8A187d9fa17C5f5F619662b920c130239) | 71 | 0.00101 |
| Oracle updater + public record | [`0x594F0e1D57f88f7FAd91d09002c25f3a1253C6b7`](https://basescan.org/address/0x594F0e1D57f88f7FAd91d09002c25f3a1253C6b7) | 2,490 | 0.00093 |
| Keeper | [`0x5b9C8c979a0ba1097fFE50d6C27eF727731E5457`](https://basescan.org/address/0x5b9C8c979a0ba1097fFE50d6C27eF727731E5457) | 378 | 0.00069 |
| Faucet + gas cover | [`0x460cE0bEac00D9e73986B266c290F674879044fb`](https://basescan.org/address/0x460cE0bEac00D9e73986B266c290F674879044fb) | 53 | 0.00077 |

The updater pushes prices and writes the public record; the keeper runs the Guardian, Stack and the prediction rounds; the faucet mints demo tokens and covers members' gas. None of them can move users' funds: the contracts only let users move their own.

## Morpho Blue integration on Base

Real Morpho Blue markets ([`0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb`](https://basescan.org/address/0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb)) priced by Nightshift's oracle adapters, exercised end to end:

| Step | Transaction |
|---|---|
| approve Morpho for dSLV | [0x0f5698e9…cd64c8](https://basescan.org/tx/0x0f5698e976e8a40219b59d6cfe46625dcac2be73c8e238e53239881d09cd64c8) |
| supply 1 dSLV as collateral | [0x9ce91e5f…4a50ad](https://basescan.org/tx/0x9ce91e5f83bcd96aac5f31b31a00be44dc37e116fa4c11548b0daf38144a50ad) |
| borrow 24.324636 dUSDG | [0xc11b9d39…695232](https://basescan.org/tx/0xc11b9d396b7fac9f00ade93c6528a9d0545d54c079f66597e627f4f091695232) |
| mint a little dUSDG for interest | [0xcc14c001…a4abdd](https://basescan.org/tx/0xcc14c001e9efd42fee994acfceb6e7db78b0ca129431079cbcc46de025a4abdd) |
| repay the whole loan (by shares) | [0xe14873d8…6f4135](https://basescan.org/tx/0xe14873d8ea0e765bf525310583da6bcba76f77b8e044731df050f53aae6f4135) |
| withdraw 1 dSLV | [0x06f76b4f…a04129](https://basescan.org/tx/0x06f76b4fa9d494f473363201c450be038c3be462934d5ed526fac0ef12a04129) |

## Latest 30 transactions

| When (UTC) | Contract | Event | Transaction |
|---|---|---|---|
| 2026-11-06 11:51 UTC | NightshiftOracle | `PriceUpdated` | [0x613f5bac…df37d6](https://basescan.org/tx/0x613f5bac7f55fa56fc789400ce1617763ac50a5904764795e760c1993adf37d6) |
| 2026-11-06 10:15 UTC | NightshiftOracle | `PriceUpdated` | [0x0be45e2e…92aaae](https://basescan.org/tx/0x0be45e2e5c4850606da66803e82baf44aadd57d6d0acc98451ba4ce1b992aaae) |
| 2026-11-06 08:31 UTC | NightshiftOracle | `PriceUpdated` | [0x2b8e598c…25ee5a](https://basescan.org/tx/0x2b8e598ce8dcb4089e649ff7aede53d10ba8c4aaeca30c4a3a537ed0ff25ee5a) |
| 2026-11-06 06:51 UTC | StackPlan | `Skipped` | [0x15ad0b6c…acf077](https://basescan.org/tx/0x15ad0b6c44d75ed6984e00a7f8f79ff4cb31d78022e683dbcd810f5b11acf077) |
| 2026-11-06 06:51 UTC | StackPlan | `Skipped` | [0x234e19a9…79745b](https://basescan.org/tx/0x234e19a9bbf7dd4f3e8b6989c0c3e4ca73674cd091dc3eb11910c9c46079745b) |
| 2026-11-06 06:51 UTC | NightshiftOracle | `PriceUpdated` | [0xc67a945d…1dff32](https://basescan.org/tx/0xc67a945d41a2dde04a9cf9c92721637ea0cb9ceb993d0f7d354c1c6e021dff32) |
| 2026-11-06 05:17 UTC | NightshiftOracle | `PriceUpdated` | [0x08d3d0de…adcd3a](https://basescan.org/tx/0x08d3d0de2d84b107929d1192b3837392dfb17cbb94a57ea4df00b9135badcd3a) |
| 2026-11-06 03:31 UTC | NightshiftOracle | `PriceUpdated` | [0xaf3f8653…ad3a78](https://basescan.org/tx/0xaf3f8653d64a483daa38059019e0c94e40e801ff2a6e92609693f5cd87ad3a78) |
| 2026-11-06 01:51 UTC | NightshiftOracle | `PriceUpdated` | [0xcf54412f…d3257c](https://basescan.org/tx/0xcf54412f591f337df9b362dd3750fb29c415fdd920ac4f5e5b668f5e97d3257c) |
| 2026-11-06 00:14 UTC | NightshiftOracle | `PriceUpdated` | [0xadc6593d…94ef0f](https://basescan.org/tx/0xadc6593dca416dcff38b087a87452bedaebf9927dc0ae78f62f27865d794ef0f) |
| 2026-11-05 22:31 UTC | NightshiftOracle | `PriceUpdated` | [0xd351e2b8…f057f0](https://basescan.org/tx/0xd351e2b88a7aae91f8e875a4bbf2c18bbbbc3981051c2040f6a19b858bf057f0) |
| 2026-11-05 20:51 UTC | StackPlan | `Skipped` | [0xaddb0e37…0cd082](https://basescan.org/tx/0xaddb0e37f9016eb0593c313295ccc1af9549f813174d7661491b1181720cd082) |
| 2026-11-05 20:51 UTC | StackPlan | `Skipped` | [0xc92d9713…6b7c2d](https://basescan.org/tx/0xc92d9713a7b495dc1bf6414b05a505a8a9ec4545d7397d2b6b5da835886b7c2d) |
| 2026-11-05 20:51 UTC | NightshiftOracle | `PriceUpdated` | [0x42736fba…3317f4](https://basescan.org/tx/0x42736fba67a57a752ba4a2bd16fa33cc0c7c763204b736600bfb453af23317f4) |
| 2026-11-05 19:17 UTC | NightshiftOracle | `PriceUpdated` | [0xe4787fbd…cf0ec6](https://basescan.org/tx/0xe4787fbdcb72c07e5713b8b63d510801c48281b26bdda740c277d916d3cf0ec6) |
| 2026-11-05 17:31 UTC | NightshiftOracle | `PriceUpdated` | [0xeaa778b8…7da545](https://basescan.org/tx/0xeaa778b8c8a3a2cbf7efca84b22353214b5dec69f44bdc7878dac13dc47da545) |
| 2026-11-05 14:14 UTC | NightshiftOracle | `PriceUpdated` | [0x70d07fd3…eed6b6](https://basescan.org/tx/0x70d07fd35ca0709aa074c7ea1d46cd98f587080fdc2707f2da0cdb8369eed6b6) |
| 2026-11-05 12:31 UTC | NightshiftOracle | `PriceUpdated` | [0x8aa48274…d53043](https://basescan.org/tx/0x8aa48274f1e057dc3c798523979029ceab901b5a9e3259151a64fcf14ed53043) |
| 2026-11-05 10:53 UTC | StackPlan | `Skipped` | [0xf4308d11…5d4a0a](https://basescan.org/tx/0xf4308d11a09eda05804f111b44bb3adac3ea15aa35d508656d5c14f8bb5d4a0a) |
| 2026-11-05 10:52 UTC | StackPlan | `Skipped` | [0xa30cd52f…ac57d2](https://basescan.org/tx/0xa30cd52fdb157281d0027b3dda594cd94ea90e520016d6386b0ed5dd2aac57d2) |
| 2026-11-05 10:51 UTC | NightshiftOracle | `PriceUpdated` | [0xb12bf15f…31bca9](https://basescan.org/tx/0xb12bf15f50ea76547ae2f6456de0ad2c9505f4ddf0e5a12e988bc54be631bca9) |
| 2026-11-05 09:17 UTC | NightshiftOracle | `PriceUpdated` | [0x49fa2174…966897](https://basescan.org/tx/0x49fa217458208cf78414ec5abadf3d5741e6e341ddbdce2b7a8146312c966897) |
| 2026-11-05 07:31 UTC | NightshiftOracle | `PriceUpdated` | [0x29b4bcbe…996b8b](https://basescan.org/tx/0x29b4bcbe38e783f741cd853a691d02a9d1f8c20eb96985c6ce01e48524996b8b) |
| 2026-11-05 05:51 UTC | NightshiftOracle | `PriceUpdated` | [0x55665f33…0db99e](https://basescan.org/tx/0x55665f33c53783812000b848a4316537630a1ffc3d13c8280390f0d0ec0db99e) |
| 2026-11-05 04:14 UTC | NightshiftOracle | `PriceUpdated` | [0x6577bec7…b5c582](https://basescan.org/tx/0x6577bec7488054b026a983376170552d07cc2e98f47e753656a868b8eab5c582) |
| 2026-11-05 02:31 UTC | NightshiftOracle | `PriceUpdated` | [0x8d4011ee…2379d4](https://basescan.org/tx/0x8d4011eec8ef1a66ab8406b579d539dec2ecbad0c777be3a73d01a0b9f2379d4) |
| 2026-11-05 00:53 UTC | StackPlan | `Skipped` | [0xd7678096…abe870](https://basescan.org/tx/0xd7678096fa1b2064e86ab8d0e0835b2dc091c56f4b7ee23d91fefed379abe870) |
| 2026-11-05 00:52 UTC | StackPlan | `Skipped` | [0x53ba6321…f0dc10](https://basescan.org/tx/0x53ba63211f2e89bb0be07c9cc116f8fe0c6da84ed0bcafc6a66021f730f0dc10) |
| 2026-11-05 00:51 UTC | NightshiftOracle | `PriceUpdated` | [0x2ed9e393…9b5040](https://basescan.org/tx/0x2ed9e3933ff3ceff68ff1176fd3e2d7eaae5de00c04cd23280da72356c9b5040) |
| 2026-11-04 23:17 UTC | NightshiftOracle | `PriceUpdated` | [0xc06954cd…17c2d2](https://basescan.org/tx/0xc06954cd501c0366a6efe08b66b100ac8dc5bcf09f79481e7bfda5929a17c2d2) |

## Check it yourself

1. Open any address above on Basescan; the *Contract* tab shows the verified source (Sourcify).
2. Re-run this report: `node scripts/base-proof.mjs` (no keys needed; it reads Base through a public RPC).
3. Live views on the site: [nightshift.buzz/transactions](https://nightshift.buzz/transactions) (every transaction), [nightshift.buzz/transparency](https://nightshift.buzz/transparency) (contracts, proofs, record), [nightshift.buzz/api/chain](https://nightshift.buzz/api/chain) (on-chain state as JSON).
