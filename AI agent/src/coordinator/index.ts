/**
 * Transaction coordinator for the WhatsApp webhook flow.
 *
 * Converts a ResolvedPayment (addresses + amounts) into a single
 * on-chain TxPayload that can be signed by the user's Privy wallet.
 *
 * Single recipient  → SendrPay.pay(to, amount)
 * Multi-recipient   → Not supported in a single tx without a batch contract.
 *                     The user receives a clear error message so they can
 *                     split the payment or use on-chain group functionality.
 */
import type { ResolvedPayment, TxPayload } from "../types.js";
import { encodePay } from "../chain/encodeSendrPay.js";
import { usdcBaseUnitsFromHuman } from "../chain/usdcAmount.js";

export function buildTxPayload(
  resolved: ResolvedPayment,
  _fromAddress: string,
): TxPayload {
  if (!resolved.recipients.length) {
    throw new Error("No recipients in the resolved payment.");
  }

  if (resolved.recipients.length === 1) {
    const r = resolved.recipients[0]!;
    const call = encodePay(
      r.address as `0x${string}`,
      usdcBaseUnitsFromHuman(r.amount),
    );
    return { to: call.to, data: call.data, value: call.value };
  }

  // Multi-recipient payments require multiple transactions or a batch contract.
  // Guide the user toward a workaround.
  throw new Error(
    `Paying ${resolved.recipients.length} people at once requires multiple transactions — ` +
      `not yet supported in a single WhatsApp confirmation. ` +
      `Please send to each person individually, or create a group and use "Send $X to <group> group".`,
  );
}
