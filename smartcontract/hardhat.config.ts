import "dotenv/config";

import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import { configVariable, defineConfig } from "hardhat/config";

import {
  MONAD_TESTNET_CHAIN_ID,
  MONAD_TESTNET_RPC_DEFAULT,
} from "./config/monadTestnet.js";

const monadTestnetRpcUrl =
  process.env.MONAD_TESTNET_RPC_URL ?? MONAD_TESTNET_RPC_DEFAULT;

/** Set `ETHERSCAN_API_KEY` in `.env` for MonadScan (Etherscan v2). If unset, `hardhat verify` still runs Sourcify only. */
const etherscanApiKey = process.env.ETHERSCAN_API_KEY ?? "";

/** Etherscan v2 API base (Hardhat adds `chainid` + `apikey` query params). See https://docs.monad.xyz/guides/verify-smart-contract/hardhat */
const MONAD_TESTNET_ETHERSCAN_API_URL = "https://api.etherscan.io/v2/api";

export default defineConfig({
  plugins: [hardhatToolboxViemPlugin],
  chainDescriptors: {
    [MONAD_TESTNET_CHAIN_ID]: {
      name: "Monad Testnet",
      chainType: "l1",
      blockExplorers: {
        // MonadScan uses Etherscan-compatible v2 API (not the Blockscout `/api` route).
        etherscan: {
          name: "MonadScan",
          url: "https://testnet.monadscan.com",
          apiUrl: MONAD_TESTNET_ETHERSCAN_API_URL,
        },
      },
    },
  },
  solidity: {
    profiles: {
      default: {
        version: "0.8.28",
      },
      production: {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    },
  },
  networks: {
    hardhatMainnet: {
      type: "edr-simulated",
      chainType: "l1",
    },
    hardhatOp: {
      type: "edr-simulated",
      chainType: "op",
    },
    sepolia: {
      type: "http",
      chainType: "l1",
      url: configVariable("SEPOLIA_RPC_URL"),
      accounts: [configVariable("SEPOLIA_PRIVATE_KEY")],
    },
    monadTestnet: {
      type: "http",
      chainType: "l1",
      chainId: MONAD_TESTNET_CHAIN_ID,
      url: monadTestnetRpcUrl,
      accounts: [configVariable("MONAD_TESTNET_PRIVATE_KEY")],
    },
  },
  // https://docs.monad.xyz/guides/verify-smart-contract/hardhat — `npx hardhat verify` uses
  // Sourcify (MonadVision) + MonadScan when Etherscan + Sourcify are enabled.
  verify: {
    blockscout: {
      enabled: false,
    },
    etherscan:
      etherscanApiKey.length > 0
        ? { enabled: true, apiKey: etherscanApiKey }
        : { enabled: false },
    sourcify: {
      enabled: true,
      apiUrl: "https://sourcify-api-monad.blockvision.org",
    },
  },
});
