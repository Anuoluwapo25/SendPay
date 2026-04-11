import { randomUUID } from "node:crypto";
import type { DraftRecord, DraftTxPlan, ParsedIntent } from "./schemas.js";
import { encodeErc20Approve } from "./chain/encodeErc20.js";
import {
  encodeAddMember,
  encodeCancelGroup,
  encodeRemoveMember,
} from "./chain/encodeGroupRegistry.js";
import {
  encodePay,
  encodePayGroupEqual,
  encodePayGroupSplit,
  encodedCallToJson,
} from "./chain/encodeSendrPay.js";
import {
  checkUsdcReadiness,
  formatUsdcFromBase,
  totalBaseUnitsFromTxPlan,
} from "./chain/usdcReadiness.js";
import { USDC_DECIMALS, usdcBaseUnitsFromHuman } from "./chain/usdcAmount.js";
import {
  clearDraft,
  getPendingDraft,
  saveDraft,
  setPendingDraft,
} from "./state.js";
import type { ChatResponse, EncodedTxJson } from "./types.js";
import type { ResolutionDeps } from "./deps/types.js";

function parseGroupId(
  raw: string | number | undefined | null,
): bigint | null {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();
  if (!/^\d+$/.test(s)) return null;
  try {
    return BigInt(s);
  } catch {
    return null;
  }
}

function chainAdminGate(
  deps: ResolutionDeps,
  wallet: `0x${string}` | undefined,
): string | null {
  if (deps.mode !== "chain") {
    return "Group admin commands need **chain mode**. Set **MONAD_RPC_URL** (or **RPC_URL**).";
  }
  if (!deps.publicClient) {
    return "No RPC client.";
  }
  if (!wallet) {
    return "Pass **walletAddress** (the wallet that will sign).";
  }
  return null;
}

function shortAddr(a: string): string {
  const x = a.toLowerCase();
  if (x.length < 12) return a;
  return `${x.slice(0, 6)}…${x.slice(-4)}`;
}

/** Split total USDC (human) into `count` integer micro-USDC shares; sums exactly. */
function splitTotalUsdcMicro(
  totalHuman: number,
  count: number,
): { human: number; baseUnits: bigint }[] {
  const totalMicro = BigInt(Math.round(totalHuman * 1_000_000));
  const base = totalMicro / BigInt(count);
  const rem = Number(totalMicro - base * BigInt(count));
  const out: { human: number; baseUnits: bigint }[] = [];
  for (let i = 0; i < count; i++) {
    const micro = base + BigInt(i < rem ? 1 : 0);
    out.push({
      human: Number(micro) / 1_000_000,
      baseUnits: micro,
    });
  }
  return out;
}

function buildPreviewLines(
  recipients: { username: string; amount: number }[],
): string {
  const lines = recipients.map(
    (r) => `• @${r.username}: ${r.amount.toLocaleString()} USDC (each)`,
  );
  const total = recipients.reduce((s, r) => s + r.amount, 0);
  return `${lines.join("\n")}\nTotal: ${total.toLocaleString()} USDC`;
}

function policyCheck(
  recipients: { username: string; address: string; amount: number }[],
): string | null {
  const maxRecipients = 50;
  const maxPerTransfer = 1_000_000_000;
  if (recipients.length > maxRecipients) {
    return `Too many recipients (max ${maxRecipients})`;
  }
  for (const r of recipients) {
    if (r.amount <= 0) return "Amounts must be positive";
    if (r.amount > maxPerTransfer) {
      return `Amount exceeds maximum (${maxPerTransfer.toLocaleString()} USDC per recipient)`;
    }
  }
  return null;
}

async function buildWelcomeMessage(
  deps: ResolutionDeps,
  wallet: `0x${string}` | undefined,
): Promise<string> {
  const lines: string[] = ["Welcome to **SendR**."];
  if (deps.mode === "chain" && wallet && !(await deps.isWalletRegistered(wallet))) {
    lines.push(
      "",
      "**Your wallet does not have a SendR name yet** — register before sending USDC.",
    );
  }
  lines.push(
    "",
    "1. Always send **walletAddress** in the API body (the wallet that will sign).",
    "2. **Register**: **register as yourname** (3–32 chars, a–z and 0–9) — links your @name to your wallet on-chain.",
    "3. **Pay & groups**: **approve N usdc for sendr** first (or we’ll suggest approve if allowance is low). Then **send $20 to @alice** or **I want to send $100 to group Friends**; **list my groups**; **create group …**.",
    "Say **help** for more.",
  );
  return lines.join("\n");
}

async function maybeUsdcReadinessBlock(
  deps: ResolutionDeps,
  wallet: `0x${string}`,
  plan: DraftTxPlan,
): Promise<ChatResponse | null> {
  if (deps.mode !== "chain" || !deps.publicClient) return null;
  const meta = await deps.getMeta();
  const required = totalBaseUnitsFromTxPlan(plan);
  const r = await checkUsdcReadiness(
    deps.publicClient,
    meta.usdc,
    wallet,
    meta.sendrPay,
    required,
  );
  if (r.ok) return null;

  const bal = formatUsdcFromBase(r.balance);
  const alw = formatUsdcFromBase(r.allowance);
  const req = formatUsdcFromBase(r.required);

  if (r.reason === "insufficient_balance") {
    return {
      type: "clarify",
      question: `Not enough USDC: this payment needs **${req} USDC** but your balance is **${bal} USDC**. Fund your wallet, then try again.`,
    };
  }

  const approveTx = encodedCallToJson(
    encodeErc20Approve(meta.usdc, meta.sendrPay, r.required),
  );
  return {
    type: "clarify",
    question: `SendrPay needs permission to pull **${req} USDC**; your USDC allowance for SendrPay is only **${alw} USDC**. Sign **approve** below (sets allowance to **${req} USDC** for this spender), then send the same payment again and **confirm**.`,
    transactions: [approveTx],
  };
}

function encodeTxPlan(plan: DraftTxPlan) {
  switch (plan.mode) {
    case "pay":
      return [
        encodedCallToJson(
          encodePay(plan.to as `0x${string}`, BigInt(plan.amountBaseUnits)),
        ),
      ];
    case "payGroupEqual":
      return [
        encodedCallToJson(
          encodePayGroupEqual(
            BigInt(plan.groupId),
            BigInt(plan.amountPerMemberBaseUnits),
          ),
        ),
      ];
    case "payMany":
      return plan.items.map((i) =>
        encodedCallToJson(
          encodePay(i.to as `0x${string}`, BigInt(i.amountBaseUnits)),
        ),
      );
    case "payGroupSplit":
      return [
        encodedCallToJson(
          encodePayGroupSplit(
            BigInt(plan.groupId),
            BigInt(plan.totalBaseUnits),
          ),
        ),
      ];
  }
}

export async function paymentFromIntent(
  intent: ParsedIntent,
  deps: ResolutionDeps,
  wallet: `0x${string}` | undefined,
): Promise<
  | { ok: true; draft: Omit<DraftRecord, "draftId" | "sessionId" | "createdAt"> }
  | { ok: false; question: string }
> {
  if (intent.kind !== "payment") {
    return { ok: false, question: "Not a payment command." };
  }

  if (intent.action === "SEND_SINGLE") {
    const amount = intent.amount;
    const handle = intent.recipient;
    if (amount == null || !handle) {
      return { ok: false, question: "I need an amount and a recipient like @tolu." };
    }
    const r = await deps.resolveUsername(handle);
    if (!r.ok) {
      return {
        ok: false,
        question: `Cannot resolve @${r.username}: ${r.reason ?? "unknown"}`,
      };
    }
    const base = usdcBaseUnitsFromHuman(amount);
    const recipients = [
      { username: r.username, address: r.address, amount },
    ];
    const policy = policyCheck(recipients);
    if (policy) return { ok: false, question: policy };
    const preview = buildPreviewLines(recipients);
    const txPlan: DraftTxPlan = {
      mode: "pay",
      to: r.address,
      amountHuman: amount,
      amountBaseUnits: base.toString(),
    };
    return {
      ok: true,
      draft: {
        action: "SEND_SINGLE",
        recipients,
        totalAmount: amount,
        preview,
        txPlan,
      },
    };
  }

  if (intent.action === "SEND_TO_GROUP") {
    const per = intent.perRecipientAmount;
    const gname = intent.groupName;
    if (per == null || !gname) {
      return {
        ok: false,
        question: "I need an amount per person and a group name.",
      };
    }
    const groupLabel = gname
      .trim()
      .toLowerCase()
      .replace(/\b(the|a|my)\b/g, "")
      .replace(/\bgroup\b/g, "")
      .trim();
    if (!groupLabel) {
      return {
        ok: false,
        question:
          "Which group should get paid? Example: **I want to send $100 to group Friends** (use your group’s name).",
      };
    }
    if (deps.mode === "chain" && !wallet) {
      return {
        ok: false,
        question:
          "Pass **walletAddress** (your wallet) in the API body so we can find groups you own or belong to.",
      };
    }
    const g = await deps.resolveGroupByName(gname, wallet);
    if (!g.ok) {
      return { ok: false, question: g.reason };
    }
    const perBase = usdcBaseUnitsFromHuman(per);

    if (g.kind === "onchain") {
      const recipients = g.members.map((addr) => ({
        username: shortAddr(addr),
        address: addr,
        amount: per,
      }));
      const policy = policyCheck(recipients);
      if (policy) return { ok: false, question: policy };
      const preview = buildPreviewLines(recipients);
      const totalAmount = per * g.members.length;
      const txPlan: DraftTxPlan = {
        mode: "payGroupEqual",
        groupId: g.groupId.toString(),
        amountPerMemberHuman: per,
        amountPerMemberBaseUnits: perBase.toString(),
        memberCount: g.members.length,
      };
      return {
        ok: true,
        draft: {
          action: "SEND_TO_GROUP",
          recipients,
          totalAmount,
          preview,
          txPlan,
        },
      };
    }

    const recipients = g.members.map((m) => ({
      username: m.username,
      address: m.address,
      amount: per,
    }));
    const policy = policyCheck(recipients);
    if (policy) return { ok: false, question: policy };
    const preview = buildPreviewLines(recipients);
    const items = recipients.map((r) => ({
      to: r.address,
      amountHuman: per,
      amountBaseUnits: perBase.toString(),
    }));
    const txPlan: DraftTxPlan = { mode: "payMany", items };
    const totalAmount = per * recipients.length;
    return {
      ok: true,
      draft: {
        action: "SEND_TO_GROUP",
        recipients,
        totalAmount,
        preview,
        txPlan,
      },
    };
  }

  if (intent.action === "GROUP_SPLIT_TOTAL") {
    const total = intent.amount;
    const gname = intent.groupName;
    if (total == null || !gname) {
      return {
        ok: false,
        question:
          "I need a **total** USDC amount and a group, e.g. **split $100 across group Friends** or **split 50 usd in Friends group**.",
      };
    }
    const groupLabel = gname
      .trim()
      .toLowerCase()
      .replace(/\b(the|a|my)\b/g, "")
      .replace(/\bgroup\b/g, "")
      .trim();
    if (!groupLabel) {
      return {
        ok: false,
        question:
          "Which group? Example: **split $90 across group Team** (include the group name).",
      };
    }
    if (deps.mode === "chain" && !wallet) {
      return {
        ok: false,
        question:
          "Pass **walletAddress** so we can resolve the group on-chain.",
      };
    }
    const g = await deps.resolveGroupByName(gname, wallet);
    if (!g.ok) {
      return { ok: false, question: g.reason };
    }
    const totalBase = usdcBaseUnitsFromHuman(total);
    const n = g.members.length;
    const shares = splitTotalUsdcMicro(total, n);
    const recipients =
      g.kind === "onchain"
        ? g.members.map((addr, i) => ({
            username: shortAddr(addr),
            address: addr,
            amount: shares[i]!.human,
          }))
        : g.members.map((m, i) => ({
            username: m.username,
            address: m.address,
            amount: shares[i]!.human,
          }));
    const policy = policyCheck(recipients);
    if (policy) return { ok: false, question: policy };
    const preview = `${buildPreviewLines(recipients)}\n(One **payGroupSplit** tx on-chain; preview shows an even micro-split for display.)`;

    if (g.kind === "onchain") {
      const txPlan: DraftTxPlan = {
        mode: "payGroupSplit",
        groupId: g.groupId.toString(),
        totalHuman: total,
        totalBaseUnits: totalBase.toString(),
        memberCount: n,
      };
      return {
        ok: true,
        draft: {
          action: "GROUP_SPLIT_TOTAL",
          recipients,
          totalAmount: total,
          preview,
          txPlan,
        },
      };
    }

    const items = recipients.map((r, i) => ({
      to: r.address as `0x${string}`,
      amountHuman: shares[i]!.human,
      amountBaseUnits: shares[i]!.baseUnits.toString(),
    }));
    return {
      ok: true,
      draft: {
        action: "GROUP_SPLIT_TOTAL",
        recipients,
        totalAmount: total,
        preview,
        txPlan: { mode: "payMany", items },
      },
    };
  }

  if (intent.action === "SPLIT_EQUAL") {
    const total = intent.amount;
    const members = intent.members;
    const splitCount = intent.splitCount;
    if (total == null) {
      return { ok: false, question: "I need a total amount to split." };
    }
    if (!members || members.length < 2) {
      if (splitCount != null && splitCount >= 2) {
        return {
          ok: false,
          question: `Split among ${splitCount} people — who should receive? Tag them: @ada @tolu …`,
        };
      }
      return {
        ok: false,
        question:
          "Name at least two recipients with @username, or say how many people and who they are.",
      };
    }
    const resolved: { username: string; address: `0x${string}` }[] = [];
    for (const h of members) {
      const r = await deps.resolveUsername(h);
      if (!r.ok) {
        return {
          ok: false,
          question: `Cannot resolve @${r.username}: ${r.reason ?? "unknown"}`,
        };
      }
      resolved.push({ username: r.username, address: r.address });
    }
    const shares = splitTotalUsdcMicro(total, resolved.length);
    const recipients = resolved.map((r, i) => ({
      username: r.username,
      address: r.address,
      amount: shares[i]!.human,
    }));
    const policy = policyCheck(recipients);
    if (policy) return { ok: false, question: policy };
    const preview = buildPreviewLines(recipients);
    const items = resolved.map((r, i) => ({
      to: r.address,
      amountHuman: shares[i]!.human,
      amountBaseUnits: shares[i]!.baseUnits.toString(),
    }));
    const txPlan: DraftTxPlan = { mode: "payMany", items };
    return {
      ok: true,
      draft: {
        action: "SPLIT_EQUAL",
        recipients,
        totalAmount: total,
        preview,
        txPlan,
      },
    };
  }

  return { ok: false, question: "Unsupported payment action." };
}

type AdminIntentResult =
  | { kind: "info"; message: string; transactions?: EncodedTxJson[] }
  | { kind: "clarify"; question: string };

export async function adminFromIntent(
  intent: ParsedIntent,
  deps: ResolutionDeps,
  wallet: `0x${string}` | undefined,
): Promise<AdminIntentResult> {
  if (intent.kind !== "admin") {
    return { kind: "clarify", question: "Not an admin command." };
  }
  if (intent.action === "REGISTER_USERNAME") {
    const name = intent.username?.trim();
    if (!name) {
      return {
        kind: "clarify",
        question:
          "Say **register as yourname** (3–32 characters: lowercase letters and numbers only).",
      };
    }
    const res = await deps.adminRegisterUsername(name, wallet);
    if (!res.ok) {
      return { kind: "clarify", question: res.reason };
    }
    return {
      kind: "info",
      message: res.message,
      transactions: res.transactions,
    };
  }
  if (intent.action === "APPROVE_USDC") {
    const amt = intent.amount;
    if (amt == null || !Number.isFinite(amt)) {
      return {
        kind: "clarify",
        question:
          "Say how much USDC to approve, e.g. **approve 500 usdc for sendr** or **approve sendr to spend 50**.",
      };
    }
    if (deps.mode !== "chain") {
      return {
        kind: "info",
        message:
          "Mock mode has no USDC on-chain. With **MONAD_RPC_URL** set, **approve 500 usdc for sendr** returns **USDC.approve(SendrPay, …)** calldata.",
      };
    }
    if (!wallet) {
      return {
        kind: "clarify",
        question:
          "Pass **walletAddress** (the wallet that will sign the approve transaction).",
      };
    }
    const meta = await deps.getMeta();
    const base = usdcBaseUnitsFromHuman(amt);
    const tx = encodeErc20Approve(meta.usdc, meta.sendrPay, base);
    return {
      kind: "info",
      message: `Sign **USDC.approve** so SendrPay can pull up to **${amt} USDC** (approve more if you plan several payments).`,
      transactions: [encodedCallToJson(tx)],
    };
  }
  if (intent.action === "ADD_MEMBERS") {
    const gate = chainAdminGate(deps, wallet);
    if (gate) return { kind: "clarify", question: gate };
    const gid = parseGroupId(intent.groupId);
    if (gid == null) {
      return {
        kind: "clarify",
        question:
          "Say which group id, e.g. **add @mack to group 3** (get ids from **list my groups**).",
      };
    }
    const handles = intent.members ?? [];
    if (handles.length === 0) {
      return {
        kind: "clarify",
        question: "Name who to add, e.g. **add @mack to group 3**.",
      };
    }
    const txs: EncodedTxJson[] = [];
    for (const h of handles) {
      const r = await deps.resolveUsername(h);
      if (!r.ok) {
        return {
          kind: "clarify",
          question: `Cannot resolve @${r.username}: ${r.reason ?? "unknown"}`,
        };
      }
      txs.push(
        encodedCallToJson(encodeAddMember(gid, r.address)),
      );
    }
    return {
      kind: "info",
      message: `Sign **${txs.length}** GroupRegistry.addMember tx(s) for group **${gid}**. Only the group **owner** can add members.`,
      transactions: txs,
    };
  }
  if (intent.action === "REMOVE_MEMBERS") {
    const gate = chainAdminGate(deps, wallet);
    if (gate) return { kind: "clarify", question: gate };
    const gid = parseGroupId(intent.groupId);
    if (gid == null) {
      return {
        kind: "clarify",
        question:
          "Say which group id, e.g. **remove @mack from group 3**.",
      };
    }
    const handles = intent.members ?? [];
    if (handles.length === 0) {
      return {
        kind: "clarify",
        question: "Name who to remove, e.g. **remove @mack from group 3**.",
      };
    }
    const txs: EncodedTxJson[] = [];
    for (const h of handles) {
      const r = await deps.resolveUsername(h);
      if (!r.ok) {
        return {
          kind: "clarify",
          question: `Cannot resolve @${r.username}: ${r.reason ?? "unknown"}`,
        };
      }
      txs.push(
        encodedCallToJson(encodeRemoveMember(gid, r.address)),
      );
    }
    return {
      kind: "info",
      message: `Sign **${txs.length}** GroupRegistry.removeMember tx(s) for group **${gid}**. Only the group **owner** can remove members.`,
      transactions: txs,
    };
  }
  if (intent.action === "CANCEL_GROUP") {
    const gate = chainAdminGate(deps, wallet);
    if (gate) return { kind: "clarify", question: gate };
    const gid = parseGroupId(intent.groupId);
    if (gid == null) {
      return {
        kind: "clarify",
        question: "Say which group id, e.g. **cancel group 3**.",
      };
    }
    const tx = encodeCancelGroup(gid);
    return {
      kind: "info",
      message: `Sign **cancelGroup** for id **${gid}** (owner only). Future group pays will be blocked.`,
      transactions: [encodedCallToJson(tx)],
    };
  }
  if (intent.action === "LIST_GROUPS") {
    if (deps.mode === "chain" && !wallet) {
      return {
        kind: "clarify",
        question:
          "Pass **walletAddress** in the request body to list on-chain groups.",
      };
    }
    const message = await deps.listGroups(wallet);
    return { kind: "info", message };
  }
  if (intent.action === "HELP") {
    return {
      kind: "info",
      message: [
        "SendR — USDC via SendrPay (Monad testnet when RPC is set):",
        "• **register as yourname** — links @name to your wallet (sign UsernameRegistry.register)",
        "• **approve 500 usdc for sendr** — USDC.approve so SendrPay can pull funds",
        "• send $20 to @alice — or send 20.5 usd to @alice",
        "• I want to send $100 to group Friends — or send 10 to everyone in Friends",
        "• split $30 among @alice, @bob, @carol",
        "• **split $100 across group Friends** — total split (**payGroupSplit**)",
        "• **add @mack to group 3** / **remove @mack from group 3** / **cancel group 3** (chain only; owner-only)",
        "• create group Team with @alice, @bob",
        "• list my groups",
        "• **GET /tx/0x…** — receipt status after you broadcast",
        "On-chain: pass **walletAddress**; register before paying; balance + allowance checked.",
        "After a payment draft: **confirm** or **cancel**.",
      ].join("\n"),
    };
  }
  if (intent.action === "CREATE_GROUP") {
    const name = intent.groupName;
    const mem = intent.members ?? [];
    if (!name || mem.length === 0) {
      return {
        kind: "clarify",
        question: "Say: create group MyName with @user1, @user2",
      };
    }
    const res = await deps.adminCreateGroup(name, mem);
    if (!res.ok) {
      return { kind: "clarify", question: res.reason };
    }
    return {
      kind: "info",
      message: res.message,
      transactions: res.transactions,
    };
  }
  return { kind: "clarify", question: "Unknown admin command." };
}

const CONFIRM_RE = /^(yes|y|confirm|ok|proceed|sure)\b/i;
const CANCEL_RE = /^(no|cancel|stop|nope)\b/i;

export type ParseMessageFn = (text: string) => Promise<ParsedIntent>;

export async function handleUserMessage(
  sessionId: string,
  message: string,
  deps: ResolutionDeps,
  parseFn: ParseMessageFn,
  walletAddress?: `0x${string}`,
): Promise<ChatResponse> {
  const t = message.trim();

  if (CONFIRM_RE.test(t)) {
    const pending = getPendingDraft(sessionId);
    if (!pending) {
      return {
        type: "info",
        message: "Nothing to confirm. Try a payment command first.",
      };
    }
    if (deps.mode === "chain") {
      if (!walletAddress) {
        return {
          type: "clarify",
          question:
            "Pass **walletAddress** in the request body to confirm (must match a registered SendR wallet).",
        };
      }
      if (!(await deps.isWalletRegistered(walletAddress))) {
        return {
          type: "clarify",
          question:
            "This wallet is not registered yet. Say **register as yourname**, sign the tx, then confirm again.",
        };
      }
      if (deps.publicClient) {
        const block = await maybeUsdcReadinessBlock(
          deps,
          walletAddress,
          pending.txPlan,
        );
        if (block) return block;
      }
    }
    setPendingDraft(sessionId, null);
    clearDraft(pending.draftId);
    const meta = await deps.getMeta();
    const transactions = encodeTxPlan(pending.txPlan);
    return {
      type: "tx_ready",
      draftId: pending.draftId,
      preview: pending.preview,
      tx: {
        chainId: meta.chainId,
        usdc: { address: meta.usdc, decimals: USDC_DECIMALS },
        sendrPay: meta.sendrPay,
        note: "USDC balance and allowance were checked for this pull. Sign below with the same wallet as walletAddress.",
        transactions,
      },
    };
  }

  if (CANCEL_RE.test(t)) {
    const pending = getPendingDraft(sessionId);
    if (pending) {
      clearDraft(pending.draftId);
      setPendingDraft(sessionId, null);
      return { type: "cancelled", message: "Draft cancelled. What next?" };
    }
    return { type: "info", message: "No active draft. Say **help** for examples." };
  }

  const intent = await parseFn(t);

  if (intent.kind === "unknown") {
    if (/^(hi|hello|hey|start|good\s+morning)\b/i.test(t)) {
      return {
        type: "info",
        message: await buildWelcomeMessage(deps, walletAddress),
      };
    }
    return {
      type: "clarify",
      question:
        "I did not understand. Try **register as yourname**, **send $20 to @alice**, or **I want to send $100 to group Friends** — or say **help**.",
    };
  }

  if (intent.kind === "admin") {
    const a = await adminFromIntent(intent, deps, walletAddress);
    if (a.kind === "clarify") {
      return { type: "clarify", question: a.question };
    }
    return {
      type: "info",
      message: a.message,
      ...(a.transactions?.length ? { transactions: a.transactions } : {}),
    };
  }

  if (intent.kind === "payment") {
    if (deps.mode === "chain") {
      if (!walletAddress) {
        return {
          type: "clarify",
          question:
            "Include **walletAddress** in the JSON body. We use it to confirm your wallet is registered with a SendR name before sending USDC, and to find your groups.",
        };
      }
      if (!(await deps.isWalletRegistered(walletAddress))) {
        return {
          type: "clarify",
          question:
            "Link your wallet to a SendR name first: say **register as yourname** (3–32 chars, a–z and 0–9), sign the UsernameRegistry transaction, then try paying again.",
        };
      }
    }
  }

  const p = await paymentFromIntent(intent, deps, walletAddress);
  if (!p.ok) return { type: "clarify", question: p.question };

  if (deps.mode === "chain" && deps.publicClient && walletAddress) {
    const block = await maybeUsdcReadinessBlock(
      deps,
      walletAddress,
      p.draft.txPlan,
    );
    if (block) return block;
  }

  const draftId = randomUUID();
  const draft: DraftRecord = {
    draftId,
    sessionId,
    createdAt: Date.now(),
    ...p.draft,
  };
  saveDraft(draft);
  setPendingDraft(sessionId, draftId);

  return {
    type: "draft",
    draftId,
    preview: draft.preview,
    action: draft.action,
    recipients: draft.recipients,
    totalAmount: draft.totalAmount,
  };
}
