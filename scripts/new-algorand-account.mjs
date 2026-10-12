// Generates a fresh Algorand TestNet account for the Nightshift Ledger.
// Usage: npm run algo:account
import algosdk from "algosdk";

const acct = algosdk.generateAccount();
console.log("\nAddress (fund this at https://lora.algokit.io/testnet/fund):\n  " + acct.addr.toString());
console.log("\nALGORAND_MNEMONIC (keep secret, paste into Vercel env vars):\n  " + algosdk.secretKeyToMnemonic(acct.sk) + "\n");
