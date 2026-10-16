// Real end-to-end interaction on the deployed contracts: faucet -> approve -> create circle ->
// second member joins (circle starts) -> both contribute -> payout released.
// Uses .secrets/deployer.key and .secrets/member2.key (member2 gets a little gas from the deployer).
const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const file = path.join(__dirname, "..", "deployments", `${network.name}.json`);
  const dep = JSON.parse(fs.readFileSync(file, "utf8"));
  const [deployer] = await ethers.getSigners();
  const m2key = fs.readFileSync(path.join(__dirname, "..", ".secrets", "member2.key"), "utf8").trim();
  const member2 = new ethers.Wallet(m2key, ethers.provider);

  const token = await ethers.getContractAt("MockNaira", dep.contracts.MockNaira.address);
  const ajo = await ethers.getContractAt("AjoChain", dep.contracts.AjoChain.address);
  const log = [];
  const step = async (label, txPromise) => {
    const tx = await txPromise;
    const rc = await tx.wait();
    console.log(`${label.padEnd(34)} ${tx.hash}  (block ${rc.blockNumber}, status ${rc.status})`);
    log.push({ step: label, from: tx.from, tx: tx.hash, block: rc.blockNumber, status: rc.status });
    return rc;
  };

  // gas for member2: 1/20 of deployer balance, capped
  const bal = await ethers.provider.getBalance(deployer.address);
  const m2bal = await ethers.provider.getBalance(member2.address);
  if (m2bal === 0n) await step("fund member2 with gas", deployer.sendTransaction({ to: member2.address, value: bal / 20n }));

  const ajoAddr = await ajo.getAddress();
  for (const [name, s] of [["deployer", deployer], ["member2", member2]]) {
    if ((await token.balanceOf(s.address)) === 0n) await step(`${name}: tNGN faucet`, token.connect(s).faucet());
    await step(`${name}: approve AjoChain`, token.connect(s).approve(ajoAddr, ethers.MaxUint256));
  }

  const id = await ajo.circleCount();
  const amount = 5_000n * 10n ** 6n;
  await step(`createCircle #${id}`, ajo.connect(deployer).createCircle("Portaldot Demo Ajo", await token.getAddress(), amount, 2, 7 * 24 * 3600, 0));
  await step(`member2: joinCircle #${id}`, ajo.connect(member2).joinCircle(id));
  await step(`deployer: contribute round 0`, ajo.connect(deployer).contribute(id));
  await step(`member2: contribute round 0`, ajo.connect(member2).contribute(id));
  await step(`releasePayout round 0`, ajo.connect(member2).releasePayout(id));

  const c = await ajo.getCircle(id);
  console.log(`circle #${id}: round ${c.currentRound}, status ${c.status}, recipient now ${await ajo.currentRecipient(id)}`);
  console.log(`reputation deployer ${await ajo.reputationScore(deployer.address)}, member2 ${await ajo.reputationScore(member2.address)}`);

  dep.interactions.push({ circleId: Number(id), at: new Date().toISOString(), steps: log });
  fs.writeFileSync(file, JSON.stringify(dep, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
