// Links the Lean proofs to the real contracts (formal spec, Section 10):
//  1. every vector emitted by the Lean Vault model (test/vectors/vectors.json) must be reproduced exactly by NightshiftVault;
//  2. regression test for the Guardian's G4 rule: protect() must refuse to sell when selling can't restore health.
// Deploys its own contracts on a local chain. Run `npm run chain:local` first, then `npm run formal:test`.
import fs from "node:fs";
import { createPublicClient, createWalletClient, defineChain, http, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const A = JSON.parse(fs.readFileSync("lib/chain/artifacts.json", "utf8"));
const V = JSON.parse(fs.readFileSync("test/vectors/vectors.json", "utf8"));
const chain = defineChain({ id: 31337, name: "local", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const pub = createPublicClient({ chain, transport: http() });
const wallet = (k) => createWalletClient({ chain, transport: http(), account: privateKeyToAccount(k) });
// Hardhat's public test accounts #0 (owner/keeper) and #1 (borrower)
const owner = wallet("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const user = wallet("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");

let pass = 0;
let fail = 0;
const check = (label, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`);
  ok ? pass++ : fail++;
};
const deploy = async (name, args = []) => {
  const hash = await owner.deployContract({ abi: A[name].abi, bytecode: A[name].bytecode, args });
  return (await pub.waitForTransactionReceipt({ hash })).contractAddress;
};
const tx = async (w, address, name, fn, args) => pub.waitForTransactionReceipt({ hash: await w.writeContract({ address, abi: A[name].abi, functionName: fn, args }) });
const read = (address, name, fn, args = []) => pub.readContract({ address, abi: A[name].abi, functionName: fn, args });
const reverts = async (p, reason) => {
  try {
    await p;
    return false;
  } catch (e) {
    return reason ? String(e?.message ?? e).includes(reason) : true;
  }
};
const big = (s) => BigInt(s);

const usdg = await deploy("TestToken", ["Test USDG", "tUSDG", parseEther("1000")]);
const oracle = await deploy("NightshiftOracle");
const vault = await deploy("NightshiftVault", [usdg, oracle]);
await tx(owner, oracle, "NightshiftOracle", "setUpdater", [owner.account.address, true]);
await tx(owner, usdg, "TestToken", "mint", [vault, 10n ** 40n]);

/** A fresh collateral token + market per case, so deposits never accumulate across cases. */
async function market(lltv, collateral, price, conf) {
  const t = await deploy("TestToken", ["Case", "CASE", 1n]);
  await tx(owner, vault, "NightshiftVault", "setMarket", [t, lltv, true]);
  await tx(owner, oracle, "NightshiftOracle", "setPrices", [[t], [price], [conf]]);
  await tx(owner, t, "TestToken", "mint", [user.account.address, collateral]);
  await tx(user, t, "TestToken", "approve", [vault, collateral]);
  await tx(user, vault, "NightshiftVault", "deposit", [t, collateral]);
  return t;
}

// 1a. pure liquidation incentive factor
for (const v of V.lif) {
  const got = await read(vault, "NightshiftVault", "lif", [big(v.l)]);
  check(`lif(${v.l}) matches Lean`, got === big(v.lif), `${got} vs ${v.lif}`);
}

// 1b. collateral value and borrow limit
for (const v of V.limits) {
  if (big(v.l) === 0n || big(v.l) >= 10n ** 18n) continue; // setMarket only accepts 0 < LLTV < 1
  const t = await market(big(v.l), big(v.c), big(v.p), Number(v.conf));
  const value = await read(vault, "NightshiftVault", "collateralValue", [user.account.address, t]);
  const limit = await read(vault, "NightshiftVault", "borrowLimit", [user.account.address, t]);
  check(`collateralValue c=${v.c} p=${v.p} matches Lean`, value === big(v.value), `${value} vs ${v.value}`);
  check(`borrowLimit conf=${v.conf} matches Lean`, limit === big(v.borrowLimit), `${limit} vs ${v.borrowLimit}`);
}

// 1c. health factor after a price move, and whether liquidation is allowed
for (const v of V.hf) {
  const t = await market(big(v.l), big(v.c), big(v.p0), Number(v.conf));
  const limit = await read(vault, "NightshiftVault", "borrowLimit", [user.account.address, t]);
  check(`limit at borrow matches Lean (case d=${v.d})`, limit === big(v.limitAtBorrow), `${limit} vs ${v.limitAtBorrow}`);
  await tx(user, vault, "NightshiftVault", "borrow", [t, big(v.d)]);
  await tx(owner, oracle, "NightshiftOracle", "setPrices", [[t], [big(v.p1)], [Number(v.conf)]]);
  const hf = await read(vault, "NightshiftVault", "healthFactor", [user.account.address, t]);
  check(`healthFactor after move matches Lean`, hf === big(v.hf), `${hf} vs ${v.hf}`);
  const liquidatable = !(await reverts(pub.simulateContract({ address: vault, abi: A.NightshiftVault.abi, functionName: "liquidate", args: [user.account.address, t, 1n], account: owner.account }), "healthy"));
  check(`liquidation ${v.liquidatable ? "allowed" : "refused"} as Lean predicts`, liquidatable === v.liquidatable);
}

// 2. G4 regression: with LLTV 99.8% (above 1 − 0.5% slippage), health can be ≥ 1 while the collateral,
// sold at the slippage price, no longer covers the debt. protect() must refuse ("alert only").
{
  const W = 10n ** 18n;
  const t = await market((998n * W) / 1000n, 10n * W, 100n * W, 100);
  await tx(user, vault, "NightshiftVault", "borrow", [t, 990n * W]); // limit at conf 100 is 998
  await tx(user, vault, "NightshiftVault", "setRule", [t, 2, (12n * W) / 10n, (14n * W) / 10n]);
  // price 99.4: value 994, HF = 994 × 0.998 / 990 ≈ 1.002 (≥ 1, below trigger); 994 × 0.995 ≈ 989 < 990 debt
  await tx(owner, oracle, "NightshiftOracle", "setPrices", [[t], [(994n * W) / 10n], [100]]);
  const hf = await read(vault, "NightshiftVault", "healthFactor", [user.account.address, t]);
  check("G4 setup: health ≥ 1 but collateral after slippage < debt", hf >= W && hf < (12n * W) / 10n, `HF ${Number(hf) / 1e18}`);
  check(
    "G4: protect() refuses to sell when selling can't help",
    await reverts(tx(owner, vault, "NightshiftVault", "protect", [user.account.address, t]), "insolvent: alert only"),
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
