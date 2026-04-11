/**
 * In-memory database for the WhatsApp webhook flow.
 *
 * Stores users, sessions, pending transactions, groups, and tx history.
 * All data is lost on restart — swap out the Map stores for a real DB
 * (e.g. Redis, Postgres) when moving to production.
 */
import type {
  User,
  Group,
  Intent,
  ResolvedPayment,
  PendingTxData,
  TxHistoryItem,
} from "../types.js";

type OnboardingSession = { step: "AWAIT_USERNAME" | string; intent?: Intent };

// ── In-memory stores ──────────────────────────────────────────────────────────
const users          = new Map<string, User>();              // phone → User
const byUsername     = new Map<string, string>();            // username → phone
const sessions       = new Map<string, OnboardingSession>(); // phone → session
const pendingTxs     = new Map<string, PendingTxData>();     // phone → pending tx
const privyWalletIds = new Map<string, string>();            // phone → walletId
const groupStore     = new Map<string, Group[]>();           // phone → groups
const txHistoryStore = new Map<string, TxHistoryItem[]>();   // phone → history

export const db = {
  // ── Users ─────────────────────────────────────────────────────────────────
  async getUserByPhone(phone: string): Promise<User | null> {
    return users.get(phone) ?? null;
  },

  async getUserByUsername(username: string): Promise<User | null> {
    const phone = byUsername.get(username.toLowerCase());
    if (!phone) return null;
    return users.get(phone) ?? null;
  },

  async createUser(u: User): Promise<void> {
    users.set(u.phone, u);
    byUsername.set(u.username.toLowerCase(), u.phone);
    // Also store the privy wallet id in the dedicated map
    privyWalletIds.set(u.phone, u.privyWalletId);
  },

  async isUsernameTaken(username: string): Promise<boolean> {
    return byUsername.has(username.toLowerCase());
  },

  // ── Onboarding sessions ───────────────────────────────────────────────────
  async getSession(phone: string): Promise<OnboardingSession | null> {
    return sessions.get(phone) ?? null;
  },

  async setSession(phone: string, session: OnboardingSession): Promise<void> {
    sessions.set(phone, session);
  },

  async clearSession(phone: string): Promise<void> {
    sessions.delete(phone);
  },

  // ── Pending transactions ──────────────────────────────────────────────────
  async getPendingTx(phone: string): Promise<PendingTxData | null> {
    return pendingTxs.get(phone) ?? null;
  },

  async setPendingTx(phone: string, data: PendingTxData): Promise<void> {
    pendingTxs.set(phone, data);
  },

  async clearPendingTx(phone: string): Promise<void> {
    pendingTxs.delete(phone);
  },

  // ── Privy wallet IDs ──────────────────────────────────────────────────────
  async getPrivyWalletId(phone: string): Promise<string | null> {
    return privyWalletIds.get(phone) ?? null;
  },

  async savePrivyWalletId(phone: string, walletId: string): Promise<void> {
    privyWalletIds.set(phone, walletId);
    // Keep user record in sync if it exists
    const user = users.get(phone);
    if (user) users.set(phone, { ...user, privyWalletId: walletId });
  },

  // ── Groups ────────────────────────────────────────────────────────────────
  async createGroup(data: {
    ownerPhone: string;
    name: string;
    members: { username: string; address: string }[];
  }): Promise<void> {
    const owned = groupStore.get(data.ownerPhone) ?? [];
    // Replace if a group with the same name already exists
    const idx = owned.findIndex(
      (g) => g.name.toLowerCase() === data.name.toLowerCase(),
    );
    const group: Group = {
      ownerPhone: data.ownerPhone,
      name: data.name,
      members: data.members,
    };
    if (idx >= 0) {
      owned[idx] = group;
    } else {
      owned.push(group);
    }
    groupStore.set(data.ownerPhone, owned);
  },

  async getGroupsByOwner(phone: string): Promise<Group[]> {
    return groupStore.get(phone) ?? [];
  },

  async getGroupByName(phone: string, groupName: string): Promise<Group | null> {
    const owned = groupStore.get(phone) ?? [];
    return (
      owned.find((g) => g.name.toLowerCase() === groupName.toLowerCase()) ??
      null
    );
  },

  async addGroupMember(
    phone: string,
    groupName: string,
    member: { username: string; address: string },
  ): Promise<Group | null> {
    const owned = groupStore.get(phone) ?? [];
    const group = owned.find(
      (g) => g.name.toLowerCase() === groupName.toLowerCase(),
    );
    if (!group) return null;
    // Avoid duplicate members
    if (!group.members.find((m) => m.username.toLowerCase() === member.username.toLowerCase())) {
      group.members.push(member);
    }
    return group;
  },

  async removeGroupMember(
    phone: string,
    groupName: string,
    username: string,
  ): Promise<Group | null> {
    const owned = groupStore.get(phone) ?? [];
    const group = owned.find(
      (g) => g.name.toLowerCase() === groupName.toLowerCase(),
    );
    if (!group) return null;
    const clean = username.replace("@", "").toLowerCase();
    group.members = group.members.filter(
      (m) => m.username.toLowerCase() !== clean,
    );
    return group;
  },

  // ── Transaction history ───────────────────────────────────────────────────
  async saveTx(tx: {
    phone: string;
    txHash: string;
    intent: Intent;
    resolved: ResolvedPayment;
    timestamp: number;
  }): Promise<void> {
    const history = txHistoryStore.get(tx.phone) ?? [];
    history.unshift({ ...tx, status: "pending" });
    txHistoryStore.set(tx.phone, history);
  },

  async getTxHistory(phone: string, limit: number): Promise<TxHistoryItem[]> {
    return (txHistoryStore.get(phone) ?? []).slice(0, limit);
  },

  async getTxCountLastMinute(phone: string): Promise<number> {
    const cutoff = Date.now() - 60_000;
    const history = txHistoryStore.get(phone) ?? [];
    return history.filter((tx) => tx.timestamp >= cutoff).length;
  },
};
