import type {
  AIProviderType,
  RemoteAIProviderType,
  StoredApiKeyEntry,
} from '@/application/services';

export type { AIProviderType, RemoteAIProviderType, StoredApiKeyEntry };

const PROVIDER_TYPE_KEY = 'aurastudy.ai.providerType';
const GEMINI_MODEL_KEY = 'aurastudy.ai.geminiModel';
const OPENAI_MODEL_KEY = 'aurastudy.ai.openaiModel';
const PERSIST_LOCAL_KEY = 'aurastudy.ai.persistLocal';
const KEY_PREFIX = 'aurastudy.ai.apiKey.';
const KEY_LIST_PREFIX = 'aurastudy.ai.apiKeys.';

export const DEFAULT_GEMINI_MODEL = 'gemini-4-hydrogen';
export const DEFAULT_OPENAI_MODEL = 'gpt-6-luna';

const LEGACY_OPENAI_MODEL_IDS = new Set(['gpt-4o-mini']);

interface StoredApiKeyCollection {
  activeId: string | null;
  entries: StoredApiKeyEntry[];
}

function getSafeStorage(kind: 'session' | 'local'): Storage | null {
  try {
    if (typeof window === 'undefined') {
      return null;
    }
    return kind === 'session' ? window.sessionStorage : window.localStorage;
  } catch {
    return null;
  }
}

export function getDefaultApiKeyLabel(provider: RemoteAIProviderType): string {
  return provider === 'openai' ? 'OpenAI 預設金鑰' : 'Gemini 預設金鑰';
}

export function maskApiKey(apiKey: string): string {
  const trimmed = apiKey.trim();
  if (!trimmed) {
    return '';
  }
  if (trimmed.startsWith('sk-') && trimmed.length > 7) {
    return `sk-...${trimmed.slice(-4)}`;
  }
  if (trimmed.length > 8) {
    return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
  }
  if (trimmed.length > 4) {
    return `${trimmed.slice(0, 2)}...${trimmed.slice(-2)}`;
  }
  return '****';
}

export function normalizeOpenAIModel(model: string | null | undefined): string {
  const trimmed = model?.trim() ?? '';
  if (!trimmed || LEGACY_OPENAI_MODEL_IDS.has(trimmed.toLowerCase())) {
    return DEFAULT_OPENAI_MODEL;
  }
  return trimmed;
}

export function getStoredAIProviderType(): AIProviderType {
  const session = getSafeStorage('session');
  const local = getSafeStorage('local');
  const raw =
    session?.getItem(PROVIDER_TYPE_KEY) ?? local?.getItem(PROVIDER_TYPE_KEY);
  if (raw === 'gemini' || raw === 'openai' || raw === 'demo') {
    return raw;
  }
  return 'demo';
}

export function setStoredAIProviderType(provider: AIProviderType): void {
  const session = getSafeStorage('session');
  const local = getSafeStorage('local');
  session?.setItem(PROVIDER_TYPE_KEY, provider);
  local?.setItem(PROVIDER_TYPE_KEY, provider);
}

export function getStoredGeminiModel(): string {
  const session = getSafeStorage('session');
  const local = getSafeStorage('local');
  const raw =
    session?.getItem(GEMINI_MODEL_KEY) ?? local?.getItem(GEMINI_MODEL_KEY);
  const trimmed = raw?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : DEFAULT_GEMINI_MODEL;
}

export function setStoredGeminiModel(model: string): void {
  const normalized = model.trim() || DEFAULT_GEMINI_MODEL;
  const session = getSafeStorage('session');
  const local = getSafeStorage('local');
  session?.setItem(GEMINI_MODEL_KEY, normalized);
  local?.setItem(GEMINI_MODEL_KEY, normalized);
}

export function getStoredOpenAIModel(): string {
  const session = getSafeStorage('session');
  const local = getSafeStorage('local');
  const sessionRaw = session?.getItem(OPENAI_MODEL_KEY);
  const localRaw = local?.getItem(OPENAI_MODEL_KEY);
  const raw = sessionRaw ?? localRaw;
  const normalized = normalizeOpenAIModel(raw);

  // Seamlessly migrate legacy gpt-4o-mini storage value to gpt-6-luna
  if (raw && raw.trim().toLowerCase() !== normalized.toLowerCase()) {
    if (sessionRaw !== null && sessionRaw !== undefined) {
      session?.setItem(OPENAI_MODEL_KEY, normalized);
    }
    if (localRaw !== null && localRaw !== undefined) {
      local?.setItem(OPENAI_MODEL_KEY, normalized);
    }
  }

  return normalized;
}

export function setStoredOpenAIModel(model: string): void {
  const normalized = normalizeOpenAIModel(model);
  const session = getSafeStorage('session');
  const local = getSafeStorage('local');
  session?.setItem(OPENAI_MODEL_KEY, normalized);
  local?.setItem(OPENAI_MODEL_KEY, normalized);
}

export function getPersistKeyInLocalStorage(): boolean {
  const local = getSafeStorage('local');
  return local?.getItem(PERSIST_LOCAL_KEY) === 'true';
}

function generateEntryId(provider: RemoteAIProviderType): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${provider}-${crypto.randomUUID()}`;
  }
  return `${provider}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function parseStoredCollection(
  raw: string | null | undefined,
  provider: RemoteAIProviderType,
): StoredApiKeyCollection | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    const candidate = parsed as { activeId?: unknown; entries?: unknown };
    if (!Array.isArray(candidate.entries)) {
      return null;
    }

    const defaultLabel = getDefaultApiKeyLabel(provider);
    const nowIso = new Date().toISOString();
    const seenIds = new Set<string>();
    const entries: StoredApiKeyEntry[] = [];

    for (let i = 0; i < candidate.entries.length; i += 1) {
      const item = candidate.entries[i];
      if (!item || typeof item !== 'object') {
        continue;
      }
      const record = item as Record<string, unknown>;
      const apiKey = typeof record.apiKey === 'string' ? record.apiKey.trim() : '';
      if (!apiKey) {
        continue;
      }
      const rawId =
        typeof record.id === 'string' && record.id.trim().length > 0
          ? record.id.trim()
          : `${provider}-entry-${i + 1}`;
      if (seenIds.has(rawId)) {
        continue;
      }
      seenIds.add(rawId);

      const rawLabel =
        typeof record.label === 'string' && record.label.trim().length > 0
          ? record.label.trim()
          : defaultLabel;
      const createdAt =
        typeof record.createdAt === 'string' && record.createdAt.trim().length > 0
          ? record.createdAt
          : nowIso;
      const updatedAt =
        typeof record.updatedAt === 'string' && record.updatedAt.trim().length > 0
          ? record.updatedAt
          : createdAt;

      entries.push({
        id: rawId,
        label: rawLabel,
        apiKey,
        createdAt,
        updatedAt,
      });
    }

    if (entries.length === 0) {
      return { activeId: null, entries: [] };
    }

    const requestedActiveId =
      typeof candidate.activeId === 'string' ? candidate.activeId : null;
    const hasActive =
      requestedActiveId !== null && entries.some((e) => e.id === requestedActiveId);

    return {
      activeId: hasActive ? requestedActiveId : entries[0].id,
      entries,
    };
  } catch {
    return null;
  }
}

function readCollectionWithMigration(
  provider: RemoteAIProviderType,
): StoredApiKeyCollection {
  const listKey = `${KEY_LIST_PREFIX}${provider}`;
  const legacyKeyName = `${KEY_PREFIX}${provider}`;
  const session = getSafeStorage('session');
  const local = getSafeStorage('local');

  const sessionCollection = parseStoredCollection(
    session?.getItem(listKey),
    provider,
  );
  if (sessionCollection && sessionCollection.entries.length > 0) {
    return sessionCollection;
  }

  const localCollection = parseStoredCollection(local?.getItem(listKey), provider);
  if (localCollection && localCollection.entries.length > 0) {
    // Hydrate session cache for active tab
    session?.setItem(listKey, JSON.stringify(localCollection));
    const active =
      localCollection.entries.find((e) => e.id === localCollection.activeId) ??
      localCollection.entries[0];
    if (active) {
      session?.setItem(legacyKeyName, active.apiKey);
    }
    return localCollection;
  }

  // Legacy single-string migration: aurastudy.ai.apiKey.<provider>
  const legacyRaw =
    session?.getItem(legacyKeyName)?.trim() ||
    local?.getItem(legacyKeyName)?.trim() ||
    '';

  if (!legacyRaw) {
    return { activeId: null, entries: [] };
  }

  const nowIso = new Date().toISOString();
  const migratedEntry: StoredApiKeyEntry = {
    id: `legacy-${provider}`,
    label: getDefaultApiKeyLabel(provider),
    apiKey: legacyRaw,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  const migrated: StoredApiKeyCollection = {
    activeId: migratedEntry.id,
    entries: [migratedEntry],
  };

  session?.setItem(listKey, JSON.stringify(migrated));
  if (local?.getItem(legacyKeyName)?.trim()) {
    local.setItem(listKey, JSON.stringify(migrated));
  }

  return migrated;
}

function persistCollection(
  provider: RemoteAIProviderType,
  collection: StoredApiKeyCollection,
  persistInLocalStorage: boolean,
): void {
  const listKey = `${KEY_LIST_PREFIX}${provider}`;
  const legacyKeyName = `${KEY_PREFIX}${provider}`;
  const session = getSafeStorage('session');
  const local = getSafeStorage('local');

  if (collection.entries.length === 0) {
    session?.removeItem(listKey);
    session?.removeItem(legacyKeyName);
    local?.removeItem(listKey);
    local?.removeItem(legacyKeyName);
    return;
  }

  const activeEntry =
    collection.entries.find((e) => e.id === collection.activeId) ??
    collection.entries[0];
  const normalizedCollection: StoredApiKeyCollection = {
    activeId: activeEntry.id,
    entries: collection.entries,
  };
  const serialized = JSON.stringify(normalizedCollection);

  session?.setItem(listKey, serialized);
  session?.setItem(legacyKeyName, activeEntry.apiKey);

  if (persistInLocalStorage) {
    local?.setItem(PERSIST_LOCAL_KEY, 'true');
    local?.setItem(listKey, serialized);
    local?.setItem(legacyKeyName, activeEntry.apiKey);
  } else {
    local?.removeItem(PERSIST_LOCAL_KEY);
    local?.removeItem(listKey);
    local?.removeItem(legacyKeyName);
  }
}

export function getStoredApiKeyEntries(
  provider: RemoteAIProviderType,
): StoredApiKeyEntry[] {
  return readCollectionWithMigration(provider).entries;
}

export function getActiveStoredApiKeyId(
  provider: RemoteAIProviderType,
): string | null {
  return readCollectionWithMigration(provider).activeId;
}

export function getStoredApiKey(provider: RemoteAIProviderType): string {
  const collection = readCollectionWithMigration(provider);
  if (collection.entries.length === 0) {
    return '';
  }
  const active =
    collection.entries.find((e) => e.id === collection.activeId) ??
    collection.entries[0];
  return active?.apiKey.trim() ?? '';
}

export function saveStoredApiKey(
  provider: RemoteAIProviderType,
  apiKey: string,
  persistInLocalStorage: boolean,
  label?: string,
): StoredApiKeyEntry[] {
  const trimmedKey = apiKey.trim();
  if (!trimmedKey) {
    clearStoredApiKey(provider);
    return [];
  }

  const current = readCollectionWithMigration(provider);
  const nowIso = new Date().toISOString();
  const explicitLabel = label?.trim() ?? '';
  const defaultLabel = getDefaultApiKeyLabel(provider);

  const existingIndex = current.entries.findIndex(
    (entry) => entry.apiKey === trimmedKey,
  );

  let nextEntries: StoredApiKeyEntry[];
  let nextActiveId: string;

  if (existingIndex >= 0) {
    const existing = current.entries[existingIndex];
    const updatedEntry: StoredApiKeyEntry = {
      ...existing,
      label: explicitLabel || existing.label || defaultLabel,
      updatedAt: nowIso,
    };
    nextEntries = current.entries.map((entry, idx) =>
      idx === existingIndex ? updatedEntry : entry,
    );
    nextActiveId = updatedEntry.id;
  } else {
    const newEntry: StoredApiKeyEntry = {
      id: generateEntryId(provider),
      label: explicitLabel || defaultLabel,
      apiKey: trimmedKey,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    nextEntries = [...current.entries, newEntry];
    nextActiveId = newEntry.id;
  }

  persistCollection(
    provider,
    { activeId: nextActiveId, entries: nextEntries },
    persistInLocalStorage,
  );
  return nextEntries;
}

export function setActiveStoredApiKey(
  provider: RemoteAIProviderType,
  entryId: string,
  persistInLocalStorage: boolean = getPersistKeyInLocalStorage(),
): StoredApiKeyEntry[] {
  const current = readCollectionWithMigration(provider);
  const target = current.entries.find((entry) => entry.id === entryId);
  if (!target) {
    return current.entries;
  }
  persistCollection(
    provider,
    { activeId: target.id, entries: current.entries },
    persistInLocalStorage,
  );
  return current.entries;
}

export function renameStoredApiKey(
  provider: RemoteAIProviderType,
  entryId: string,
  nextLabel: string,
  persistInLocalStorage: boolean = getPersistKeyInLocalStorage(),
): StoredApiKeyEntry[] {
  const current = readCollectionWithMigration(provider);
  const resolvedLabel = nextLabel.trim() || getDefaultApiKeyLabel(provider);
  const nowIso = new Date().toISOString();

  let changed = false;
  const nextEntries = current.entries.map((entry) => {
    if (entry.id !== entryId) {
      return entry;
    }
    changed = true;
    return {
      ...entry,
      label: resolvedLabel,
      updatedAt: nowIso,
    };
  });

  if (!changed) {
    return current.entries;
  }

  persistCollection(
    provider,
    { activeId: current.activeId, entries: nextEntries },
    persistInLocalStorage,
  );
  return nextEntries;
}

export function deleteStoredApiKeyEntry(
  provider: RemoteAIProviderType,
  entryId: string,
  persistInLocalStorage: boolean = getPersistKeyInLocalStorage(),
): StoredApiKeyEntry[] {
  const current = readCollectionWithMigration(provider);
  const remaining = current.entries.filter((entry) => entry.id !== entryId);
  if (remaining.length === current.entries.length) {
    return current.entries;
  }

  const nextActiveId =
    current.activeId === entryId
      ? (remaining[0]?.id ?? null)
      : current.activeId;

  persistCollection(
    provider,
    { activeId: nextActiveId, entries: remaining },
    persistInLocalStorage,
  );
  return remaining;
}

export function clearStoredApiKey(provider: RemoteAIProviderType): void {
  const storageKey = `${KEY_PREFIX}${provider}`;
  const listKey = `${KEY_LIST_PREFIX}${provider}`;
  getSafeStorage('session')?.removeItem(storageKey);
  getSafeStorage('session')?.removeItem(listKey);
  getSafeStorage('local')?.removeItem(storageKey);
  getSafeStorage('local')?.removeItem(listKey);
}

export function getAIProviderDisplayName(provider: AIProviderType): string {
  if (provider === 'gemini') return 'Google Gemini';
  if (provider === 'openai') return 'OpenAI';
  return 'Demo 模式（內建模擬 AI）';
}
