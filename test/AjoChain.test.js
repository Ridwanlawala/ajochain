const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

const DAY = 24 * 60 * 60;
const AMOUNT = 5_000n * 10n ** 6n; // 5,000 tNGN per round
const Status = { Open: 0n, Active: 1n, Completed: 2n };

describe("MockNaira (tNGN)", function () {
  async function deploy() {
    const [a, b] = await ethers.getSigners();
    const token = await ethers.deployContract("MockNaira");
    return { token, a, b };
  }

  it("has 6 decimals and an empty supply", async function () {
    const { token } = await loadFixture(deploy);
    expect(await token.decimals()).to.equal(6n);
    expect(await token.totalSupply()).to.equal(0n);
    expect(await token.symbol()).to.equal("tNGN");
  });

  it("public faucet mints 100,000 tNGN and enforces a 1h cooldown", async function () {
    const { token, a, b } = await loadFixture(deploy);
    const amt = await token.FAUCET_AMOUNT();
    await expect(token.connect(a).faucet()).to.emit(token, "FaucetClaimed").withArgs(a.address, amt);
    expect(await token.balanceOf(a.address)).to.equal(amt);
    await expect(token.connect(a).faucet()).to.be.revertedWithCustomError(token, "FaucetCooldown");
    await token.connect(b).faucet(); // other users unaffected
    await time.increase(3600);
    await token.connect(a).faucet();
    expect(await token.balanceOf(a.address)).to.equal(amt * 2n);
  });
});

describe("AjoChain", function () {
  async function deploy() {
    const [alice, bob, chidi, dayo, outsider] = await ethers.getSigners();
    const token = await ethers.deployContract("MockNaira");
    const ajo = await ethers.deployContract("AjoChain");
    for (const s of [alice, bob, chidi, dayo, outsider]) {
      await token.connect(s).faucet();
      await token.connect(s).approve(await ajo.getAddress(), ethers.MaxUint256);
    }
    return { token, ajo, alice, bob, chidi, dayo, outsider };
  }

  async function threeMemberCircle() {
    const f = await deploy();
    const { ajo, token, alice, bob, chidi } = f;
    await ajo.connect(alice).createCircle("Market women", await token.getAddress(), AMOUNT, 3, 7 * DAY, 0);
    await ajo.connect(bob).joinCircle(0);
    await ajo.connect(chidi).joinCircle(0);
    return f;
  }

  describe("createCircle", function () {
    it("creates an Open circle with the creator as member #1", async function () {
      const { ajo, token, alice } = await loadFixture(deploy);
      await expect(ajo.connect(alice).createCircle("Esusu", await token.getAddress(), AMOUNT, 4, DAY, 0))
        .to.emit(ajo, "CircleCreated")
        .and.to.emit(ajo, "MemberJoined")
        .withArgs(0, alice.address, 0);
      const c = await ajo.getCircle(0);
      expect(c.name).to.equal("Esusu");
      expect(c.status).to.equal(Status.Open);
      expect(c.memberCount).to.equal(1n);
      expect(await ajo.circleCount()).to.equal(1n);
      expect(await ajo.getMembers(0)).to.deep.equal([alice.address]);
    });

    it("rejects invalid parameters", async function () {
      const { ajo, token } = await loadFixture(deploy);
      const t = await token.getAddress();
      await expect(ajo.createCircle("x", ethers.ZeroAddress, AMOUNT, 3, DAY, 0)).to.be.revertedWithCustomError(ajo, "InvalidParams");
      await expect(ajo.createCircle("x", t, 0, 3, DAY, 0)).to.be.revertedWithCustomError(ajo, "InvalidParams");
      await expect(ajo.createCircle("x", t, AMOUNT, 1, DAY, 0)).to.be.revertedWithCustomError(ajo, "InvalidParams");
      await expect(ajo.createCircle("x", t, AMOUNT, 51, DAY, 0)).to.be.revertedWithCustomError(ajo, "InvalidParams");
      await expect(ajo.createCircle("x", t, AMOUNT, 3, 0, 0)).to.be.revertedWithCustomError(ajo, "InvalidParams");
      await expect(ajo.createCircle("", t, AMOUNT, 3, DAY, 0)).to.be.revertedWithCustomError(ajo, "InvalidParams");
    });
  });

  describe("joinCircle", function () {
    it("starts the circle automatically when the last seat fills", async function () {
      const { ajo, token, alice, bob, chidi } = await loadFixture(deploy);
      await ajo.connect(alice).createCircle("C", await token.getAddress(), AMOUNT, 3, DAY, 0);
      await ajo.connect(bob).joinCircle(0);
      expect((await ajo.getCircle(0)).status).to.equal(Status.Open);
      await expect(ajo.connect(chidi).joinCircle(0)).to.emit(ajo, "CircleStarted");
      const c = await ajo.getCircle(0);
      expect(c.status).to.equal(Status.Active);
      expect(await ajo.currentRecipient(0)).to.equal(alice.address);
      expect(await ajo.roundDeadline(0)).to.equal(c.roundStart + c.roundDuration);
    });

    it("blocks duplicates, full circles and unknown ids", async function () {
      const { ajo, alice, dayo } = await loadFixture(threeMemberCircle);
      await expect(ajo.connect(dayo).joinCircle(0)).to.be.revertedWithCustomError(ajo, "NotOpen");
      await expect(ajo.connect(alice).joinCircle(9)).to.be.revertedWithCustomError(ajo, "UnknownCircle");
    });

    it("rejects double-joining while open", async function () {
      const { ajo, token, alice } = await loadFixture(deploy);
      await ajo.connect(alice).createCircle("C", await token.getAddress(), AMOUNT, 3, DAY, 0);
      await expect(ajo.connect(alice).joinCircle(0)).to.be.revertedWithCustomError(ajo, "AlreadyMember");
    });

    it("enforces a minimum reputation score", async function () {
      const { ajo, token, alice, bob } = await loadFixture(deploy);
      await ajo.connect(alice).createCircle("Trusted only", await token.getAddress(), AMOUNT, 2, DAY, 20);
      await expect(ajo.connect(bob).joinCircle(0))
        .to.be.revertedWithCustomError(ajo, "ReputationTooLow")
        .withArgs(0, 20);
    });
  });

  describe("contributions and payouts", function () {
    it("runs a full 3-round circle: everyone pays, everyone receives the pot once", async function () {
      const { ajo, token, alice, bob, chidi } = await loadFixture(threeMemberCircle);
      const members = [alice, bob, chidi];
      const before = await Promise.all(members.map((m) => token.balanceOf(m.address)));

      for (let round = 0; round < 3; round++) {
        for (const m of members) {
          await expect(ajo.connect(m).contribute(0))
            .to.emit(ajo, "ContributionMade")
            .withArgs(0, round, m.address, AMOUNT, false);
        }
        expect(await ajo.paidCount(0, round)).to.equal(3n);
        await expect(ajo.releasePayout(0))
          .to.emit(ajo, "PayoutSent")
          .withArgs(0, round, members[round].address, AMOUNT * 3n);
      }

      const c = await ajo.getCircle(0);
      expect(c.status).to.equal(Status.Completed);
      expect(await ajo.currentRecipient(0)).to.equal(ethers.ZeroAddress);
      // net zero for each member, contract holds nothing
      for (let i = 0; i < 3; i++) expect(await token.balanceOf(members[i].address)).to.equal(before[i]);
      expect(await token.balanceOf(await ajo.getAddress())).to.equal(0n);
      // 3 on-time payments (30) + 1 completed circle (25)
      for (const m of members) expect(await ajo.reputationScore(m.address)).to.equal(55n);
    });

    it("refuses a payout until every member has paid", async function () {
      const { ajo, alice, bob } = await loadFixture(threeMemberCircle);
      await ajo.connect(alice).contribute(0);
      await ajo.connect(bob).contribute(0);
      await expect(ajo.releasePayout(0)).to.be.revertedWithCustomError(ajo, "RoundIncomplete").withArgs(2, 3);
    });

    it("blocks double payment, non-members and contributions before start", async function () {
      const { ajo, token, alice, outsider } = await loadFixture(threeMemberCircle);
      await ajo.connect(alice).contribute(0);
      await expect(ajo.connect(alice).contribute(0)).to.be.revertedWithCustomError(ajo, "AlreadyPaid");
      await expect(ajo.connect(outsider).contribute(0)).to.be.revertedWithCustomError(ajo, "NotMember");
      await ajo.connect(alice).createCircle("Open one", await token.getAddress(), AMOUNT, 5, DAY, 0);
      await expect(ajo.connect(alice).contribute(1)).to.be.revertedWithCustomError(ajo, "NotActive");
    });

    it("flags late contributions and lowers reputation", async function () {
      const { ajo, alice, bob, chidi } = await loadFixture(threeMemberCircle);
      await ajo.connect(alice).contribute(0);
      await ajo.connect(bob).contribute(0);
      await time.increase(7 * DAY + 1);
      await expect(ajo.connect(chidi).contribute(0))
        .to.emit(ajo, "LateFlagged")
        .withArgs(0, 0, chidi.address)
        .and.to.emit(ajo, "ContributionMade")
        .withArgs(0, 0, chidi.address, AMOUNT, true);
      expect(await ajo.paidLate(0, 0, chidi.address)).to.equal(true);
      expect(await ajo.reputationScore(chidi.address)).to.equal(-5n);
      expect(await ajo.reputationScore(alice.address)).to.equal(10n);
      const r = await ajo.reputationOf(chidi.address);
      expect(r.late).to.equal(1n);
    });

    it("lets anyone flag a defaulter once per round after the deadline", async function () {
      const { ajo, alice, bob, chidi, outsider } = await loadFixture(threeMemberCircle);
      await ajo.connect(alice).contribute(0);
      await expect(ajo.connect(outsider).flagDefault(0, chidi.address)).to.be.revertedWithCustomError(ajo, "RoundNotOverdue");
      await time.increase(7 * DAY + 1);
      await expect(ajo.connect(outsider).flagDefault(0, alice.address)).to.be.revertedWithCustomError(ajo, "AlreadyPaid");
      await expect(ajo.connect(outsider).flagDefault(0, outsider.address)).to.be.revertedWithCustomError(ajo, "NotMember");
      await expect(ajo.connect(outsider).flagDefault(0, chidi.address))
        .to.emit(ajo, "DefaultFlagged")
        .withArgs(0, 0, chidi.address, outsider.address);
      await expect(ajo.connect(alice).flagDefault(0, chidi.address)).to.be.revertedWithCustomError(ajo, "AlreadyFlagged");
      expect(await ajo.reputationScore(chidi.address)).to.equal(-30n);
      // the defaulter can still pay (late) and the circle continues
      await ajo.connect(bob).contribute(0);
      await ajo.connect(chidi).contribute(0);
      await ajo.releasePayout(0);
      expect(await ajo.currentRecipient(0)).to.equal(bob.address);
      expect(await ajo.reputationScore(chidi.address)).to.equal(-35n);
    });

    it("resets the round clock after each payout", async function () {
      const { ajo, alice, bob, chidi } = await loadFixture(threeMemberCircle);
      for (const m of [alice, bob, chidi]) await ajo.connect(m).contribute(0);
      await time.increase(3 * DAY);
      await ajo.releasePayout(0);
      const now = BigInt(await time.latest());
      const c = await ajo.getCircle(0);
      expect(c.currentRound).to.equal(1n);
      expect(c.roundStart).to.equal(now);
      await ajo.connect(alice).contribute(0); // on time in the new round
      expect(await ajo.paidLate(0, 1, alice.address)).to.equal(false);
    });

    it("reputation is portable: good savers can enter gated circles", async function () {
      const { ajo, token, alice, bob, chidi, dayo } = await loadFixture(threeMemberCircle);
      for (let r = 0; r < 3; r++) {
        for (const m of [alice, bob, chidi]) await ajo.connect(m).contribute(0);
        await ajo.releasePayout(0);
      }
      await ajo.connect(dayo).createCircle("Gold tier", await token.getAddress(), AMOUNT, 3, DAY, 50);
      await ajo.connect(alice).joinCircle(1); // score 55
      await expect(ajo.connect(dayo).createCircle("x", await token.getAddress(), AMOUNT, 2, DAY, 0)).to.not.be.reverted;
      await ajo.connect(alice).createCircle("Strict", await token.getAddress(), AMOUNT, 2, DAY, 100);
      await expect(ajo.connect(bob).joinCircle(3)).to.be.revertedWithCustomError(ajo, "ReputationTooLow").withArgs(55, 100);
    });
  });
});
