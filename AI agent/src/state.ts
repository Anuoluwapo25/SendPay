import type { DraftRecord } from "./schemas.js";
import type { SessionState } from "./types.js";

const drafts = new Map<string, DraftRecord>();
const sessions = new Map<string, SessionState>();

export function getSession(sessionId: string): SessionState {
  let s = sessions.get(sessionId);
  if (!s) {
    s = { pendingDraftId: null };
    sessions.set(sessionId, s);
  }
  return s;
}

export function setPendingDraft(sessionId: string, draftId: string | null): void {
  getSession(sessionId).pendingDraftId = draftId;
}

export function getPendingDraft(sessionId: string): DraftRecord | null {
  const id = getSession(sessionId).pendingDraftId;
  if (!id) return null;
  return drafts.get(id) ?? null;
}

export function saveDraft(draft: DraftRecord): void {
  drafts.set(draft.draftId, draft);
}

export function getDraft(draftId: string): DraftRecord | undefined {
  return drafts.get(draftId);
}

export function clearDraft(draftId: string): void {
  drafts.delete(draftId);
}

/** Test helper */
export function resetStores(): void {
  drafts.clear();
  sessions.clear();
}
