/**
 * Recipient resolver for the WhatsApp webhook flow.
 *
 * Looks up registered users by username from the in-memory DB.
 * When chain mode is active (MONAD_RPC_URL set), you could extend
 * resolveOne to also read from the on-chain UsernameRegistry — for
 * the MVP, the DB is the source of truth (populated at sign-up).
 */
import { db } from "../db/index.js";
import type { User, Intent, ResolvedPayment } from "../types.js";

// ── Resolve a single username → { username, address } ────────────────────────
export async function resolveOne(
  raw: string,
): Promise<{ username: string; address: string }> {
  const username = raw.replace("@", "").toLowerCase().trim();
  if (!username) throw new Error("Empty username provided.");

  const user = await db.getUserByUsername(username);
  if (!user) {
    throw new Error(
      `@${username} is not on LiquiFi yet. Ask them to message this number to sign up.`,
    );
  }
  return { username: user.username, address: user.walletAddress };
}

// ── Resolve all recipients from an Intent ─────────────────────────────────────
export async function resolveRecipients(
  intent: Intent,
  sender: User,
): Promise<ResolvedPayment> {
  switch (intent.action) {
    case "SEND_SINGLE": {
      if (!intent.recipient) throw new Error("No recipient specified.");
      const r = await resolveOne(intent.recipient);
      const amount = intent.totalAmount ?? 0;
      return {
        recipients: [{ ...r, amount }],
        totalAmount: amount,
        note: intent.note,
      };
    }

    case "SPLIT_PAYMENT": {
      const names = intent.recipients;
      if (!names?.length) throw new Error("No recipients specified for split payment.");
      const total = intent.totalAmount ?? 0;
      const per = Math.round((total / names.length) * 100) / 100; // 2 dp

      const resolved = await Promise.all(names.map(resolveOne));
      return {
        recipients: resolved.map((r) => ({ ...r, amount: per })),
        totalAmount: total,
        note: intent.note,
      };
    }

    case "GROUP_PAYMENT": {
      if (!intent.groupName) throw new Error("No group name specified.");
      const groups = await db.getGroupsByOwner(sender.phone);
      const group = groups.find(
        (g) => g.name.toLowerCase() === intent.groupName!.toLowerCase(),
      );
      if (!group) {
        throw new Error(
          `Group "${intent.groupName}" not found. Type *my groups* to see your groups.`,
        );
      }
      if (!group.members.length) {
        throw new Error(
          `Group "${intent.groupName}" has no members yet.`,
        );
      }
      const total = intent.totalAmount ?? 0;
      const per = Math.round((total / group.members.length) * 100) / 100;
      return {
        recipients: group.members.map((m) => ({
          username: m.username,
          address: m.address,
          amount: per,
        })),
        totalAmount: total,
      };
    }

    default:
      throw new Error(`Cannot resolve recipients for action: ${intent.action}`);
  }
}
