import type { ParsedIntent } from "./schemas.js";

const STOP = new Set([
  "to",
  "in",
  "with",
  "group",
  "everyone",
  "among",
  "between",
  "split",
  "send",
  "people",
  "want",
  "the",
  "my",
  "usd",
  "usdc",
  "dollar",
  "dollars",
  "and",
]);

function extractUsernames(segment: string): string[] {
  const out: string[] = [];
  for (const x of segment.matchAll(/@?([a-z0-9_]+)/gi)) {
    const w = x[1].toLowerCase();
    if (!STOP.has(w)) out.push(w);
  }
  return out;
}

function parseMoneyAmount(raw: string): number | null {
  const n = Number(raw.replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Deterministic parser for tests and offline use.
 * Returns null if no rule matches (caller may try LLM).
 */
export function ruleParse(message: string): ParsedIntent | null {
  const raw = message.trim();
  const lower = raw.toLowerCase();

  if (/^(list|show)\s+(my\s+)?groups\b/.test(lower) || /^what\s+groups/.test(lower)) {
    return { kind: "admin", action: "LIST_GROUPS" };
  }

  if (lower.includes("help") && lower.split(/\s+/).length <= 3) {
    return { kind: "admin", action: "HELP" };
  }

  const approveFor = raw.match(
    /^approve\s+\$?\s*([\d,]+(?:\.\d+)?)\s*(?:usd|usdc|dollars?)?\s+for\s+sendr(?:pay)?\s*\.?$/i,
  );
  if (approveFor) {
    const amount = parseMoneyAmount(approveFor[1]!);
    if (amount != null) {
      return { kind: "admin", action: "APPROVE_USDC", amount };
    }
  }

  const approveSpend = raw.match(
    /^(?:approve|allow)\s+sendr(?:pay)?\s+to\s+spend\s+\$?\s*([\d,]+(?:\.\d+)?)\s*(?:usd|usdc|dollars?)?\s*\.?$/i,
  );
  if (approveSpend) {
    const amount = parseMoneyAmount(approveSpend[1]!);
    if (amount != null) {
      return { kind: "admin", action: "APPROVE_USDC", amount };
    }
  }

  const register = raw.match(
    /^(?:i\s+want\s+to\s+)?(?:register|claim)(?:\s+username)?(?:\s+as)?\s+@?([a-z0-9]{3,32})\s*\.?$/i,
  );
  if (register) {
    return {
      kind: "admin",
      action: "REGISTER_USERNAME",
      username: register[1]!.toLowerCase(),
    };
  }

  const splitGroupTotal = raw.match(
    /(?:split|divide)\s+\$?\s*([\d,]+(?:\.\d+)?)\s*\$?\s*(?:usd|usdc|dollars?)?\s+(?:across|in|into)\s+(?:the\s+)?(?:group\s+)?(.+?)\s*$/i,
  );
  if (splitGroupTotal) {
    const amount = parseMoneyAmount(splitGroupTotal[1]!);
    let gname = splitGroupTotal[2]!.trim();
    gname = gname.replace(/\s+group\s*$/i, "").replace(/^\s*group\s+/i, "").trim();
    if (amount != null && gname.length > 0) {
      return {
        kind: "payment",
        action: "GROUP_SPLIT_TOTAL",
        amount,
        groupName: gname,
      };
    }
  }

  const addMembers = raw.match(/^add\s+(.+?)\s+to\s+group\s+(\d+)\s*\.?$/i);
  if (addMembers) {
    const users = extractUsernames(addMembers[1]!);
    if (users.length >= 1) {
      return {
        kind: "admin",
        action: "ADD_MEMBERS",
        groupId: addMembers[2]!,
        members: users,
      };
    }
  }

  const removeMembers = raw.match(/^remove\s+(.+?)\s+from\s+group\s+(\d+)\s*\.?$/i);
  if (removeMembers) {
    const users = extractUsernames(removeMembers[1]!);
    if (users.length >= 1) {
      return {
        kind: "admin",
        action: "REMOVE_MEMBERS",
        groupId: removeMembers[2]!,
        members: users,
      };
    }
  }

  const cancelGroup = raw.match(/^(?:cancel|close)\s+group\s+(\d+)\s*\.?$/i);
  if (cancelGroup) {
    return {
      kind: "admin",
      action: "CANCEL_GROUP",
      groupId: cancelGroup[1]!,
    };
  }

  const create = lower.match(
    /create\s+group\s+['"]?([^'"’]+?)['"]?\s+with\s+(.+)/i,
  );
  if (create) {
    const groupName = create[1].trim();
    const members = extractUsernames(create[2]);
    return { kind: "admin", action: "CREATE_GROUP", groupName, members };
  }

  const casualGroup = raw.match(
    /(?:i\s+want\s+to\s+)?send\s+\$?\s*([\d,]+(?:\.\d+)?)\s*\$?\s*(?:usd|usdc|dollars?)?\s+to\s+(?:a\s+)?group\s+(.+)/i,
  );
  if (casualGroup) {
    const amount = parseMoneyAmount(casualGroup[1]!);
    const groupName = casualGroup[2]!.replace(/\bgroup\b/gi, "").trim();
    if (amount != null) {
      return {
        kind: "payment",
        action: "SEND_TO_GROUP",
        perRecipientAmount: amount,
        groupName: groupName.length > 0 ? groupName : "group",
      };
    }
  }

  const casualGroupNamed = raw.match(
    /(?:i\s+want\s+to\s+)?send\s+\$?\s*([\d,]+(?:\.\d+)?)\s*\$?\s*(?:usd|usdc|dollars?)?\s+to\s+(?:the\s+)?(.+?)\s+group\b/i,
  );
  if (casualGroupNamed) {
    const amount = parseMoneyAmount(casualGroupNamed[1]!);
    const groupName = casualGroupNamed[2]!.trim();
    if (amount != null && groupName.length > 0) {
      return {
        kind: "payment",
        action: "SEND_TO_GROUP",
        perRecipientAmount: amount,
        groupName,
      };
    }
  }

  const sendGroup = lower.match(
    /send\s+\$?\s*([\d,]+(?:\.\d+)?)\s*\$?\s*(?:usd|usdc|dollars?)?\s+to\s+everyone\s+in\s+(.+)/,
  );
  if (sendGroup) {
    const amount = parseMoneyAmount(sendGroup[1]!);
    if (amount != null) {
      const groupName = sendGroup[2]!.replace(/\bgroup\b/gi, "").trim();
      return {
        kind: "payment",
        action: "SEND_TO_GROUP",
        perRecipientAmount: amount,
        groupName,
      };
    }
  }

  const sendSingle = lower.match(
    /send\s+\$?\s*([\d,]+(?:\.\d+)?)\s*\$?\s*(?:usd|usdc|dollars?)?\s+to\s+@?(\w+)/,
  );
  if (sendSingle) {
    const amount = parseMoneyAmount(sendSingle[1]!);
    if (amount != null) {
      return {
        kind: "payment",
        action: "SEND_SINGLE",
        amount,
        recipient: sendSingle[2]!,
      };
    }
  }

  const splitAmong = lower.match(
    /split\s+\$?\s*([\d,]+(?:\.\d+)?)\s*\$?\s*(?:usd|usdc|dollars?)?\s+among\s+(.+)/i,
  );
  if (splitAmong) {
    const total = parseMoneyAmount(splitAmong[1]!);
    const rest = splitAmong[2]!;
    const users = extractUsernames(rest);
    const mPeople = rest.match(/(\d+)\s+people/);
    if (total != null && users.length >= 2) {
      return {
        kind: "payment",
        action: "SPLIT_EQUAL",
        amount: total,
        splitCount: users.length,
        members: users,
      };
    }
    if (total != null && mPeople) {
      const n = Number(mPeople[1]);
      return {
        kind: "payment",
        action: "SPLIT_EQUAL",
        amount: total,
        splitCount: n,
      };
    }
  }

  return null;
}
