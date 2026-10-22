require("@nomicfoundation/hardhat-toolbox");
const fs = require("fs");
const path = require("path");

// The deployer key lives only in .secrets/deployer.key (gitignored) or the PORTALDOT_PRIVATE_KEY env var.
function deployerKey() {
  if (process.env.PORTALDOT_PRIVATE_KEY) return [process.env.PORTALDOT_PRIVATE_KEY];
  const f = path.join(__dirname, ".secrets", "deployer.key");
  return fs.existsSync(f) ? [fs.readFileSync(f, "utf8").trim()] : [];
}

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "paris" },
  },
  networks: {
    // PortaldotV3 Testnet (pallet-revive Ethereum RPC). Source: official PortaldotV3 Testnet guide.
    portaldot: {
      url: process.env.PORTALDOT_RPC || "https://test-evm-rpc-v3.portaldot.dev",
      chainId: 420420777,
      accounts: deployerKey(),
      timeout: 120000,
    },
  },
};

// Local rehearsal against `npx hardhat node` using the same deployer key (see README).
module.exports.networks.localhost = { url: "http://127.0.0.1:8545", accounts: deployerKey() };
