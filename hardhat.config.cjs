// Local test chain only (npx hardhat node --config hardhat.config.cjs). Not used for deployment.
module.exports = { solidity: "0.8.26", networks: { hardhat: { chainId: 31337 } } };
