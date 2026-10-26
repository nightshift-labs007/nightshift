// Creates real Morpho Blue markets on Base for the Nightshift demo tokens: collateral dSPY/dQQQ/dGLD/dIBIT, loan dUSDG,
// priced by Nightshift's MorphoOracleAdapter (1e36 scale, refuses prices older than a day), Morpho's AdaptiveCurveIrm,
// and the same LLTVs as the Vault. Morpho market creation is permissionless and markets have no owner.
// Then it seeds each market with demo dUSDG and runs one full loan on dSPY (supply collateral → borrow → repay →
// withdraw) to prove the market works end to end. Writes the market ids into lib/chain/deployment.json.
//
//   node --env-file=.env.local scripts/create-morpho-markets.mjs              (checks only, no transactions)
//   EXECUTE=1 node --env-file=.env.local scripts/create-morpho-markets.mjs    (Base mainnet)
//
// Gas: the faucet wallet (minter of the demo tokens) sends every transaction.
import fs from "node:fs";
import { createPublicClient, createWalletClient, encodeAbiParameters, fallback, formatEther, http, keccak256, maxUint256, parseAbi, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

const EXECUTE = process.env.EXECUTE === "1";
const ONLY = process.env.ONLY?.trim(); // e.g. ONLY=SLV: create just that market (and run the end-to-end loan on it)
const MORPHO = "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb"; // Morpho Blue, same address on every chain
const IRM = "0x46415998764C29aB2a25CbeA6254146D50D22687"; // AdaptiveCurveIrm on Base
const SEED = parseEther("1000000"); // demo dUSDG supplied to each market

const D = JSON.parse(fs.readFileSync("lib/chain/deployment.json", "utf8"));
if (D.chainId !== 8453) throw new Error("deployment.json is not the Base mainnet deployment");

const transport = fallback([http("https://mainnet.base.org", { retryCount: 4, retryDelay: 1500 }), http("https://base-rpc.publicnode.com", { retryCount: 4 })]);
const pub = createPublicClient({ chain: base, transport });
const wallet = createWalletClient({ chain: base, transport, account: privateKeyToAccount(process.env.FAUCET_PRIVATE_KEY.trim()) });
const me = wallet.account.address;

const P = "(address loanToken, address collateralToken, address oracle, address irm, uint256 lltv)";
const morphoAbi = parseAbi([
  `function createMarket(${P} marketParams)`,
  `function supply(${P} marketParams, uint256 assets, uint256 shares, address onBehalf, bytes data) returns (uint256, uint256)`,
  `function supplyCollateral(${P} marketParams, uint256 assets, address onBehalf, bytes data)`,
  `function borrow(${P} marketParams, uint256 assets, uint256 shares, address onBehalf, address receiver) returns (uint256, uint256)`,
  `function repay(${P} marketParams, uint256 assets, uint256 shares, address onBehalf, bytes data) returns (uint256, uint256)`,
  `function withdrawCollateral(${P} marketParams, uint256 assets, address onBehalf, address receiver)`,
  "function market(bytes32 id) view returns (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee)",
  "function position(bytes32 id, address user) view returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral)",
  "function isIrmEnabled(address irm) view returns (bool)",
  "function isLltvEnabled(uint256 lltv) view returns (bool)",
]);
const erc20 = parseAbi([
  "function approve(address spender, uint256 value) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function mint(address to, uint256 value)",
]);
const adapterAbi = parseAbi(["function price() view returns (uint256)"]);

const marketId = (p) =>
  keccak256(encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "uint256" }], [p.loanToken, p.collateralToken, p.oracle, p.irm, p.lltv]));

let nonce = await pub.getTransactionCount({ address: me, blockTag: "pending" });
const txs = [];
async function send(label, address, abi, functionName, args) {
  if (!EXECUTE) return console.log(`  (would) ${label}`);
  const hash = await wallet.writeContract({ address, abi, functionName, args, nonce: nonce++ });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${label} failed: ${hash}`);
  txs.push({ label, hash });
  await new Promise((r) => setTimeout(r, 3500)); // public RPCs are load-balanced: let every node see this transaction before the next call
  console.log(`  ${label.padEnd(44)} ${hash}`);
}

console.log(`faucet wallet ${me}: ${formatEther(await pub.getBalance({ address: me }))} ETH${EXECUTE ? "" : " (checks only)"}`);
const [irmOk, ...lltvOk] = await Promise.all([
  pub.readContract({ address: MORPHO, abi: morphoAbi, functionName: "isIrmEnabled", args: [IRM] }),
  ...Object.values(D.tokens).map((t) => pub.readContract({ address: MORPHO, abi: morphoAbi, functionName: "isLltvEnabled", args: [parseEther(String(t.lltv))] })),
]);
if (!irmOk || lltvOk.includes(false)) throw new Error(`Morpho: IRM enabled ${irmOk}, LLTVs enabled ${lltvOk}`);
console.log("Morpho Blue on Base: IRM and LLTVs enabled");

const usdg = D.contracts.usdg;
const markets = {};
// Morpho must be allowed to pull dUSDG before the first supply
if (EXECUTE && (await pub.readContract({ address: usdg, abi: erc20, functionName: "allowance", args: [me, MORPHO] })) < maxUint256 / 2n)
  await send("approve Morpho for dUSDG", usdg, erc20, "approve", [MORPHO, maxUint256]);
for (const [sym, t] of Object.entries(D.tokens).filter(([sym]) => !ONLY || sym === ONLY)) {
  const params = { loanToken: usdg, collateralToken: t.address, oracle: t.adapter, irm: IRM, lltv: parseEther(String(t.lltv)) };
  const id = marketId(params);
  const price = await pub.readContract({ address: t.adapter, abi: adapterAbi, functionName: "price" });
  const m = await pub.readContract({ address: MORPHO, abi: morphoAbi, functionName: "market", args: [id] });
  const exists = m[4] > 0n; // lastUpdate is set on creation
  console.log(`d${sym}: market ${id} ${exists ? "exists" : "new"}, oracle price ${(Number(price / 10n ** 30n) / 1e6).toFixed(2)} dUSDG`);
  if (!exists) await send(`create market d${sym} / dUSDG, LLTV ${t.lltv}`, MORPHO, morphoAbi, "createMarket", [params]);
  if (m[0] < SEED) {
    await send(`mint ${formatEther(SEED)} dUSDG for d${sym} market`, usdg, erc20, "mint", [me, SEED]);
    await send(`supply ${formatEther(SEED)} dUSDG to d${sym} market`, MORPHO, morphoAbi, "supply", [params, SEED, 0n, me, "0x"]);
  }
  markets[sym] = { id, ...params, lltv: t.lltv };
}

// one full loan on dSPY: collateral 1 dSPY, borrow 50% of its value, repay all, take the collateral back
const spy = markets[ONLY ?? "SPY"]; // the market the end-to-end loan runs on
const params = { loanToken: spy.loanToken, collateralToken: spy.collateralToken, oracle: spy.oracle, irm: spy.irm, lltv: parseEther(String(spy.lltv)) };
const one = parseEther("1");
const priceSpy = await pub.readContract({ address: spy.oracle, abi: adapterAbi, functionName: "price" });
const borrowAmt = (priceSpy * one) / 10n ** 36n / 2n;
console.log(`End-to-end loan on d${ONLY ?? "SPY"} (borrow ${formatEther(borrowAmt)} dUSDG against 1 dSPY):`);
if (EXECUTE && (await pub.readContract({ address: usdg, abi: erc20, functionName: "allowance", args: [me, MORPHO] })) < maxUint256 / 2n)
  await send("approve Morpho for dUSDG", usdg, erc20, "approve", [MORPHO, maxUint256]);
else if (!EXECUTE) console.log("  (would) approve Morpho for dUSDG");
await send(`mint 1 d${ONLY ?? "SPY"}`, spy.collateralToken, erc20, "mint", [me, one]);
await send(`approve Morpho for d${ONLY ?? "SPY"}`, spy.collateralToken, erc20, "approve", [MORPHO, maxUint256]);
await send(`supply 1 d${ONLY ?? "SPY"} as collateral`, MORPHO, morphoAbi, "supplyCollateral", [params, one, me, "0x"]);
await send(`borrow ${formatEther(borrowAmt)} dUSDG`, MORPHO, morphoAbi, "borrow", [params, borrowAmt, 0n, me, me]);
if (EXECUTE) {
  const pos = await pub.readContract({ address: MORPHO, abi: morphoAbi, functionName: "position", args: [spy.id, me] });
  console.log(`  position: collateral ${formatEther(pos[2])} d${ONLY ?? "SPY"}, borrow shares ${pos[1]}`);
  await send("mint a little dUSDG for interest", usdg, erc20, "mint", [me, parseEther("1")]);
  await send("repay the whole loan (by shares)", MORPHO, morphoAbi, "repay", [params, 0n, pos[1], me, "0x"]);
} else console.log("  (would) repay the whole loan (by shares)");
await send(`withdraw 1 d${ONLY ?? "SPY"}`, MORPHO, morphoAbi, "withdrawCollateral", [params, one, me, me]);

if (EXECUTE) {
  const next = { ...D, morpho: { address: MORPHO, irm: IRM, createdAt: new Date().toISOString(), markets: Object.fromEntries(Object.entries({ ...Object.fromEntries(Object.entries(D.morpho?.markets ?? {}).map(([s, m]) => [s, { ...m }])), ...markets }).map(([s, m]) => [s, { id: m.id, lltv: m.lltv }])), e2e: txs.slice(-6) } };
  fs.writeFileSync("lib/chain/deployment.json", JSON.stringify(next, null, 2) + "\n");
  console.log("wrote lib/chain/deployment.json");
}
for (const [s, m] of Object.entries(markets)) console.log(`d${s}: https://app.morpho.org/base/market/${m.id}`);
