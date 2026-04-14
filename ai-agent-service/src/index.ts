import "dotenv/config";
import express from "express";
import { isAddress, isHash } from "viem";
import { createResolutionDeps } from "./deps/createDeps.js";
import { handleUserMessage } from "./pipeline.js";
import { createMessageParser } from "./parseMessage.js";
import { fetchTxReceiptStatus } from "./txStatus.js";
import { webhookRouter } from "./routes/webhook.js";
import { getPrivyWallet } from "./privy/wallet.js";
import { db } from "./db/index.js";

const app = express();
app.use(express.json());

const deps = createResolutionDeps();
const parseMessage = createMessageParser();

app.post("/chat", async (req, res) => {
  const sessionId =
    typeof req.body?.sessionId === "string" && req.body.sessionId
      ? req.body.sessionId
      : "default";
  const message = req.body?.message;
  if (typeof message !== "string" || !message.trim()) {
    res.status(400).json({ error: "message (string) required" });
    return;
  }

  const rawWallet = req.body?.walletAddress;
  const walletAddress =
    typeof rawWallet === "string" && isAddress(rawWallet)
      ? (rawWallet as `0x${string}`)
      : undefined;

  try {
    const out = await handleUserMessage(
      sessionId,
      message,
      deps,
      parseMessage,
      walletAddress,
    );
    res.json(out);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, mode: deps.mode });
});

app.get("/tx/:hash", async (req, res) => {
  const h = req.params.hash;
  if (!isHash(h)) {
    res.status(400).json({ error: "invalid tx hash" });
    return;
  }
  if (!deps.publicClient) {
    res.status(503).json({
      error: "RPC not configured",
      mode: deps.mode,
      hint: "Set MONAD_RPC_URL or RPC_URL",
    });
    return;
  }
  try {
    const out = await fetchTxReceiptStatus(deps.publicClient, h);
    const message =
      out.status === "success"
        ? "Done ✅ Transaction succeeded."
        : out.status === "failed"
          ? "Failed ❌ Transaction reverted or failed."
          : "Pending… No receipt yet (or tx not found on this RPC).";
    res.json({ ...out, message });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});

app.post("/tx-status", async (req, res) => {
  const raw = req.body?.txHash ?? req.body?.hash;
  if (typeof raw !== "string" || !isHash(raw)) {
    res.status(400).json({ error: "txHash (0x-prefixed 32-byte hash) required" });
    return;
  }
  if (!deps.publicClient) {
    res.status(503).json({
      error: "RPC not configured",
      mode: deps.mode,
    });
    return;
  }
  try {
    const out = await fetchTxReceiptStatus(deps.publicClient, raw);
    const message =
      out.status === "success"
        ? "Done ✅"
        : out.status === "failed"
          ? "Failed ❌"
          : "Pending…";
    res.json({ ...out, message });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});

// ── Admin: restore a user's wallet mapping ───────────────────────────────────
// Use this when the in-memory DB lost the phone→wallet mapping on restart,
// or when Privy handed the user a different wallet and you need to restore the old one.
//
// Usage:
//   curl -X POST http://localhost:3000/admin/restore-wallet \
//     -H "Content-Type: application/json" \
//     -H "x-admin-secret: <ADMIN_SECRET>" \
//     -d '{"phone":"+2348012345678","privyWalletId":"<wallet-id-from-privy-console>"}'
//
// The wallet ID is found in the Privy console → Wallets → click the wallet →
// copy the ID from the URL or details panel.
app.post("/admin/restore-wallet", async (req, res) => {
  const secret = process.env.ADMIN_SECRET;
  if (!secret || req.headers["x-admin-secret"] !== secret) {
    res.status(401).json({ error: "Unauthorised — set ADMIN_SECRET in .env and pass it as x-admin-secret header" });
    return;
  }

  const raw = req.body as { phone?: string; privyWalletId?: string };
  if (typeof raw.phone !== "string" || !raw.phone.trim()) {
    res.status(400).json({ error: "phone (string) required" });
    return;
  }
  // Normalise to WhatsApp format: no leading + (WhatsApp sends e.g. "2348067839121")
  const phone = raw.phone.trim().replace(/^\+/, "");
  const privyWalletId = raw.privyWalletId;
  if (typeof privyWalletId !== "string" || !privyWalletId.trim()) {
    res.status(400).json({ error: "privyWalletId (string) required — get it from the Privy console" });
    return;
  }

  try {
    // Verify the wallet ID is real and fetch its address from Privy
    const wallet = await getPrivyWallet(privyWalletId);

    const existingUser = await db.getUserByPhone(phone);
    if (existingUser) {
      await db.updateUser(phone, {
        walletAddress: wallet.address,
        privyWalletId: wallet.id,
      });
      res.json({
        ok: true,
        action: "updated",
        phone,
        walletAddress: wallet.address,
        privyWalletId: wallet.id,
      });
    } else {
      // No user record yet (server just restarted) — create a minimal one
      await db.createUser({
        phone,
        username: `user_${phone.slice(-4)}`,
        walletAddress: wallet.address,
        privyWalletId: wallet.id,
      });
      res.json({
        ok: true,
        action: "created",
        phone,
        walletAddress: wallet.address,
        privyWalletId: wallet.id,
        note: "Minimal user created. If the user has an on-chain username it will be auto-restored on their next message.",
      });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});

// ── WhatsApp webhook (Meta Cloud API) ────────────────────────────────────────
// GET  /webhook — Meta verification challenge
// POST /webhook — Incoming WhatsApp messages
app.use("/webhook", webhookRouter);

// ── Startup wallet restore (survives every server restart) ───────────────────
// Set these in .env to pin a phone number to a specific Privy wallet ID.
// The wallet ID is found in the Privy console → Wallets → click your wallet.
//
//   WALLET_RESTORE_PHONE=+2348012345678
//   WALLET_RESTORE_PRIVY_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
//
async function restoreWalletOnStartup(): Promise<void> {
  // Normalise to WhatsApp format (no leading +)
  const phone    = process.env.WALLET_RESTORE_PHONE?.trim().replace(/^\+/, "");
  const walletId = process.env.WALLET_RESTORE_PRIVY_ID?.trim();
  if (!phone || !walletId) return;

  try {
    const wallet = await getPrivyWallet(walletId);
    const existing = await db.getUserByPhone(phone);
    if (existing) {
      await db.updateUser(phone, { walletAddress: wallet.address, privyWalletId: wallet.id });
      console.log(`✅ Wallet restored (update): ${phone} → ${wallet.address}`);
    } else {
      await db.createUser({
        phone,
        username:      `user_${phone.slice(-4)}`,
        walletAddress: wallet.address,
        privyWalletId: wallet.id,
      });
      console.log(`✅ Wallet restored (create): ${phone} → ${wallet.address}`);
    }
  } catch (err) {
    console.error(`❌ Startup wallet restore failed for ${phone}:`, (err as Error).message);
  }
}

const port = Number(process.env.PORT) || 3001;
app.listen(port, async () => {
  await restoreWalletOnStartup();
  console.log(`SendR agent listening on http://localhost:${port} (resolution: ${deps.mode})`);
  console.log(
    "Example: curl -s -X POST http://localhost:%s/chat -H \"Content-Type: application/json\" -d '{\"sessionId\":\"u1\",\"walletAddress\":\"0xYourWallet\",\"message\":\"send 20 to @alice\"}'",
    port,
  );
  console.log(`Tx status: GET http://localhost:${port}/tx/0x…`);
});
