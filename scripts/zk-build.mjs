// Rebuilds the Cloak ZK circuit and its Groth16 keys into public/zk.
// Only needed if you change zk/solvency.circom. Usage: npm run zk:build
import { execSync } from "node:child_process";
import { copyFileSync, existsSync, rmSync } from "node:fs";
import { randomBytes } from "node:crypto";

const run = (cmd) => execSync(cmd, { cwd: "zk", stdio: "inherit" });
const snarkjs = "node ../node_modules/snarkjs/build/cli.cjs";
const PTAU_URL = "https://pse-trusted-setup-ppot.s3.eu-central-1.amazonaws.com/pot28_0080/ppot_0080_12.ptau";

run("npx circom2 solvency.circom --r1cs --wasm --sym -l ../node_modules -o .");
if (!existsSync("zk/pot12.ptau")) run(`curl -L -o pot12.ptau ${PTAU_URL}`);
run(`${snarkjs} groth16 setup solvency.r1cs pot12.ptau solvency_0000.zkey`);
run(`${snarkjs} zkey contribute solvency_0000.zkey solvency_final.zkey --name=nightshift -e=${randomBytes(32).toString("hex")}`);
run(`${snarkjs} zkey export verificationkey solvency_final.zkey verification_key.json`);
rmSync("zk/solvency_0000.zkey");

for (const f of ["solvency_js/solvency.wasm", "solvency_final.zkey", "verification_key.json"]) {
  copyFileSync(`zk/${f}`, `public/zk/${f.split("/").pop()}`);
}
copyFileSync("node_modules/snarkjs/build/snarkjs.min.js", "public/zk/snarkjs.min.js");
console.log("ZK artifacts written to public/zk");
