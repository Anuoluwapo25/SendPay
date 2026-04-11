import { createPublicClient, http, type Chain, type PublicClient } from "viem";

export function makePublicClient(
  rpcUrl: string,
  chainId: number,
): PublicClient {
  const chain: Chain = {
    id: chainId,
    name: "monad-testnet",
    nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  };
  return createPublicClient({
    chain,
    transport: http(rpcUrl),
  });
}
