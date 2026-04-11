import "dotenv/config";
import express from "express";
import { isAddress, isHash } from "viem";
import { createResolutionDeps } from "./deps/createDeps.js";
import { handleUserMessage } from "./pipeline.js";
import { createMessageParser } from "./parseMessage.js";
import { fetchTxReceiptStatus } from "./txStatus.js";

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

const port = Number(process.env.PORT) || 3001;
app.listen(port, () => {
  console.log(`SendR agent listening on http://localhost:${port} (resolution: ${deps.mode})`);
  console.log(
    "Example: curl -s -X POST http://localhost:%s/chat -H \"Content-Type: application/json\" -d '{\"sessionId\":\"u1\",\"walletAddress\":\"0xYourWallet\",\"message\":\"send 20 to @alice\"}'",
    port,
  );
  console.log(`Tx status: GET http://localhost:${port}/tx/0x…`);
});
