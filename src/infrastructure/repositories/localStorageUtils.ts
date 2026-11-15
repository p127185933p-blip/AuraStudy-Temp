import type { ChatMessage } from '@/application/services';

export const LOCAL_CLEARED_FLAG_KEY = 'aurastudy.v1.localCleared';
export const LOCAL_CHAT_MESSAGES_KEY = 'aurastudy.v1.chatMessages';
const MAX_LOCAL_CHAT_MESSAGES = 50;

export function getSafeLocalStorage(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return null;
    }
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readLocalJsonArray<T>(
  storageKey: string,
  parseItem: (raw: unknown) => T | null,
): { ok: true; items: T[] } | { ok: false } {
  const storage = getSafeLocalStorage();
  if (!storage) {
    return { ok: false };
  }

  let rawText: string | null = null;
  try {
    rawText = storage.getItem(storageKey);
  } catch {
    return { ok: false };
  }

  if (!rawText) {
    return { ok: true, items: [] };
  }

  try {
    const parsed: unknown = JSON.parse(rawText);
    if (!Array.isArray(parsed)) {
      return { ok: true, items: [] };
    }
    const items: T[] = [];
    for (const entry of parsed) {
      const valid = parseItem(entry);
      if (valid !== null) {
        items.push(valid);
      }
    }
    return { ok: true, items };
  } catch {
    // Corrupted JSON in localStorage: recover safely with empty list
    return { ok: true, items: [] };
  }
}

export function writeLocalJson(storageKey: string, value: unknown): boolean {
  const storage = getSafeLocalStorage();
  if (!storage) {
    return false;
  }

  try {
    storage.setItem(storageKey, JSON.stringify(value));
    return true;
  } catch {
    // Handle QuotaExceededError or private-browsing storage restrictions gracefully
    return false;
  }
}

export function isLocalDemoSeedSuppressed(): boolean {
  const storage = getSafeLocalStorage();
  if (!storage) {
    return false;
  }
  try {
    return storage.getItem(LOCAL_CLEARED_FLAG_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setLocalDemoSeedSuppressed(suppressed: boolean): void {
  const storage = getSafeLocalStorage();
  if (!storage) {
    return;
  }
  try {
    if (suppressed) {
      storage.setItem(LOCAL_CLEARED_FLAG_KEY, 'true');
    } else {
      storage.removeItem(LOCAL_CLEARED_FLAG_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

function isValidChatMessage(raw: unknown): raw is ChatMessage {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return false;
  }
  const candidate = raw as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' &&
    candidate.id.length > 0 &&
    (candidate.role === 'user' || candidate.role === 'assistant') &&
    typeof candidate.content === 'string' &&
    typeof candidate.createdAt === 'string'
  );
}

export function loadLocalChatMessages(): ChatMessage[] {
  const result = readLocalJsonArray<ChatMessage>(
    LOCAL_CHAT_MESSAGES_KEY,
    (raw) => (isValidChatMessage(raw) ? raw : null),
  );
  return result.ok ? result.items : [];
}

export function saveLocalChatMessages(messages: readonly ChatMessage[]): void {
  const trimmed = messages.slice(-MAX_LOCAL_CHAT_MESSAGES);
  // Strip transient base64 payloads so localStorage stays well under quota
  const compact = trimmed.map((msg) => ({
    ...msg,
    ...(msg.attachments
      ? {
          attachments: msg.attachments.map(({ base64Data: _b, textContent: _t, ...meta }) => meta),
        }
      : {}),
  }));
  writeLocalJson(LOCAL_CHAT_MESSAGES_KEY, compact);
}

export function clearLocalChatMessages(): void {
  const storage = getSafeLocalStorage();
  if (!storage) return;
  try {
    storage.removeItem(LOCAL_CHAT_MESSAGES_KEY);
  } catch {
    // ignore storage errors
  }
}
