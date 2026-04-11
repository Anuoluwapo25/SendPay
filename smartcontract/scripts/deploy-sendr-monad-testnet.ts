/**
 * Deploy UsernameRegistry, GroupRegistry, and SendrPay wired to canonical Monad testnet USDC.
 *
 * Prerequisites:
 * - `MONAD_TESTNET_PRIVATE_KEY` in `.env` (deployer wallet with MON for gas).
 * - Optional: `MONAD_TESTNET_RPC_URL` (defaults to public QuickNode RPC from Monad docs).
 *
 * Docs: https://docs.monad.xyz/developer-essentials/testnets
 * Faucet: https://faucet.monad.xyz
 *
 * Run: npm run deploy:monad-testnet
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { network } from "hardhat";

import {
  MONAD_TESTNET_CHAIN_ID,
  MONAD_TESTNET_RPC_DEFAULT,
  MONAD_TESTNET_USDC,
} from "../config/monadTestnet.js";

const { viem } = await network.connect({
  network: "monadTestnet",
  chainType: "l1",
});

const [deployer] = await viem.getWalletClients();
const owner = deployer.account.address;

const rpcUrl = process.env.MONAD_TESTNET_RPC_URL ?? MONAD_TESTNET_RPC_DEFAULT;

console.log("Network: Monad Testnet (chainId", String(MONAD_TESTNET_CHAIN_ID) + ")");
console.log("RPC:", rpcUrl);
console.log("Deployer:", owner);
console.log("USDC (token list):", MONAD_TESTNET_USDC);

const registry = await viem.deployContract("UsernameRegistry", []);
const groups = await viem.deployContract("GroupRegistry", []);
const pay = await viem.deployContract("SendrPay", [MONAD_TESTNET_USDC, groups.address, owner]);

console.log("UsernameRegistry:", registry.address);
console.log("GroupRegistry:   ", groups.address);
console.log("SendrPay:        ", pay.address);

const artifact = {
  chainId: MONAD_TESTNET_CHAIN_ID,
  networkName: "Monad Testnet",
  deployedAt: new Date().toISOString(),
  documentation: "https://docs.monad.xyz/developer-essentials/testnets",
  faucet: "https://faucet.monad.xyz",
  tokenList: "https://github.com/monad-crypto/token-list/blob/main/tokenlist-testnet.json",
  rpcUrl,
  usdc: MONAD_TESTNET_USDC,
  deployer: owner,
  contracts: {
    UsernameRegistry: registry.address,
    GroupRegistry: groups.address,
    SendrPay: pay.address,
  },
  explorers: {
    monadVision: `https://testnet.monadvision.com`,
    monadScan: `https://testnet.monadscan.com`,
  },
};

const outPath = join(process.cwd(), "deployments", "monad-testnet.json");
writeFileSync(outPath, JSON.stringify(artifact, null, 2) + "\n", "utf8");
console.log("Wrote", outPath);
