import type { PublicClient } from "viem";
import {
  groupRegistryContract,
  sendrpayContract,
  userRegistryContract,
} from "../abi/index.js";
import { normalizeUsernameForRegistry } from "./normalizeUsername.js";

const ZERO = "0x0000000000000000000000000000000000000000" as const;
const ZERO_HASH =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as const;

export async function isWalletRegisteredOnChain(
  client: PublicClient,
  wallet: `0x${string}`,
): Promise<boolean> {
  const hash = (await client.readContract({
    address: userRegistryContract.address,
    abi: userRegistryContract.abi,
    functionName: "getNameHashByAddress",
    args: [wallet],
  })) as `0x${string}`;
  return hash !== ZERO_HASH;
}

export async function readUsdcAddress(
  client: PublicClient,
): Promise<`0x${string}`> {
  const addr = await client.readContract({
    address: sendrpayContract.address,
    abi: sendrpayContract.abi,
    functionName: "usdc",
  });
  return addr as `0x${string}`;
}

export async function resolveUsernameOnChain(
  client: PublicClient,
  handle: string,
): Promise<
  | { ok: true; username: string; address: `0x${string}` }
  | { ok: false; username: string; reason: string }
> {
  const norm = normalizeUsernameForRegistry(handle);
  if (!norm.ok) {
    return {
      ok: false,
      username: handle.replace(/^@/, "").toLowerCase(),
      reason: norm.reason,
    };
  }
  const addr = (await client.readContract({
    address: userRegistryContract.address,
    abi: userRegistryContract.abi,
    functionName: "getAddressByName",
    args: [norm.name],
  })) as `0x${string}`;
  if (addr === ZERO) {
    return {
      ok: false,
      username: norm.name,
      reason: "Name is not registered on-chain.",
    };
  }
  return { ok: true, username: norm.name, address: addr };
}

export async function resolveGroupByNameOnChain(
  client: PublicClient,
  wallet: `0x${string}`,
  searchName: string,
): Promise<
  | {
      ok: true;
      kind: "onchain";
      groupId: bigint;
      displayName: string;
      members: `0x${string}`[];
    }
  | { ok: false; reason: string }
> {
  const target = searchName.trim().toLowerCase().replace(/\bgroup\b/gi, "").trim();

  const owned = (await client.readContract({
    address: groupRegistryContract.address,
    abi: groupRegistryContract.abi,
    functionName: "getGroupsOwnedBy",
    args: [wallet],
  })) as readonly bigint[];
  const memberOf = (await client.readContract({
    address: groupRegistryContract.address,
    abi: groupRegistryContract.abi,
    functionName: "getGroupsForMember",
    args: [wallet],
  })) as readonly bigint[];

  const seen = new Set<string>();
  const ids: bigint[] = [];
  for (const id of [...owned, ...memberOf]) {
    const k = id.toString();
    if (seen.has(k)) continue;
    seen.add(k);
    ids.push(id);
  }

  for (const id of ids) {
    const g = (await client.readContract({
      address: groupRegistryContract.address,
      abi: groupRegistryContract.abi,
      functionName: "getGroup",
      args: [id],
    })) as readonly [`0x${string}`, string, boolean];
    const [, name, active] = g;
    if (!active) continue;
    if (name.toLowerCase() !== target) continue;

    const members = (await client.readContract({
      address: groupRegistryContract.address,
      abi: groupRegistryContract.abi,
      functionName: "getMembers",
      args: [id],
    })) as readonly `0x${string}`[];
    if (members.length === 0) {
      return {
        ok: false,
        reason: `Group "${name}" has no members yet. Add members before paying.`,
      };
    }
    return {
      ok: true,
      kind: "onchain" as const,
      groupId: id,
      displayName: name,
      members: [...members],
    };
  }

  return {
    ok: false,
    reason: `No active group named "${searchName}" for your wallet. Create one or join it first.`,
  };
}

export async function formatGroupsLinesForWallet(
  client: PublicClient,
  wallet: `0x${string}`,
): Promise<string> {
  const owned = (await client.readContract({
    address: groupRegistryContract.address,
    abi: groupRegistryContract.abi,
    functionName: "getGroupsOwnedBy",
    args: [wallet],
  })) as readonly bigint[];
  const memberOf = (await client.readContract({
    address: groupRegistryContract.address,
    abi: groupRegistryContract.abi,
    functionName: "getGroupsForMember",
    args: [wallet],
  })) as readonly bigint[];

  const seen = new Set<string>();
  const ids: bigint[] = [];
  for (const id of [...owned, ...memberOf]) {
    const k = id.toString();
    if (seen.has(k)) continue;
    seen.add(k);
    ids.push(id);
  }

  if (ids.length === 0) {
    return "No groups found for this wallet. Create one on-chain (GroupRegistry.createGroup).";
  }

  const lines: string[] = [];
  for (const id of ids) {
    const g = (await client.readContract({
      address: groupRegistryContract.address,
      abi: groupRegistryContract.abi,
      functionName: "getGroup",
      args: [id],
    })) as readonly [`0x${string}`, string, boolean];
    const [owner, name, active] = g;
    const members = (await client.readContract({
      address: groupRegistryContract.address,
      abi: groupRegistryContract.abi,
      functionName: "getMembers",
      args: [id],
    })) as readonly `0x${string}`[];
    const role =
      owner.toLowerCase() === wallet.toLowerCase() ? "owner" : "member";
    lines.push(
      `• id ${id} — "${name}" (${active ? "active" : "inactive"}, ${role}, ${members.length} payee(s))`,
    );
  }
  return `Your groups:\n${lines.join("\n")}`;
}
