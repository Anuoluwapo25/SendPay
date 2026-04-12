import { Router } from "express";
import type { Request, Response } from "express";
import { parseIntent }                                                        from "../ai/parser.js";
import { resolveRecipients, resolveOne }                                      from "../resolver/index.js";
import { buildTxPayload }                                                     from "../coordinator/index.js";
import { securityCheck }                                                      from "../security/index.js";
import { createPrivyWallet, signAndBroadcast, registerUsernameOnChain }       from "../privy/wallet.js";
import { sendMessage, sendConfirmButtons, markRead, parseIncoming }           from "../whatsapp/client.js";
import { db }                                                                 from "../db/index.js";
import { makePublicClient }                                                   from "../chain/client.js";
import { readUsdcAddress, resolveUsernameOnChain, getRegisteredUsernameForAddress, resolveGroupByNameOnChain, formatGroupsLinesForWallet } from "../chain/reads.js";
import { readErc20Balance, readErc20Allowance }                               from "../chain/erc20Reads.js";
import { checkUsdcReadiness }                                                 from "../chain/usdcReadiness.js";
import { usdcBaseUnitsFromHuman }                                             from "../chain/usdcAmount.js";
import { encodeErc20Approve }                                                 from "../chain/encodeErc20.js";
import { encodeRegisterUsername }                                             from "../chain/encodeUserRegistry.js";
import { normalizeUsernameForRegistry }                                       from "../chain/normalizeUsername.js";
import { encodeCreateGroup, encodeAddMember, encodeRemoveMember }            from "../chain/encodeGroupRegistry.js";
import { sendrpayContract, groupRegistryContract }                           from "../abi/index.js";
import { maxUint256 }                                                         from "viem";
import type { User, Intent, ResolvedPayment, PendingTxData, WebhookBody }    from "../types.js";

function getChainClient() {
  const rpc = process.env.MONAD_RPC_URL!;
  return makePublicClient(rpc, Number(process.env.MONAD_CHAIN_ID ?? 10143));
}

type GasParams = {
  gasLimit: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
};

/**
 * Estimate gas limit + EIP-1559 fee params for a call using OUR Monad RPC.
 * This prevents Privy from applying incorrect mainnet-level gas prices to Monad txs.
 */
async function getGasParams(
  from: `0x${string}`,
  call: { to: `0x${string}`; data: `0x${string}`; value?: bigint },
): Promise<GasParams | null> {
  try {
    const client = getChainClient();
    const [gasEst, fees] = await Promise.all([
      client.estimateGas({
        account: from,
        to:      call.to,
        data:    call.data,
        value:   call.value ?? 0n,
      }),
      client.estimateFeesPerGas(),
    ]);
    return {
      gasLimit:             (gasEst * 130n) / 100n,            // 30% buffer
      maxFeePerGas:         fees.maxFeePerGas         ?? 0n,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas ?? 0n,
    };
  } catch (err) {
    console.warn("getGasParams failed (Privy will estimate):", (err as Error).message);
    return null;
  }
}

export const webhookRouter = Router();

webhookRouter.get("/", (req: Request, res: Response) => {
  const mode      = req.query["hub.mode"];
  const token     = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  // Meta webhook verification
  if (mode || token) {
    if (mode === "subscribe" && token === process.env.WEBHOOK_VERIFY_TOKEN) {
      console.log("✅ Meta webhook verified");
      return res.status(200).send(challenge);
    }
    return res.sendStatus(403);
  }

  // Direct browser visit — health check
  return res.status(200).json({ status: "ok", message: "SendPay webhook is live ✅" });
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

  // ── Step 0: auto-restore if wallet already has an on-chain username ──────────
  // Fires on first contact (no session) AND when re-entering onboarding mid-flow.
  // Privy's idempotencyKey guarantees the same wallet address every time.
  const walletForCheck = await createPrivyWallet(phone);
  const client         = getChainClient();
  const existingUsername = await getRegisteredUsernameForAddress(
    client,
    walletForCheck.address as `0x${string}`,
  );

  if (existingUsername === "REGISTERED_UNKNOWN") {
    // Wallet is on-chain registered but event query couldn't retrieve the name.
    // Ask the user to confirm their username so we can verify it on-chain.
    if (!session || session.step !== "AWAIT_USERNAME_RECOVERY") {
      await db.setSession(phone, {
        step: "AWAIT_USERNAME_RECOVERY",
        walletAddress: walletForCheck.address,
        walletId: walletForCheck.id,
      });
      await sendMessage(phone,
        `👋 Welcome back! Your wallet is already registered on SendrPay.\n\n` +
        `What is your *@username*? Reply with it so I can restore your account:`
      );
    } else {
      // User is replying with their username for recovery
      const raw      = text.startsWith("@") ? text.slice(1) : text;
      const username = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
      const check    = await resolveUsernameOnChain(client, username);
      if (!check.ok || check.address.toLowerCase() !== walletForCheck.address.toLowerCase()) {
        await sendMessage(phone, `❌ *@${username}* doesn't match your wallet. Try again:`);
        return;
      }
      await db.createUser({ phone, username, walletAddress: walletForCheck.address, privyWalletId: walletForCheck.id });
      await db.clearSession(phone);
      await sendMessage(phone,
        `✅ Welcome back, *@${username}*!\n\n` +
        `💳 Wallet: \`${walletForCheck.address}\`\n\n` +
        `*Try:*\n• "Send $20 USDC to @ada"\n• "My balance"\n• "Help"`
      );
    }
    return;
  }

  if (existingUsername) {
    // Wallet already registered on-chain — restore user to DB silently
    await db.createUser({
      phone,
      username:      existingUsername,
      walletAddress: walletForCheck.address,
      privyWalletId: walletForCheck.id,
    });
    await db.clearSession(phone);
    await sendMessage(phone,
      `✅ Welcome back, *@${existingUsername}*!\n\n` +
      `💳 Wallet: \`${walletForCheck.address}\`\n\n` +
      `*Try these commands:*\n` +
      `• "Send $20 USDC to @ada"\n` +
      `• "My balance"\n` +
      `• "Help"`
    );
    return;
  }
  // ─────────────────────────────────────────────────────────────────────────────

  // Step 1 — first contact: show wallet address + faucet, ask for username
  if (!session) {
    const greeting = name ? `👋 Hey *${name}*!` : "👋 Hey!";
    await sendMessage(phone, `${greeting} Welcome to *SendrPay* ⚡\n\n⏳ Setting up your Monad wallet...`);

    // Save wallet in session so Step 2 can use it without another Privy call
    await db.setSession(phone, {
      step: "AWAIT_USERNAME",
      walletAddress: walletForCheck.address,
      walletId: walletForCheck.id,
    });

    await sendMessage(phone,
      `✅ *Your wallet is ready!*\n\n` +
      `💳 Address: \`${walletForCheck.address}\`\n\n` +
      `⛽ *You need testnet MON for gas fees.*\n` +
      `Get it free here 👉 https://faucet.monad.xyz\n\n` +
      `Once you have MON, reply with your desired *@username*:\n` +
      `_(3–32 chars, letters and numbers only)_\n\n` +
      `Example: *@tolu*`
    );
    return;
  }

  // Step 2 — user replies with username: validate + register on-chain
  if (session.step === "AWAIT_USERNAME") {
    const raw      = text.startsWith("@") ? text.slice(1) : text;
    const username = raw.toLowerCase().replace(/[^a-z0-9]/g, "");

    if (username.length < 3) {
      await sendMessage(phone, "❌ Too short — at least 3 characters. Try again:");
      return;
    }
    if (username.length > 32) {
      await sendMessage(phone, "❌ Too long — max 32 characters. Try again:");
      return;
    }

    // Check in-memory first (fast), then on-chain (authoritative)
    const takenLocally = await db.isUsernameTaken(username);
    if (takenLocally) {
      await sendMessage(phone, `❌ *@${username}* is already taken. Try another:`);
      return;
    }
    const onChainUser = await resolveUsernameOnChain(client, username);
    if (onChainUser.ok) {
      await sendMessage(phone, `❌ *@${username}* is already registered. Try another:`);
      return;
    }

    const wallet = walletForCheck; // already fetched above

    // Save user to DB
    await db.createUser({
      phone,
      username,
      walletAddress: wallet.address,
      privyWalletId: wallet.id,
    });

    // Register username on-chain and wait for confirmation
    await sendMessage(phone, `⏳ Registering *@${username}* on-chain...`);
    try {
      // Estimate gas using our Monad RPC so Privy doesn't apply wrong mainnet prices
      const norm = normalizeUsernameForRegistry(username);
      const encoded = norm.ok ? encodeRegisterUsername(norm.name) : null;
      const regGas = encoded
        ? await getGasParams(wallet.address as `0x${string}`, {
            to:   encoded.to,
            data: encoded.data as `0x${string}`,
          })
        : null;
      if (regGas) console.log(`⛽ Reg gas: limit=${regGas.gasLimit}, maxFee=${regGas.maxFeePerGas}`);

      const regHash = await registerUsernameOnChain(phone, username, wallet.address, regGas ?? undefined);
      console.log(`⏳ Registration tx broadcast: ${regHash}`);
      const regReceipt = await client.waitForTransactionReceipt({ hash: regHash as `0x${string}` });
      if (regReceipt.status === "reverted") {
        throw new Error("Registration transaction reverted. Your wallet may not have enough MON for gas.");
      }
      console.log(`✅ @${username} registered on-chain: ${regHash}`);
    } catch (err) {
      console.error(`On-chain registration failed for @${username}:`, err);
      await sendMessage(phone,
        `❌ Registration failed: ${(err as Error).message}\n\n` +
        `Make sure your wallet has testnet MON for gas.\n` +
        `Faucet: https://faucet.monad.xyz\n\n` +
        `Then reply with your username again to retry.`
      );
      return;
    }

    await db.clearSession(phone);

    await sendMessage(phone,
      `✅ *@${username}* is yours!\n\n` +
      `💳 Wallet: \`${wallet.address}\`\n\n` +
      `*Try these commands:*\n` +
      `• "Send $20 USDC to @ada"\n` +
      `• "Split $100 USDC among @tolu @ada @john"\n` +
      `• "Create group Friends with @tolu @ada"\n` +
      `• "Send $50 USDC to Friends group"\n` +
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
      `You want to split *$${intent.totalAmount!.toLocaleString()} USDC* among *${intent.count}* people.\n\nWho should I split with? Reply with usernames:\ne.g. "@tolu @ada @john"`
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

  // ── USDC balance check ────────────────────────────────────────────────────
  try {
    const client      = getChainClient();
    const usdcAddress = await readUsdcAddress(client);
    const required    = usdcBaseUnitsFromHuman(resolved.totalAmount);
    const balance     = await readErc20Balance(client, usdcAddress, user.walletAddress as `0x${string}`);

    if (balance < required) {
      const has  = (Number(balance)   / 1_000_000).toFixed(2);
      const need = (Number(required)  / 1_000_000).toFixed(2);
      await sendMessage(phone,
        `❌ *Insufficient USDC*\n\n` +
        `This payment needs *$${need} USDC* but your wallet only has *$${has} USDC*.\n\n` +
        `Top up your wallet and try again.`
      );
      return;
    }
  } catch (err) {
    console.warn("USDC balance check failed (proceeding anyway):", (err as Error).message);
  }

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

  // ── USDC readiness check: auto-approve if allowance is too low ───────────
  const user = await db.getUserByPhone(phone);
  if (user) {
    try {
      const client      = getChainClient();
      const usdcAddress = await readUsdcAddress(client);
      const required    = usdcBaseUnitsFromHuman(pending.resolved.totalAmount);
      const readiness   = await checkUsdcReadiness(
        client,
        usdcAddress,
        user.walletAddress as `0x${string}`,
        sendrpayContract.address,
        required,
      );

      if (!readiness.ok) {
        if (readiness.reason === "insufficient_balance") {
          const has  = (Number(readiness.balance)  / 1_000_000).toFixed(2);
          const need = (Number(readiness.required) / 1_000_000).toFixed(2);
          await sendMessage(phone,
            `❌ *Insufficient USDC*\n\nThis payment needs *$${need} USDC* but your balance is *$${has} USDC*.\n\nTransaction cancelled.`
          );
          return;
        }

        if (readiness.reason === "insufficient_allowance") {
          await sendMessage(phone, "⏳ One-time setup: allowing SendrPay to send USDC on your behalf...");
          try {
            // Approve MaxUint256 so this never needs to happen again
            const approveCall = encodeErc20Approve(usdcAddress, sendrpayContract.address, maxUint256);

            // Estimate gas+fees using our RPC so Privy doesn't apply wrong mainnet prices
            const approveGas = await getGasParams(
              user.walletAddress as `0x${string}`,
              { to: approveCall.to, data: approveCall.data as `0x${string}` },
            );
            if (approveGas) console.log(`⛽ Approve gas: limit=${approveGas.gasLimit}, maxFee=${approveGas.maxFeePerGas}`);

            const approveHash = await signAndBroadcast(phone, {
              to: approveCall.to, data: approveCall.data, value: approveCall.value,
              ...approveGas,
            });
            console.log(`⏳ Approve tx broadcast: ${approveHash}`);

            const approveReceipt = await client.waitForTransactionReceipt({ hash: approveHash as `0x${string}` });
            if (approveReceipt.status === "reverted") {
              throw new Error("Approval transaction reverted on-chain. Ensure your wallet has MON for gas.");
            }
            console.log(`✅ USDC unlimited approval confirmed for @${user.username}: ${approveHash}`);
          } catch (err) {
            await sendMessage(phone, `❌ Setup failed: ${(err as Error).message}\n\nNo funds were moved. Please try again.`);
            return;
          }
        }
      }
    } catch (err) {
      console.warn("USDC readiness check failed (proceeding anyway):", (err as Error).message);
    }
  }

  // ── Estimate gas + fees for pay tx using our Monad RPC ───────────────────────
  const payPayload = { ...pending.txPayload };
  if (user) {
    // Log pre-execution USDC state for debugging
    try {
      const payClient = getChainClient();
      const usdcAddr  = await readUsdcAddress(payClient);
      const [bal, alw] = await Promise.all([
        readErc20Balance(payClient, usdcAddr, user.walletAddress as `0x${string}`),
        readErc20Allowance(payClient, usdcAddr, user.walletAddress as `0x${string}`, sendrpayContract.address),
      ]);
      console.log(`💰 Pre-pay state — balance: ${Number(bal)/1e6} USDC, allowance: ${alw === maxUint256 ? "∞" : Number(alw)/1e6 + " USDC"}`);
    } catch { /* non-fatal */ }

    const payGas = await getGasParams(
      user.walletAddress as `0x${string}`,
      { to: payPayload.to as `0x${string}`, data: payPayload.data as `0x${string}`, value: BigInt(payPayload.value) },
    );
    if (payGas) {
      console.log(`⛽ Pay gas: limit=${payGas.gasLimit}, maxFee=${payGas.maxFeePerGas}`);
      Object.assign(payPayload, payGas);
    }
  }

  // Execute
  await sendMessage(phone, "⏳ Signing and broadcasting on Monad...");

  let txHash: string;
  try {
    txHash = await signAndBroadcast(phone, payPayload);
  } catch (err) {
    console.error("Privy signing error:", err);
    await sendMessage(phone, `❌ Transaction failed to broadcast.\n\nError: ${(err as Error).message}\n\nNo funds were moved.`);
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
  let paymentDetail: string;
  if (pending.resolved.groupId !== undefined) {
    const per = pending.resolved.recipients[0]?.amount ?? 0;
    paymentDetail =
      `Group: *"${pending.resolved.groupName}"* — ${pending.resolved.recipients.length} members\n` +
      `$${per.toLocaleString()} USDC each`;
  } else {
    const note = pending.resolved.note ? `\n📝 _"${pending.resolved.note}"_` : "";
    paymentDetail = pending.resolved.recipients
      .map(r => `  • @${r.username} — $${r.amount.toLocaleString()} USDC`)
      .join("\n") + note;
  }

  await sendMessage(phone,
    `✅ *Done! Payment sent.*\n\n` +
    `${paymentDetail}\n\n` +
    `💰 Total: *$${pending.resolved.totalAmount.toLocaleString()} USDC*\n` +
    `🔗 Tx: \`${txHash.slice(0, 10)}...${txHash.slice(-6)}\`\n` +
    `🌐 Network: Monad Testnet ⚡\n\n` +
    `View: https://testnet.monadexplorer.com/tx/${txHash}`
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// GROUP MANAGEMENT  (fully on-chain via GroupRegistry)
// ═════════════════════════════════════════════════════════════════════════════
async function handleCreateGroup(phone: string, user: User, intent: Intent): Promise<void> {
  // 1. Resolve all member addresses on-chain
  const invalid: string[] = [];
  const members: Array<{ username: string; address: `0x${string}` }> = [];
  for (const raw of intent.members ?? []) {
    try {
      const r = await resolveOne(raw);
      if (r.address.toLowerCase() !== user.walletAddress.toLowerCase()) {
        members.push({ username: r.username, address: r.address as `0x${string}` });
      }
    } catch { invalid.push(raw); }
  }
  if (invalid.length > 0) {
    await sendMessage(phone, `❌ These users aren't on SendrPay:\n${invalid.map(u => `@${u}`).join(", ")}\n\nAsk them to sign up first.`);
    return;
  }
  if (members.length === 0) {
    await sendMessage(phone, "❌ A group needs at least one other person.");
    return;
  }

  await sendMessage(phone, `⏳ Creating group *"${intent.name}"* on-chain...`);
  const client = getChainClient();

  // 2. Submit createGroup tx
  const createCall = encodeCreateGroup(intent.name!);
  const createGas  = await getGasParams(user.walletAddress as `0x${string}`, { to: createCall.to, data: createCall.data as `0x${string}` });
  const createHash = await signAndBroadcast(phone, { to: createCall.to, data: createCall.data, value: createCall.value, ...createGas });
  const createReceipt = await client.waitForTransactionReceipt({ hash: createHash as `0x${string}` });
  if (createReceipt.status === "reverted") throw new Error("createGroup transaction reverted.");

  // 3. Read groupId from the GroupCreated event in the confirmed block
  const createLogs = await client.getLogs({
    address:   groupRegistryContract.address,
    event:     { type: "event", name: "GroupCreated", inputs: [{ type: "uint256", name: "groupId", indexed: true }, { type: "address", name: "owner", indexed: true }, { type: "string", name: "name", indexed: false }] } as const,
    args:      { owner: user.walletAddress as `0x${string}` },
    fromBlock: createReceipt.blockNumber,
    toBlock:   createReceipt.blockNumber,
  });
  const groupId = (createLogs.at(-1)?.args as { groupId?: bigint }).groupId;
  if (groupId === undefined) throw new Error("Could not read groupId from event log.");
  console.log(`✅ Group "${intent.name}" created on-chain, id=${groupId}`);

  // 4. Add each member (sequential — each tx awaited before the next)
  for (const m of members) {
    try {
      const addCall = encodeAddMember(groupId, m.address);
      const addGas  = await getGasParams(user.walletAddress as `0x${string}`, { to: addCall.to, data: addCall.data as `0x${string}` });
      const addHash = await signAndBroadcast(phone, { to: addCall.to, data: addCall.data, value: addCall.value, ...addGas });
      const addReceipt = await client.waitForTransactionReceipt({ hash: addHash as `0x${string}` });
      if (addReceipt.status === "reverted") console.warn(`addMember(${m.username}) reverted`);
      else console.log(`✅ Added @${m.username} to group ${groupId}`);
    } catch (err) {
      console.warn(`addMember(${m.username}) failed:`, (err as Error).message);
    }
  }

  const memberList = members.map(m => `  • @${m.username}`).join("\n");
  await sendMessage(phone,
    `✅ Group *"${intent.name}"* created!\n\nMembers:\n${memberList}\n\n` +
    `Now try:\n• "Send $50 USDC to ${intent.name} group"`
  );
}

async function handleAddToGroup(phone: string, user: User, intent: Intent): Promise<void> {
  // Resolve member address on-chain
  let member: { username: string; address: string };
  try { member = await resolveOne(intent.member!); }
  catch (err) { await sendMessage(phone, `❌ ${(err as Error).message}`); return; }

  // Find groupId for this wallet
  const client = getChainClient();
  const result  = await resolveGroupByNameOnChain(client, user.walletAddress as `0x${string}`, intent.groupName!);
  if (!result.ok) { await sendMessage(phone, `❌ ${result.reason}`); return; }

  const addCall = encodeAddMember(result.groupId, member.address as `0x${string}`);
  const addGas  = await getGasParams(user.walletAddress as `0x${string}`, { to: addCall.to, data: addCall.data as `0x${string}` });
  const addHash = await signAndBroadcast(phone, { to: addCall.to, data: addCall.data, value: addCall.value, ...addGas });
  const addReceipt = await client.waitForTransactionReceipt({ hash: addHash as `0x${string}` });
  if (addReceipt.status === "reverted") throw new Error("addMember transaction reverted.");

  // Count current members for display
  const updatedMembers = await client.readContract({ address: groupRegistryContract.address, abi: groupRegistryContract.abi, functionName: "getMembers", args: [result.groupId] }) as `0x${string}`[];
  await sendMessage(phone, `✅ @${member.username} added to *"${result.displayName}"*.\n\nGroup now has ${updatedMembers.length} member(s).`);
}

async function handleRemoveFromGroup(phone: string, user: User, intent: Intent): Promise<void> {
  let member: { username: string; address: string };
  try { member = await resolveOne(intent.member!); }
  catch (err) { await sendMessage(phone, `❌ ${(err as Error).message}`); return; }

  const client = getChainClient();
  const result  = await resolveGroupByNameOnChain(client, user.walletAddress as `0x${string}`, intent.groupName!);
  if (!result.ok) { await sendMessage(phone, `❌ ${result.reason}`); return; }

  const rmCall = encodeRemoveMember(result.groupId, member.address as `0x${string}`);
  const rmGas  = await getGasParams(user.walletAddress as `0x${string}`, { to: rmCall.to, data: rmCall.data as `0x${string}` });
  const rmHash = await signAndBroadcast(phone, { to: rmCall.to, data: rmCall.data, value: rmCall.value, ...rmGas });
  const rmReceipt = await client.waitForTransactionReceipt({ hash: rmHash as `0x${string}` });
  if (rmReceipt.status === "reverted") throw new Error("removeMember transaction reverted.");

  const updatedMembers = await client.readContract({ address: groupRegistryContract.address, abi: groupRegistryContract.abi, functionName: "getMembers", args: [result.groupId] }) as `0x${string}`[];
  await sendMessage(phone, `✅ @${member.username} removed from *"${result.displayName}"*.\n\nGroup now has ${updatedMembers.length} member(s).`);
}

async function handleListGroups(phone: string, user: User): Promise<void> {
  const client = getChainClient();
  const lines  = await formatGroupsLinesForWallet(client, user.walletAddress as `0x${string}`);
  await sendMessage(phone, `📋 *Your Groups*\n\n${lines}\n\nTo pay a group:\n• "Send $50 USDC to <group name> group"`);
}

// ═════════════════════════════════════════════════════════════════════════════
// BALANCE + HISTORY
// ═════════════════════════════════════════════════════════════════════════════
async function handleBalance(phone: string, user: User): Promise<void> {
  const rpc = process.env.MONAD_RPC_URL!;
  const client = makePublicClient(rpc, Number(process.env.MONAD_CHAIN_ID ?? 10143));

  let balanceText = "(could not fetch)";
  try {
    const usdcAddress = await readUsdcAddress(client);
    const raw = await readErc20Balance(client, usdcAddress, user.walletAddress as `0x${string}`);
    const usdc = (Number(raw) / 1_000_000).toFixed(2);
    balanceText = `*${usdc} USDC*`;
  } catch { /* RPC down — show address anyway */ }

  await sendMessage(phone,
    `💳 *@${user.username}*\n\n` +
    `Balance: ${balanceText}\n` +
    `Address: \`${user.walletAddress}\`\n` +
    `Network: Monad Testnet ⚡\n\n` +
    `Get testnet USDC from the faucet to start sending.`
  );
}

async function handleHistory(phone: string, _user: User): Promise<void> {
  const txs = await db.getTxHistory(phone, 5);

  if (txs.length === 0) {
    await sendMessage(phone, "You have no transactions yet.\n\nTry: \"Send $20 USDC to @tolu\"");
    return;
  }

  const lines = txs.map((tx, i) => {
    const date = new Date(tx.timestamp).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    const to   = tx.resolved.recipients.map(r => r.username).join(", ");
    return `${i + 1}. $${tx.resolved.totalAmount.toLocaleString()} USDC → ${to} · ${date} · ${tx.status === "confirmed" ? "✅" : tx.status === "failed" ? "❌" : "⏳"}`;
  });

  await sendMessage(phone, `📜 *Recent Transactions*\n\n${lines.join("\n")}`);
}

// ═════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═════════════════════════════════════════════════════════════════════════════
function buildConfirmText(resolved: ResolvedPayment, _intent: Intent, warning: string | null): string {
  const note    = resolved.note ? `\n📝 "${resolved.note}"` : "";
  const warnStr = warning ? `\n${warning}` : "";

  // Group payment — compact display
  if (resolved.groupId !== undefined) {
    const per = resolved.recipients[0]?.amount ?? 0;
    return (
      `🎯 *Confirm Group Payment*\n\n` +
      `Group: *"${resolved.groupName}"*\n` +
      `Members: *${resolved.recipients.length}*\n` +
      `Per member: *$${per.toLocaleString()} USDC*\n\n` +
      `💰 Total: *$${resolved.totalAmount.toLocaleString()} USDC*\n` +
      `🌐 Network: Monad Testnet${warnStr}\n\n` +
      `Transactions on Monad are *irreversible*.`
    );
  }

  // Single / split payment
  const recipientLines = resolved.recipients
    .map(r => `  • @${r.username} — $${r.amount.toLocaleString()} USDC`)
    .join("\n");
  return (
    `💸 *Confirm Payment*\n\n` +
    `${recipientLines}${note}\n\n` +
    `💰 Total: *$${resolved.totalAmount.toLocaleString()} USDC*\n` +
    `🌐 Network: Monad Testnet${warnStr}\n\n` +
    `Transactions on Monad are *irreversible*.`
  );
}

async function sendHelp(phone: string, user: User): Promise<void> {
  await sendMessage(phone,
    `🤖 *Sendpay — Command Guide*\n\n` +
    `*Send money:*\n` +
    `• "Send $20 USDC to @tolu"\n` +
    `• "Send $50 USDC to @ada for rent"\n\n` +
    `*Split bills:*\n` +
    `• "Split $100 USDC with @tolu @ada @john"\n` +
    `• "Split $100 USDC among 4 people"\n\n` +
    `*Groups:*\n` +
    `• "Create group Friends with @tolu @ada"\n` +
    `• "Send $50 USDC to Friends group"\n` +
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
