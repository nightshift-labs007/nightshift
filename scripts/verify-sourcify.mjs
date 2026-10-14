// Publishes the deployed contracts' source code on Sourcify (free, no API key), so anyone can read and check it on
// Basescan/Blockscout. Usage (after a deploy): node scripts/verify-sourcify.mjs
import fs from "node:fs";

const D = JSON.parse(fs.readFileSync("lib/chain/deployment.json", "utf8"));
if (!D.deployed) throw new Error("not deployed");
const stdJsonInput = JSON.parse(fs.readFileSync("contracts/build/standard-input.json", "utf8"));
const { version } = JSON.parse(fs.readFileSync("contracts/build/compiler.json", "utf8"));
// SOURCIFY_ONLY=upgrade: just the contracts from the security-review upgrade (scripts/deploy-upgrade.mjs); the earlier
// ones were verified at their own deploy, against the sources they were compiled from.
const upgrade = [
  ["NightshiftVault.sol:NightshiftVault", D.contracts.vault],
  ...(D.contracts.cloakRegistry ? [["CloakRegistry.sol:CloakRegistry", D.contracts.cloakRegistry]] : []),
  ...Object.values(D.tokens).map((t) => ["NightshiftOracle.sol:MorphoOracleAdapter", t.adapter]),
  ...Object.values(D.tokens).filter((t) => t.feed).map((t) => ["NightshiftOracle.sol:NightshiftAggregatorV3", t.feed]),
];
const targets =
  process.env.SOURCIFY_ONLY === "upgrade"
    ? upgrade
    : [
        ...upgrade,
        ["NightshiftOracle.sol:NightshiftOracle", D.contracts.oracle],
        ["SolvencyVerifier.sol:Groth16Verifier", D.contracts.verifier],
        ["TestToken.sol:TestToken", D.contracts.usdg],
        ...Object.values(D.tokens).map((t) => ["TestToken.sol:TestToken", t.address]),
      ];
for (const [contractIdentifier, address] of targets) {
  const res = await fetch(`https://sourcify.dev/server/v2/verify/${D.chainId}/${address}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ stdJsonInput, compilerVersion: version, contractIdentifier }),
  });
  const j = await res.json().catch(() => ({}));
  console.log(`${contractIdentifier.padEnd(42)} ${address}  ${res.status} ${j.verificationId ? "submitted" : JSON.stringify(j).slice(0, 120)}`);
}
console.log(`Status: https://sourcify.dev/  ·  ${D.explorer}/address/${D.contracts.vault}#code`);
