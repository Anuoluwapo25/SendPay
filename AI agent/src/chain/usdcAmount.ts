export const USDC_DECIMALS = 6;

/** Human USDC (e.g. 12.5) → base units (6 decimals). */
export function usdcBaseUnitsFromHuman(amount: number): bigint {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Amount must be a positive finite number");
  }
  return BigInt(Math.round(amount * 10 ** USDC_DECIMALS));
}
