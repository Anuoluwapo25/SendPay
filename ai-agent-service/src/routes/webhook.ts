import { Router } from "express";
import type { Request, Response } from "express";
import { ethers } from "ethers";
import { parseIntent }                                                        from "../ai/parser.js";
import { resolveRecipients, resolveOne }                                      from "../resolver/index.js";
import { buildTxPayload }                                                     from "../coordinator/index.js";
import { securityCheck }                                                      from "../security/index.js";
import { createPrivyWallet, signAndBroadcast, registerUsernameOnChain }       from "../privy/wallet.js";
import { sendMessage, sendConfirmButtons, markRead, parseIncoming }           from "../whatsapp/client.js";
import { db }                                                                 from "../db/index.js";
import type { User, Intent, ResolvedPayment, PendingTxData, WebhookBody }    from "../types.js";

export const webhookRouter = Router();

webhookRouter.get("/", (req: Request, res: Response) => {
  const mode      = req.query["hub.mode"];
  const token     = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.WEBHOOK_VERIFY_TOKEN) {
    console.log("✅ Meta webhook verified");
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});


webhookRouter.post("/", async (req: Request, res: Response) => {
  res.sendStatus(200); 
  const msg = parseIncoming(req.body as WebhookBody);
  if (!msg) return;

  const { phone, messageId, text, buttonId } = msg;
  console.log(`📨 [${phone}] "${text}" buttonId=${buttonId}`);

  try {
    await markRead(messageId); 
    if (buttonId === "CONFIRM_YES" || buttonId === "CONFIRM_NO") {
      await handleConfirmation(phone, buttonId === "CONFIRM_YES");
      return;
    }

    // ── Route: plain text YES / NO (fallback for users who type it) ───────
    const lower = text.toLowerCase();
    const pendingTx = await db.getPendingTx(phone);
    if (pendingTx) {
      const yes = ["yes", "y", "send", "ok", "confirm", "✅"].includes(lower);
      const no  = ["no",  "n", "cancel", "stop", "❌"].includes(lower);
      if (yes || no) {
        await handleConfirmation(phone, yes);
        return;
      }
      // User typed something else while a tx was pending — cancel it
      await db.clearPendingTx(phone);
      await sendMessage(phone, "↩️ Previous transaction cancelled.");
    }

    // ── Route: check if user exists ───────────────────────────────────────
    const user = await db.getUserByPhone(phone);
    if (!user) {
      await handleOnboarding(phone, text, msg.name);
      return;
    }

    // ── Route: normal payment/group command ───────────────────────────────
    await handleCommand(phone, text, user);

  } catch (err) {
    console.error(`Error handling message from ${phone}:`, err);
    try {
      await sendMessage(phone, `⚠️ Something went wrong: ${(err as Error).message}\n\nPlease try again or type *help*.`);
    } catch { /* swallow — don't throw from webhook */ }
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// ONBOARDING
// ═════════════════════════════════════════════════════════════════════════════
async function handleOnboarding(phone: string, text: string, name: string | null): Promise<void> {
  const session = await db.getSession(phone);

  // Step 1 — first contact ever
  if (!session) {
    await db.setSession(phone, { step: "AWAIT_USERNAME" });
    const greeting = name ? `👋 Hey *${name}*!` : "👋 Hey!";
    await sendMessage(phone,
      `${greeting} Welcome to *LiquiFi* ⚡\n\nSend money on Monad just by chatting — no apps, no addresses.\n\nFirst, pick your *@username*:\n_(3–20 chars, letters/numbers/underscore)_\n\nExample: reply *@tolu*`
    );
    return;
  }

  // Step 2 — waiting for username choice
  if (session.step === "AWAIT_USERNAME") {
    const raw = text.startsWith("@") ? text.slice(1) : text;
    const username = raw.toLowerCase().replace(/[^a-z0-9_]/g, "");

    if (username.length < 3) {
      await sendMessage(phone, " Too short — at least 3 characters. Try again:");
      return;
    }
    if (username.length > 20) {
      await sendMessage(phone, " Too long — max 20 characters. Try again:");
      return;
    }

    const taken = await db.isUsernameTaken(username);
    if (taken) {
      await sendMessage(phone, ` *@${username}* is already taken. Try another:`);
      return;
    }

    // Create Privy server wallet
    await sendMessage(phone, "⏳ Creating your wallet on Monad...");
    const wallet = await createPrivyWallet(phone);

    // Save user to DB
    await db.createUser({
      phone,
      username,
      walletAddress: wallet.address,
      privyWalletId: wallet.id,
    });

    // Register username on-chain (async — don't block the welcome message)
    registerUsernameOnChain(phone, username, wallet.address)
      .then(hash => console.log(` Username @${username} registered on-chain: ${hash}`))
      .catch(err => console.error(`On-chain username registration failed:`, err));

    await db.clearSession(phone);

    await sendMessage(phone,
      `✅ *@${username}* is yours!\n\n` +
      `💳 Wallet: \`${wallet.address}\`\n` +
      `*Try these commands:*\n` +
      `• "Send ₦2000 to @ada"\n` +
      `• "Split ₦10k among @tolu @ada @john"\n` +
      `• "Create group Friends with @tolu @ada"\n` +
      `• "Send ₦2k to Friends group"\n` +
      `• "My balance"\n` +
      `━━━━━━━━━━━━━━━━━━━━`
    );
    return;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// COMMAND HANDLER
// ═════════════════════════════════════════════════════════════════════════════
async function handleCommand(phone: string, text: string, user: User): Promise<void> {

  // ── Parse intent with Claude ──────────────────────────────────────────────
  let intent: Intent;
  try {
    intent = await parseIntent(text);
  } catch (err) {
    await sendMessage(phone, `🤖 ${(err as Error).message}`);
    return;
  }

  console.log(`🤖 [${phone}] intent:`, intent);

  // ── Non-payment intents ───────────────────────────────────────────────────

  if (intent.action === "HELP") {
    await sendHelp(phone, user);
    return;
  }

  if (intent.action === "BALANCE") {
    await handleBalance(phone, user);
    return;
  }

  if (intent.action === "TX_HISTORY") {
    await handleHistory(phone, user);
    return;
  }

  if (intent.action === "CREATE_GROUP") {
    await handleCreateGroup(phone, user, intent);
    return;
  }

  if (intent.action === "ADD_TO_GROUP") {
    await handleAddToGroup(phone, user, intent);
    return;
  }

  if (intent.action === "REMOVE_FROM_GROUP") {
    await handleRemoveFromGroup(phone, user, intent);
    return;
  }

  if (intent.action === "LIST_GROUPS") {
    await handleListGroups(phone, user);
    return;
  }

  if (intent.action === "SPLIT_COUNT") {
    // Ask who to split with
    await db.setSession(phone, { step: "AWAIT_SPLIT_NAMES", intent });
    await sendMessage(phone,
      `You want to split *₦${intent.totalAmount!.toLocaleString()}* among *${intent.count}* people.\n\nWho should I split with? Reply with usernames:\ne.g. "@tolu @ada @john"`
    );
    return;
  }

  // ── Payment intents ───────────────────────────────────────────────────────

  if (!["SEND_SINGLE", "SPLIT_PAYMENT", "GROUP_PAYMENT"].includes(intent.action)) {
    await sendMessage(phone, "🤖 I didn't understand that. Type *help* to see what I can do.");
    return;
  }

  // Resolve addresses
  let resolved: ResolvedPayment;
  try {
    resolved = await resolveRecipients(intent, user);
  } catch (err) {
    await sendMessage(phone, `❌ ${(err as Error).message}`);
    return;
  }

  // Security check
  const risk = await securityCheck({ resolved, user });
  if (risk.blocked) {
    await sendMessage(phone, `🚫 *Blocked*\n\n${risk.reason}`);
    return;
  }

  // Build tx payload
  const txPayload = buildTxPayload(resolved, user.walletAddress);

  // Store pending tx
  await db.setPendingTx(phone, { txPayload, resolved, intent, createdAt: Date.now() });

  // Send confirmation with interactive buttons
  const confirmText = buildConfirmText(resolved, intent, risk.warning ?? null);
  await sendConfirmButtons(phone, confirmText);
}

// ═════════════════════════════════════════════════════════════════════════════
// CONFIRMATION
// ═════════════════════════════════════════════════════════════════════════════
async function handleConfirmation(phone: string, confirmed: boolean): Promise<void> {
  const pending = await db.getPendingTx(phone) as PendingTxData | null;
  await db.clearPendingTx(phone);

  if (!pending) {
    await sendMessage(phone, "⚠️ No pending transaction found. Please send your command again.");
    return;
  }

  // Check TTL (2 min)
  if (Date.now() - pending.createdAt > 120_000) {
    await sendMessage(phone, "⏰ That transaction expired (2 min limit). Please send the command again.");
    return;
  }

  if (!confirmed) {
    await sendMessage(phone, " Transaction cancelled. No funds were moved.");
    return;
  }

  // Execute
  await sendMessage(phone, "⏳ Signing and broadcasting on Monad...");

  let txHash: string;
  try {
    txHash = await signAndBroadcast(phone, pending.txPayload);
  } catch (err) {
    console.error("Privy signing error:", err);
    await sendMessage(phone, ` Transaction failed to broadcast.\n\nError: ${(err as Error).message}\n\nNo funds were moved.`);
    return;
  }

  // Save to history
  await db.saveTx({
    phone,
    txHash,
    intent:    pending.intent,
    resolved:  pending.resolved,
    timestamp: Date.now(),
  });

  // Success message
  const recipientLines = pending.resolved.recipients
    .map(r => `  • ${r.username} — ₦${r.amount.toLocaleString()}`)
    .join("\n");

  const note = pending.resolved.note ? `\n📝 _"${pending.resolved.note}"_` : "";

  await sendMessage(phone,
    `✅ *Done! Payment sent.*\n\n` +
    `${recipientLines}${note}\n\n` +
    `💰 Total: *₦${pending.resolved.totalAmount.toLocaleString()}*\n` +
    `🔗 Tx: \`${txHash.slice(0, 10)}...${txHash.slice(-6)}\`\n` +
    `🌐 Network: Monad Testnet ⚡\n\n` +
    `View: https://testnet.monadexplorer.com/tx/${txHash}`
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// GROUP MANAGEMENT
// ═════════════════════════════════════════════════════════════════════════════
async function handleCreateGroup(phone: string, user: User, intent: Intent): Promise<void> {
  const invalid: string[] = [];
  const members: Array<{ username: string; address: string }> = [];

  for (const raw of intent.members ?? []) {
    try {
      const r = await resolveOne(raw);
      if (r.address.toLowerCase() !== user.walletAddress.toLowerCase()) {
        members.push({ username: r.username, address: r.address });
      }
    } catch {
      invalid.push(raw);
    }
  }

  if (invalid.length > 0) {
    await sendMessage(phone,
      `❌ These users aren't on LiquiFi:\n${invalid.join(", ")}\n\nAsk them to message this number to sign up.`
    );
    return;
  }

  if (members.length === 0) {
    await sendMessage(phone, " A group needs at least one other person.");
    return;
  }

  await db.createGroup({ ownerPhone: phone, name: intent.name!, members });

  const memberList = members.map(m => `  • ${m.username}`).join("\n");
  await sendMessage(phone,
    `✅ Group *"${intent.name}"* created!\n\nMembers:\n${memberList}\n\nNow try:\n• "Send ₦2k to ${intent.name} group"\n• "Split ₦10k among ${intent.name} group"`
  );
}

async function handleAddToGroup(phone: string, user: User, intent: Intent): Promise<void> {
  let resolved: { username: string; address: string };
  try {
    resolved = await resolveOne(intent.member!);
  } catch (err) {
    await sendMessage(phone, ` ${(err as Error).message}`);
    return;
  }

  const group = await db.addGroupMember(phone, intent.groupName!, {
    username: resolved.username,
    address:  resolved.address,
  });

  if (!group) {
    await sendMessage(phone, ` Group *"${intent.groupName}"* not found.`);
    return;
  }

  await sendMessage(phone,
    `✅ ${resolved.username} added to *"${intent.groupName}"*.\n\nGroup now has ${group.members.length} member(s).`
  );
}

async function handleRemoveFromGroup(phone: string, _user: User, intent: Intent): Promise<void> {
  const username = intent.member!.replace("@", "").toLowerCase();
  const group = await db.removeGroupMember(phone, intent.groupName!, `@${username}`);

  if (!group) {
    await sendMessage(phone, ` Group *"${intent.groupName}"* not found.`);
    return;
  }

  await sendMessage(phone,
    `✅ @${username} removed from *"${intent.groupName}"*.\n\nGroup now has ${group.members.length} member(s).`
  );
}

async function handleListGroups(phone: string, _user: User): Promise<void> {
  const groups = await db.getGroupsByOwner(phone);

  if (groups.length === 0) {
    await sendMessage(phone,
      `You have no groups yet.\n\nCreate one:\n"Create group Friends with @tolu @ada"`
    );
    return;
  }

  const list = groups.map(g =>
    `• *${g.name}* — ${g.members.length} member(s): ${g.members.map(m => m.username).join(", ")}`
  ).join("\n");

  await sendMessage(phone, `📋 *Your Groups*\n\n${list}`);
}

// ═════════════════════════════════════════════════════════════════════════════
// BALANCE + HISTORY
// ═════════════════════════════════════════════════════════════════════════════
async function handleBalance(phone: string, user: User): Promise<void> {
  const provider = new ethers.JsonRpcProvider(process.env.MONAD_RPC_URL);

  let balanceText = "(could not fetch)";
  try {
    const raw = await provider.getBalance(user.walletAddress);
    const mon = parseFloat(ethers.formatEther(raw)).toFixed(4);
    const naira = Math.round(parseFloat(mon) * parseInt(process.env.NAIRA_PER_MON ?? "2000"));
    balanceText = `*${mon} MON* ≈ ₦${naira.toLocaleString()}`;
  } catch { /* RPC down — show address anyway */ }

  await sendMessage(phone,
    `💳 *@${user.username}*\n\n` +
    `Balance: ${balanceText}\n` +
    `Address: \`${user.walletAddress}\`\n` +
    `Network: Monad Testnet ⚡\n\n` +
    `Get testnet MON: https://faucet.monad.xyz`
  );
}

async function handleHistory(phone: string, _user: User): Promise<void> {
  const txs = await db.getTxHistory(phone, 5);

  if (txs.length === 0) {
    await sendMessage(phone, "You have no transactions yet.\n\nTry: \"Send ₦2000 to @tolu\"");
    return;
  }

  const lines = txs.map((tx, i) => {
    const date = new Date(tx.timestamp).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    const to   = tx.resolved.recipients.map(r => r.username).join(", ");
    return `${i + 1}. ₦${tx.resolved.totalAmount.toLocaleString()} → ${to} · ${date} · ${tx.status === "confirmed" ? "✅" : tx.status === "failed" ? "❌" : "⏳"}`;
  });

  await sendMessage(phone, `📜 *Recent Transactions*\n\n${lines.join("\n")}`);
}

// ═════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═════════════════════════════════════════════════════════════════════════════
function buildConfirmText(resolved: ResolvedPayment, _intent: Intent, warning: string | null): string {
  const recipientLines = resolved.recipients
    .map(r => `  • ${r.username} — ₦${r.amount.toLocaleString()}`)
    .join("\n");

  const note    = resolved.note ? `\n📝 "${resolved.note}"` : "";
  const warnStr = warning ? `\n${warning}` : "";

  return (
    ` *Confirm Payment*\n\n` +
    `${recipientLines}${note}\n\n` +
    ` Total: *₦${resolved.totalAmount.toLocaleString()}*\n` +
    ` Network: Monad Testnet${warnStr}\n\n` +
    `Transactions on Monad are *irreversible*.`
  );
}

async function sendHelp(phone: string, user: User): Promise<void> {
  await sendMessage(phone,
    `🤖 *Sendpay — Command Guide*\n\n` +
    `*Send money:*\n` +
    `• "Send ₦2000 to @tolu"\n` +
    `• "Send ₦5k to @ada for rent"\n\n` +
    `*Split bills:*\n` +
    `• "Split ₦10k with @tolu @ada @john"\n` +
    `• "Split ₦10k among 4 people"\n\n` +
    `*Groups:*\n` +
    `• "Create group Friends with @tolu @ada"\n` +
    `• "Send ₦2k to Friends group"\n` +
    `• "Add @john to Friends group"\n` +
    `• "My groups"\n\n` +
    `*Account:*\n` +
    `• "My balance"\n` +
    `• "My transactions"\n` +
    `• "Help"\n\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `Your username: *@${user.username}*\n` +
    `Wallet: \`${user.walletAddress.slice(0, 10)}...\``
  );
}
