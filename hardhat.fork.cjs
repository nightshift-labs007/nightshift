// Local copy of a live chain for rehearsing a deploy: npx hardhat node --config hardhat.fork.cjs --port 8546
// Base mainnet by default; for Base Sepolia: FORK_URL=https://sepolia.base.org FORK_CHAIN_ID=84532
module.exports = {
  solidity: "0.8.26",
  networks: {
    hardhat: {
      chainId: Number(process.env.FORK_CHAIN_ID || 8453),
      forking: { url: process.env.FORK_URL || "https://mainnet.base.org" },
    },
  },
};
