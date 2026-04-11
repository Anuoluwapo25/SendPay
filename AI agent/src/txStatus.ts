import type { PublicClient } from "viem";

export type TxReceiptStatus = {
  txHash: `0x${string}`;
  status: "pending" | "success" | "failed";
  blockNumber?: string;
  gasUsed?: string;
};

export async function fetchTxReceiptStatus(
  client: PublicClient,
  hash: `0x${string}`,
): Promise<TxReceiptStatus> {
  const receipt = await client
    .getTransactionReceipt({ hash })
    .catch(() => null);
  if (!receipt) {
    const tx = await client.getTransaction({ hash }).catch(() => null);
    if (!tx) {
      return { txHash: hash, status: "pending" };
    }
    return { txHash: hash, status: "pending" };
  }
  return {
    txHash: hash,
    status: receipt.status === "success" ? "success" : "failed",
    blockNumber: receipt.blockNumber.toString(),
    gasUsed: receipt.gasUsed.toString(),
  };
}
