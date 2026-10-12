// Local copy of Base mainnet for rehearsing a mainnet deploy: npx hardhat node --config hardhat.fork.cjs --port 8546
module.exports = {
  solidity: "0.8.26",
  networks: {
    hardhat: {
      chainId: 8453,
      forking: { url: process.env.FORK_URL || "https://mainnet.base.org" },
    },
  },
};
