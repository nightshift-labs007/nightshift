// Builds docs/BASE_MAINNET_PROOF.md: every Nightshift contract on Base mainnet, whether its source is verified, what has
// happened on it (read from Base itself: event logs since the deployment), and what Nightshift's operator wallets have
// sent. Every line links to Basescan so anyone can check it. Read-only; no keys needed.
//   node scripts/base-proof.mjs
import fs from "node:fs";
import { createPublicClient, http, parseEventLogs, formatEther, formatUnits } from "viem";
import { base } from "viem/chains";

const D = JSON.parse(fs.readFileSync("lib/chain/deployment.json", "utf8"));
const A = JSON.parse(fs.readFileSync("lib/chain/artifacts.json", "utf8"));
if (D.chainId !== 8453) throw new Error("deployment.json is not Base mainnet");
const SCAN = "https://basescan.org";
const pub = createPublicClient({ chain: base, transport: http("https://base-rpc.publicnode.com", { retryCount: 5, retryDelay: 2000, timeout: 60_000 }) });
const tx = (h) => `[${h.slice(0, 10)}…${h.slice(-6)}](${SCAN}/tx/${h})`;
const ad = (a) => `[\`${a.slice(0, 6)}…${a.slice(-4)}\`](${SCAN}/address/${a})`;
const adFull = (a) => `[\`${a}\`](${SCAN}/address/${a})`;
const SPAN = 50_000n;

// ---- what to read: each contract with the ABI that names its events
const contracts = [
  { name: "NightshiftOracle", role: "On-chain fair values + confidence (pushed by the updater)", address: D.contracts.oracle, abi: A.NightshiftOracle.abi },
  { name: "NightshiftVault", role: "Lending: deposit, borrow, repay, withdraw, Guardian protect, liquidation", address: D.contracts.vault, abi: A.NightshiftVault.abi },
  { name: "Groth16Verifier", role: "Zero-knowledge solvency proof verifier (Cloak)", address: D.contracts.verifier, abi: A.Groth16Verifier.abi },
  ...(D.contracts.cloakRegistry ? [{ name: "CloakRegistry", role: "Records accepted solvency proofs against the Oracle price", address: D.contracts.cloakRegistry, abi: A.CloakRegistry.abi }] : []),
  ...(D.stack ? [
    { name: "StackPlan", role: "Recurring gold/silver buys, only at a fair price", address: D.stack.plan, abi: A.StackPlan.abi },
    { name: "StackDemoPool", role: "Venue Stack buys from (demo tokens)", address: D.stack.pool, abi: A.StackDemoPool.abi },
  ] : []),
  ...(D.predictions ? [{ name: "NightshiftPredictions", role: `"Call the Open" prediction rounds (${D.predictions.stake?.symbol ?? "demo"} stakes)`, address: D.predictions.address, abi: A.NightshiftPredictions.abi, from: BigInt(D.predictions.startBlock) }] : []),
  ...(D.predictionsPrevious ?? []).map((p) => ({ name: "NightshiftPredictions (retired, demo stakes)", role: "First prediction contract, replaced by the USDC one; no rounds", address: p.address, abi: A.NightshiftPredictions.abi })),
  { name: `${D.symbolPrefix ?? "d"}USDG`, role: "Demo dollar (loan token for the Vault and Stack); no value", address: D.contracts.usdg, abi: A.TestToken.abi, token: true },
  ...Object.entries(D.tokens).flatMap(([s, t]) => [
    { name: `${D.symbolPrefix ?? "d"}${s}`, role: `Demo ${s} token (collateral); no value`, address: t.address, abi: A.TestToken.abi, token: true },
    { name: `${s} Morpho oracle adapter`, role: "Nightshift price in Morpho Blue's IOracle format", address: t.adapter, abi: A.MorphoOracleAdapter.abi, quiet: true },
    ...(t.feed ? [{ name: `${s} / USD feed`, role: "Nightshift price in Chainlink AggregatorV3 format", address: t.feed, abi: A.NightshiftAggregatorV3.abi, quiet: true }] : []),
  ]),
];
const byAddr = new Map(contracts.map((c) => [c.address.toLowerCase(), c]));

const latest = await pub.getBlockNumber();
const latestBlock = await pub.getBlock({ blockNumber: latest });
const timeOf = (bn) => Number(latestBlock.timestamp) - Number(latest - bn) * 2; // Base makes a block every 2 seconds
const day = (bn) => new Date(timeOf(bn) * 1000).toISOString().slice(0, 16).replace("T", " ") + " UTC";
const start = BigInt(Math.min(...[D.startBlock, D.upgradeStartBlock].filter(Boolean)));

// ---- every log from every Nightshift contract since the deployment, in 50k-block pages
const logs = [];
const addresses = contracts.map((c) => c.address);
process.stdout.write(`reading blocks ${start}…${latest}`);
for (let from = start; from <= latest; from += SPAN) {
  const to = from + SPAN - 1n > latest ? latest : from + SPAN - 1n;
  for (let i = 0; i < addresses.length; i += 10) logs.push(...(await pub.getLogs({ address: addresses.slice(i, i + 10), fromBlock: from, toBlock: to }))); // the public node takes 10 addresses per query
  process.stdout.write(".");
}
console.log(` ${logs.length} logs`);

// ---- decode per contract
const events = []; // { contract, name, args, hash, block }
for (const c of contracts) {
  const mine = logs.filter((l) => l.address.toLowerCase() === c.address.toLowerCase());
  for (const e of parseEventLogs({ abi: c.abi, logs: mine, strict: false })) events.push({ c, name: e.eventName, args: e.args, hash: e.transactionHash, block: e.blockNumber });
}
const txHashes = new Set(events.map((e) => e.hash));

// ---- source verification (Sourcify), code present
const verified = {};
for (const c of contracts) {
  const r = await fetch(`https://sourcify.dev/server/v2/contract/8453/${c.address}`).then((x) => (x.ok ? x.json() : null)).catch(() => null);
  verified[c.address] = r?.match ?? r?.runtimeMatch ?? null;
}
const code = {};
for (const c of contracts) code[c.address] = ((await pub.getCode({ address: c.address })) ?? "0x").length > 2;

// ---- operator wallets
const roles = { Owner: D.owner, "Oracle updater + public record": D.roles.updater, Keeper: D.roles.keeper, "Faucet + gas cover": D.roles.faucet };
const wallets = [];
for (const [role, a] of Object.entries(roles)) {
  wallets.push({ role, a, sent: await pub.getTransactionCount({ address: a }), eth: Number(formatEther(await pub.getBalance({ address: a }))) });
}

// ---- the public record on Base (notes written by the updater): from the live site's index, each a Base transaction
const site = "https://nightshift.buzz";
const ledger = await fetch(`${site}/api/ledger`).then((r) => r.json()).catch(() => null);
const predict = await fetch(`${site}/api/predict`).then((r) => r.json()).catch(() => null);
const manifest = JSON.parse(fs.readFileSync("public/verified/manifest.json", "utf8"));

// ---- write
const count = (pred) => events.filter(pred).length;
const kinds = {};
for (const e of events) kinds[`${e.c.name}|${e.name}`] = (kinds[`${e.c.name}|${e.name}`] ?? 0) + 1;
const stakeDec = D.predictions?.stake?.decimals ?? 18;
const now = new Date().toISOString().slice(0, 16).replace("T", " ");
const L = [];
L.push(`# Nightshift on Base mainnet: on-chain proof`);
L.push("");
L.push(`Generated ${now} UTC from Base mainnet itself (chain 8453) by \`scripts/base-proof.mjs\`: event logs read from every Nightshift contract since block ${start} (${day(start)}) up to block ${latest} (${day(latest)}). Every address and transaction below links to Basescan, so each line can be checked independently.`);
L.push("");
L.push(`> Lending, Stack and the Vault use **demo tokens with no value**; prediction rounds use **real USDC with small caps** (10 per prediction, 25 per wallet per round). The contracts are unaudited.`);
L.push("");
L.push(`## At a glance`);
L.push("");
L.push(`| | |`);
L.push(`|---|---|`);
L.push(`| Nightshift contracts on Base | **${contracts.length}** (${contracts.filter((c) => verified[c.address]).length} source-verified on Sourcify) |`);
L.push(`| Contract events since launch | **${events.length.toLocaleString()}** in **${txHashes.size.toLocaleString()}** transactions |`);
L.push(`| Oracle price updates | **${count((e) => e.c.name === "NightshiftOracle" && e.name === "PriceUpdated").toLocaleString()}** |`);
L.push(`| Vault actions (deposit, borrow, repay, withdraw) | **${count((e) => e.c.name === "NightshiftVault" && ["Deposit", "Borrow", "Repay", "Withdraw"].includes(e.name)).toLocaleString()}** |`);
L.push(`| Guardian rules set / loans protected | **${count((e) => e.name === "RuleSet")}** / **${count((e) => e.name === "Protected")}** |`);
L.push(`| Stack plans / buys / skipped windows | **${count((e) => e.name === "PlanCreated")}** / **${count((e) => e.name === "Executed")}** / **${count((e) => e.name === "Skipped")}** |`);
L.push(`| Zero-knowledge proofs recorded | **${count((e) => e.c.name === "CloakRegistry")}** |`);
L.push(`| Prediction rounds opened / predictions placed | **${count((e) => e.name === "RoundCreated")}** / **${count((e) => e.name === "Bet")}** |`);
L.push(`| Transactions sent by Nightshift's operator wallets | **${wallets.reduce((s, w) => s + w.sent, 0).toLocaleString()}** |`);
L.push("");

L.push(`## Contracts`);
L.push("");
L.push(`| Contract | What it does | Address | Source verified | Events |`);
L.push(`|---|---|---|---|---|`);
for (const c of contracts) {
  const n = events.filter((e) => e.c === c).length;
  L.push(`| ${c.name} | ${c.role} | ${adFull(c.address)} | ${verified[c.address] ? `✅ Sourcify (${verified[c.address]})` : code[c.address] ? "bytecode live" : "—"} | ${n.toLocaleString()} |`);
}
L.push("");
L.push(`Owner of the contracts: ${adFull(D.owner)} (a single wallet; a multisig is planned before any larger real-money use).`);
L.push("");

L.push(`## What happened on each contract`);
L.push("");
L.push(`Counts of each event, with the first and the latest transaction for it.`);
L.push("");
L.push(`| Contract | Event | Count | First | Latest |`);
L.push(`|---|---|---|---|---|`);
for (const [k, n] of Object.entries(kinds).sort((a, b) => b[1] - a[1])) {
  const [cname, ename] = k.split("|");
  const list = events.filter((e) => e.c.name === cname && e.name === ename).sort((a, b) => Number(a.block - b.block));
  const first = list[0], last = list[list.length - 1];
  L.push(`| ${cname} | \`${ename}\` | ${n.toLocaleString()} | ${tx(first.hash)} · ${day(first.block)} | ${tx(last.hash)} · ${day(last.block)} |`);
}
L.push("");

const rounds = events.filter((e) => e.name === "RoundCreated" && e.c.address === D.predictions?.address);
if (rounds.length) {
  L.push(`## Prediction rounds (USDC)`);
  L.push("");
  L.push(`Each round's call is recorded on Base before predictions open; the round stores that record's transaction hash.`);
  L.push("");
  L.push(`| Round | ETF | Open | Nightshift's call | Opened in | Call recorded in |`);
  L.push(`|---|---|---|---|---|---|`);
  for (const e of rounds) {
    const tok = Buffer.from(e.args.token.slice(2), "hex").toString().replace(/\0+$/, "");
    const s = String(e.args.session);
    L.push(`| #${e.args.id} | ${tok} | ${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)} | $${(Number(e.args.strike) / 1e8).toFixed(2)} | ${tx(e.hash)} | ${/^0x0*$/.test(e.args.algorandTx) ? "—" : tx(e.args.algorandTx)} |`);
  }
  const bets = events.filter((e) => e.name === "Bet" && e.c.address === D.predictions?.address);
  if (bets.length) {
    L.push("");
    L.push(`| Prediction | Wallet | Side | Stake | Transaction |`);
    L.push(`|---|---|---|---|---|`);
    for (const b of bets) L.push(`| round #${b.args.id} | ${ad(b.args.user)} | ${["", "Higher", "Lower"][Number(b.args.side)]} | ${formatUnits(b.args.amount, stakeDec)} ${D.predictions.stake?.symbol ?? ""} | ${tx(b.hash)} |`);
  }
  L.push("");
}

L.push(`## The public record on Base`);
L.push("");
L.push(`Nightshift writes its pre-open calls, the evening calls behind prediction rounds and sign-ups as 0-ETH transactions from the updater wallet to itself; the input data is the note in plain text (Basescan → *Input Data* → *View as UTF-8*).`);
L.push("");
const notes = [];
for (const e of ledger?.entries ?? []) notes.push([`Pre-open call for ${e.session}`, e.txId]);
const recordTxs = [...new Set((predict?.rounds ?? []).map((r) => r.recordTx).filter(Boolean))];
for (const h of recordTxs) notes.push(["Evening call (strike of a prediction round)", h]);
if (manifest.anchor?.txId) notes.push([`Formal-proof manifest fingerprint \`${manifest.anchor.manifestSha256.slice(0, 16)}…\` (24 Lean-proven safety rules)`, manifest.anchor.txId]);
L.push(`| Note | Transaction |`);
L.push(`|---|---|`);
for (const [what, h] of notes) L.push(`| ${what} | ${tx(h)} |`);
L.push("");
L.push(`All record notes come from ${adFull(D.roles.updater)}.`);
L.push("");

L.push(`## Operator wallets`);
L.push("");
L.push(`| Role | Address | Transactions sent | ETH now |`);
L.push(`|---|---|---|---|`);
for (const w of wallets) L.push(`| ${w.role} | ${adFull(w.a)} | ${w.sent.toLocaleString()} | ${w.eth.toFixed(5)} |`);
L.push("");
L.push(`The updater pushes prices and writes the public record; the keeper runs the Guardian, Stack and the prediction rounds; the faucet mints demo tokens and covers members' gas. None of them can move users' funds: the contracts only let users move their own.`);
L.push("");

if (D.morpho?.e2e?.length) {
  L.push(`## Morpho Blue integration on Base`);
  L.push("");
  L.push(`Real Morpho Blue markets (${adFull(D.morpho.address)}) priced by Nightshift's oracle adapters, exercised end to end:`);
  L.push("");
  L.push(`| Step | Transaction |`);
  L.push(`|---|---|`);
  for (const s of D.morpho.e2e) L.push(`| ${s.label} | ${tx(s.hash)} |`);
  L.push("");
}

const recent = [...events].sort((a, b) => Number(b.block - a.block)).filter((e, i, arr) => arr.findIndex((x) => x.hash === e.hash) === i).slice(0, 30);
L.push(`## Latest 30 transactions`);
L.push("");
L.push(`| When (UTC) | Contract | Event | Transaction |`);
L.push(`|---|---|---|---|`);
for (const e of recent) L.push(`| ${day(e.block)} | ${e.c.name} | \`${e.name}\` | ${tx(e.hash)} |`);
L.push("");

L.push(`## Check it yourself`);
L.push("");
L.push(`1. Open any address above on Basescan; the *Contract* tab shows the verified source (Sourcify).`);
L.push(`2. Re-run this report: \`node scripts/base-proof.mjs\` (no keys needed; it reads Base through a public RPC).`);
L.push(`3. Live views on the site: [nightshift.buzz/transactions](${site}/transactions) (every transaction), [nightshift.buzz/transparency](${site}/transparency) (contracts, proofs, record), [nightshift.buzz/api/chain](${site}/api/chain) (on-chain state as JSON).`);
L.push("");
fs.writeFileSync("docs/BASE_MAINNET_PROOF.md", L.join("\n"));
console.log(`wrote docs/BASE_MAINNET_PROOF.md: ${contracts.length} contracts, ${events.length} events, ${txHashes.size} transactions`);
