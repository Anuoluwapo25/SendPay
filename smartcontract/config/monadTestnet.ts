/**
 * Monad testnet (chainId 10143) — canonical addresses from the Monad token list:
 * - https://github.com/monad-crypto/token-list/blob/main/tokenlist-testnet.json
 * - https://raw.githubusercontent.com/monad-crypto/token-list/main/tokenlist-testnet.json
 *
 * Network info (RPC, explorers, faucet): https://docs.monad.xyz/developer-essentials/testnets
 */
export const MONAD_TESTNET_CHAIN_ID = 10143;

/** Default public RPC from Monad docs (QuickNode); override with `MONAD_TESTNET_RPC_URL` if needed */
export const MONAD_TESTNET_RPC_DEFAULT = "https://testnet-rpc.monad.xyz";

/** Official list USDC (6 decimals), not a mock — use this for SendrPay on Monad testnet */
export const MONAD_TESTNET_USDC =
  "0x534b2f3A21130d7a60830c2Df862319e593943A3" as const;
