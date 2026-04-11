import type { PaymentAction } from "./schemas.js";

export type EncodedTxJson = {
  to: string;
  data: string;
  value: string;
  description: string;
};

export type ChatResponse =
  | {
      type: "clarify";
      question: string;
      /** Optional USDC.approve calldata when allowance is too low */
      transactions?: EncodedTxJson[];
    }
  | {
      type: "draft";
      draftId: string;
      preview: string;
      action: PaymentAction;
      recipients: { username: string; address: string; amount: number }[];
      totalAmount: number;
    }
  | {
      type: "tx_ready";
      draftId: string;
      preview: string;
      tx: {
        chainId: number;
        usdc: { address: string; decimals: 6 };
        sendrPay: string;
        note: string;
        transactions: EncodedTxJson[];
      };
    }
  | {
      type: "cancelled";
      message: string;
    }
  | {
      type: "info";
      message: string;
      transactions?: EncodedTxJson[];
    };

export type SessionState = {
  pendingDraftId: string | null;
};
