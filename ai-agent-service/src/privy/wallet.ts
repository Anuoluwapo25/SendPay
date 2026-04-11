import { PrivyClient } from "@privy-io/server-auth";
import { db } from "../db/index.js";
import type { TxPayload, PrivyWallet } from "../types.js";

// @privy-io/server-auth v1: positional (appId, appSecret) constructor
const privy = new PrivyClient(
  process.env.PRIVY_APP_ID!,
  process.env.PRIVY_APP_SECRET!,
);

const CAIP2 = `eip155:${process.env.MONAD_CHAIN_ID ?? "10143"}` as `eip155:${string}`;

// ── Create a new server-side EVM wallet for a phone number ───────────────────
export async function createPrivyWallet(phone: string): Promise<PrivyWallet> {
  const wallet = await privy.walletApi.create({
    chainType: "ethereum",                   // EVM-compatible — works on Monad
    idempotencyKey: `wallet-${phone}`,       // ensures one wallet per phone even if called twice
  });

  await db.savePrivyWalletId(phone, wallet.id);

  return { id: wallet.id, address: wallet.address };
}

// ── Get existing wallet ID from DB ────────────────────────────────────────────
export async function getPrivyWalletId(phone: string): Promise<string | null> {
  return db.getPrivyWalletId(phone);
}

// ── Sign and broadcast a transaction ─────────────────────────────────────────
// Called ONLY after user replies YES in WhatsApp.
// Privy handles: nonce, gas estimation, RPC broadcast, retry on underpriced.
export async function signAndBroadcast(
  phone: string,
  txPayload: TxPayload,
): Promise<string> {
  const walletId = await db.getPrivyWalletId(phone);
  if (!walletId) throw new Error("No wallet found. Please sign up first.");

  const { hash } = await privy.walletApi.ethereum.sendTransaction({
    walletId,
    caip2: CAIP2,
    transaction: {
      to:    txPayload.to    as `0x${string}`,
      data:  txPayload.data  as `0x${string}`,
      value: txPayload.value as `0x${string}`, // hex string wei
    },
  });

  return hash;
}

// ── Register username on-chain after signup ───────────────────────────────────
// The user's Privy wallet calls UsernameRegistry.registerUsername()
export async function registerUsernameOnChain(
  phone: string,
  username: string,
  _walletAddress: string,
): Promise<string> {
  const walletId = await db.getPrivyWalletId(phone);
  if (!walletId) throw new Error("No wallet found.");

  const { ethers } = await import("ethers");

  const REGISTRY_ABI = [
    "function registerUsername(string calldata username) external",
  ];
  const iface = new ethers.Interface(REGISTRY_ABI);
  const data = iface.encodeFunctionData("registerUsername", [username]);

  const { hash } = await privy.walletApi.ethereum.sendTransaction({
    walletId,
    caip2: CAIP2,
    transaction: {
      to:    process.env.USERNAME_REGISTRY_ADDRESS! as `0x${string}`,
      data:  data as `0x${string}`,
      value: "0x0" as `0x${string}`,
    },
  });

  return hash;
}
