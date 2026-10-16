// Read-only preflight: confirms the RPC answers, the chain id, and the deployer balance.
const { ethers, network } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("No deployer key: create .secrets/deployer.key or set PORTALDOT_PRIVATE_KEY");
  const net = await ethers.provider.getNetwork();
  const bal = await ethers.provider.getBalance(deployer.address);
  const block = await ethers.provider.getBlockNumber();
  console.log(`network   ${network.name} (chainId ${net.chainId})`);
  console.log(`block     ${block}`);
  console.log(`deployer  ${deployer.address}`);
  console.log(`balance   ${bal} wei-units (${ethers.formatEther(bal)} as 18-dec)`);
  if (bal === 0n) console.log("Fund the deployer's mapped SS58 address (reviveApi.accountId) with tPOTv3 first.");
}

main().catch((e) => {
  console.error(e.message || e);
  process.exitCode = 1;
});
