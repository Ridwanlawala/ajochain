// Deploys MockNaira (tNGN test stablecoin) and AjoChain, then writes deployments/<network>.json
// and frontend/src/deployments.json so the web app picks up the addresses.
const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await ethers.getSigners();
  const { chainId } = await ethers.provider.getNetwork();
  console.log(`Deploying to ${network.name} (chainId ${chainId}) from ${deployer.address}`);

  const token = await ethers.deployContract("MockNaira");
  await token.waitForDeployment();
  const tokenTx = token.deploymentTransaction().hash;
  console.log(`MockNaira  ${await token.getAddress()}  tx ${tokenTx}`);

  const ajo = await ethers.deployContract("AjoChain");
  await ajo.waitForDeployment();
  const ajoTx = ajo.deploymentTransaction().hash;
  console.log(`AjoChain   ${await ajo.getAddress()}  tx ${ajoTx}`);

  const out = {
    network: network.name,
    chainId: Number(chainId),
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
    contracts: {
      MockNaira: { address: await token.getAddress(), tx: tokenTx },
      AjoChain: { address: await ajo.getAddress(), tx: ajoTx },
    },
    interactions: [],
  };
  const dir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${network.name}.json`), JSON.stringify(out, null, 2));
  if (network.name === "portaldot") {
    const fe = path.join(__dirname, "..", "frontend", "src", "deployments.json");
    fs.writeFileSync(fe, JSON.stringify({ chainId: out.chainId, MockNaira: out.contracts.MockNaira.address, AjoChain: out.contracts.AjoChain.address }, null, 2));
  }
  console.log(`Saved deployments/${network.name}.json`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
