import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { network } from "hardhat";

describe("Sendr stack", async function () {
  const { viem } = await network.connect();
  const publicClient = await viem.getPublicClient();

  let usdc: Awaited<ReturnType<typeof viem.deployContract>>;
  let groups: Awaited<ReturnType<typeof viem.deployContract>>;
  let pay: Awaited<ReturnType<typeof viem.deployContract>>;
  let registry: Awaited<ReturnType<typeof viem.deployContract>>;

  const wallets = await viem.getWalletClients();
  const [owner, alice, bob, carol, dave] = wallets;

  beforeEach(async function () {
    usdc = await viem.deployContract("MockUSDC", []);
    groups = await viem.deployContract("GroupRegistry", []);
    pay = await viem.deployContract("SendrPay", [usdc.address, groups.address, owner.account.address]);
    registry = await viem.deployContract("UsernameRegistry", []);
  });

  it("UsernameRegistry: register and resolve", async function () {
    await registry.write.register(["alice"], { account: alice.account });
    const addr = await registry.read.getAddressByName(["alice"]);
    assert.equal(addr.toLowerCase(), alice.account.address.toLowerCase());

    await assert.rejects(registry.write.register(["bob"], { account: alice.account }));
    await assert.rejects(registry.write.register(["alice"], { account: bob.account }));

    const bad = await registry.read.getAddressByName(["AB"]);
    assert.equal(bad, "0x0000000000000000000000000000000000000000");
  });

  it("GroupRegistry: create, members, cancel, queries", async function () {
    const tx = await groups.write.createGroup(["Friends"], { account: alice.account });
    await publicClient.waitForTransactionReceipt({ hash: tx });

    const id = (await groups.read.getGroupsOwnedBy([alice.account.address]))[0];
    assert.equal(id, 1n);

    const g = await groups.read.getGroup([id]);
    assert.equal(g[0].toLowerCase(), alice.account.address.toLowerCase());
    assert.equal(g[1], "Friends");
    assert.equal(g[2], true);

    await groups.write.addMember([id, bob.account.address], { account: alice.account });
    await groups.write.addMember([id, carol.account.address], { account: alice.account });

    let members = await groups.read.getMembers([id]);
    assert.equal(members.length, 2);

    const bobGroups = await groups.read.getGroupsForMember([bob.account.address]);
    assert.ok(bobGroups.includes(id));

    await groups.write.removeMember([id, bob.account.address], { account: alice.account });
    members = await groups.read.getMembers([id]);
    assert.equal(members.length, 1);

    await groups.write.cancelGroup([id], { account: alice.account });
    const g2 = await groups.read.getGroup([id]);
    assert.equal(g2[2], false);
  });

  it("SendrPay: pay and group pay", async function () {
    const mint = 1_000_000n * 10n ** 6n;
    await usdc.write.mint([alice.account.address, mint]);

    const tx = await groups.write.createGroup(["Team"], { account: alice.account });
    await publicClient.waitForTransactionReceipt({ hash: tx });
    const id = 1n as const;

    await groups.write.addMember([id, bob.account.address], { account: alice.account });
    await groups.write.addMember([id, carol.account.address], { account: alice.account });
    await groups.write.addMember([id, dave.account.address], { account: alice.account });

    const amount = 100n * 10n ** 6n;
    await usdc.write.approve([pay.address, amount * 10n], { account: alice.account });
    await pay.write.pay([bob.account.address, amount], { account: alice.account });
    assert.equal(await usdc.read.balanceOf([bob.account.address]), amount);

    const per = 50n * 10n ** 6n;
    const totalEq = per * 3n;
    await usdc.write.approve([pay.address, totalEq], { account: alice.account });
    await pay.write.payGroupEqual([id, per], { account: alice.account });
    assert.equal(await usdc.read.balanceOf([carol.account.address]), per);
    assert.equal(await usdc.read.balanceOf([dave.account.address]), per);

    const splitTotal = 100n * 10n ** 6n + 1n;
    await usdc.write.approve([pay.address, splitTotal], { account: alice.account });
    await pay.write.payGroupSplit([id, splitTotal], { account: alice.account });
  });

  it("SendrPay: reverts when group cancelled", async function () {
    const tx = await groups.write.createGroup(["X"], { account: alice.account });
    await publicClient.waitForTransactionReceipt({ hash: tx });
    const id = 1n;
    await groups.write.addMember([id, bob.account.address], { account: alice.account });

    await groups.write.cancelGroup([id], { account: alice.account });
    await usdc.write.mint([alice.account.address, 10n ** 12n]);
    await usdc.write.approve([pay.address, 10n ** 12n], { account: alice.account });

    await assert.rejects(pay.write.payGroupEqual([id, 1n], { account: alice.account }));
  });
});
