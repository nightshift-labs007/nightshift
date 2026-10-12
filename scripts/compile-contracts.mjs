// Compiles contracts/*.sol with solc and writes lib/chain/artifacts.json ({ name: { abi, bytecode } }).
// Usage: npm run contracts:compile
import fs from "node:fs";
import path from "node:path";
import solc from "solc";

const dir = "contracts";
const sources = {};
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".sol"))) {
  sources[f] = { content: fs.readFileSync(path.join(dir, f), "utf8") };
}

const input = {
  language: "Solidity",
  sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    viaIR: true,
    evmVersion: "paris",
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
  },
};

const resolveImport = (p) => {
  const file = path.join(dir, path.basename(p));
  return fs.existsSync(file) ? { contents: fs.readFileSync(file, "utf8") } : { error: `not found: ${p}` };
};

const out = JSON.parse(solc.compile(JSON.stringify(input), { import: resolveImport }));
const errors = (out.errors ?? []).filter((e) => e.severity === "error");
for (const e of out.errors ?? []) console[e.severity === "error" ? "error" : "warn"](e.formattedMessage);
if (errors.length) process.exit(1);

const WANT = ["TestToken", "NightshiftOracle", "MorphoOracleAdapter", "NightshiftVault", "Groth16Verifier"];
const artifacts = {};
for (const file of Object.values(out.contracts)) {
  for (const [name, c] of Object.entries(file)) {
    if (WANT.includes(name)) artifacts[name] = { abi: c.abi, bytecode: `0x${c.evm.bytecode.object}` };
  }
}
fs.mkdirSync("lib/chain", { recursive: true });
fs.writeFileSync("lib/chain/artifacts.json", JSON.stringify(artifacts));
// ABIs only (no bytecode) for the app bundle
fs.writeFileSync("lib/chain/abis.json", JSON.stringify(Object.fromEntries(Object.entries(artifacts).map(([k, v]) => [k, v.abi]))));
console.log("compiled:", Object.keys(artifacts).map((k) => `${k} (${(artifacts[k].bytecode.length / 2 / 1024).toFixed(1)} KB)`).join(", "));
