import type { PaymentAction } from "./schemas.js";

// ── WhatsApp / Webhook types ──────────────────────────────────────────────────

export type WebhookBody = {
  entry?: Array<{
    changes?: Array<{
      value?: {
        messages?: Array<{
          from: string;
          id: string;
          timestamp: string;
          type: "text" | "interactive" | string;
          text?: { body: string };
          interactive?: {
            button_reply?: { id: string; title: string };
          };
        }>;
        contacts?: Array<{
          profile?: { name: string };
        }>;
      };
    }>;
  }>;
};

export type ParsedMessage = {
  phone: string;
  messageId: string;
  text: string;
  buttonId: string | null;
  name: string | null;
  timestamp: number;
};

// ── User model ────────────────────────────────────────────────────────────────

export type User = {
  phone: string;
  username: string;
  walletAddress: string;
  privyWalletId: string;
};

// ── Group model ───────────────────────────────────────────────────────────────

export type Group = {
  ownerPhone: string;
  name: string;
  members: { username: string; address: string }[];
};

// ── Privy wallet ──────────────────────────────────────────────────────────────

export type TxPayload = {
  to: string;
  data: string;
  value: string; // hex string
};

export type PrivyWallet = {
  id: string;
  address: string;
};

// ── Intent (parsed from WhatsApp message by AI) ───────────────────────────────

export type Intent = {
  action:
    | "SEND_SINGLE"
    | "SPLIT_PAYMENT"
    | "GROUP_PAYMENT"
    | "HELP"
    | "BALANCE"
    | "TX_HISTORY"
    | "CREATE_GROUP"
    | "ADD_TO_GROUP"
    | "REMOVE_FROM_GROUP"
    | "LIST_GROUPS"
    | "SPLIT_COUNT";
  totalAmount?: number;
  count?: number;        // SPLIT_COUNT: number of people to split among
  recipient?: string;   // SEND_SINGLE: single recipient username (no @)
  recipients?: string[];// SPLIT_PAYMENT: multiple usernames (no @)
  groupName?: string;   // GROUP_PAYMENT, ADD_TO_GROUP, REMOVE_FROM_GROUP
  members?: string[];   // CREATE_GROUP: initial member usernames
  name?: string;        // CREATE_GROUP: the group name
  member?: string;      // ADD_TO_GROUP, REMOVE_FROM_GROUP: single username
  note?: string;
};

// ── Resolved payment (addresses looked up) ───────────────────────────────────

export type ResolvedPayment = {
  recipients: { username: string; address: string; amount: number }[];
  totalAmount: number;
  note?: string;
};

// ── Pending tx stored while awaiting WhatsApp confirmation ───────────────────

export type PendingTxData = {
  txPayload: TxPayload;
  resolved: ResolvedPayment;
  intent: Intent;
  createdAt: number;
};

// ── Transaction history item ──────────────────────────────────────────────────

export type TxHistoryItem = {
  phone: string;
  txHash: string;
  intent: Intent;
  resolved: ResolvedPayment;
  timestamp: number;
  status: "confirmed" | "failed" | "pending";
};

// ── Security ──────────────────────────────────────────────────────────────────

export type SecurityResult =
  | { blocked: false; warning: string | null }
  | { blocked: true; reason: string };

// ── Existing pipeline types ───────────────────────────────────────────────────

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
