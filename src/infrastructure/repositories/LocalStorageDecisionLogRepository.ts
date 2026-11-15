import type { DecisionLogRepository } from '@/application/services';
import type { DecisionLogEntry } from '@/domain/proposals';
import { readLocalJsonArray, writeLocalJson } from './localStorageUtils';

export const DEFAULT_DECISION_LOG_STORAGE_KEY = 'aurastudy.v1.decisionLogs';

function isValidDecisionLogEntry(raw: unknown): raw is DecisionLogEntry {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return false;
  }
  const entry = raw as Record<string, unknown>;
  return (
    typeof entry.id === 'string' &&
    typeof entry.userId === 'string' &&
    typeof entry.changeId === 'string' &&
    typeof entry.proposalId === 'string' &&
    (entry.action === 'create' ||
      entry.action === 'update' ||
      entry.action === 'delete') &&
    (entry.decision === 'accepted' || entry.decision === 'rejected') &&
    typeof entry.summary === 'string' &&
    typeof entry.decidedAt === 'string'
  );
}

export interface LocalStorageDecisionLogRepositoryOptions {
  storageKey?: string;
}

export class LocalStorageDecisionLogRepository implements DecisionLogRepository {
  private readonly storageKey: string;
  private fallbackMemory: DecisionLogEntry[] = [];

  constructor(options: LocalStorageDecisionLogRepositoryOptions = {}) {
    this.storageKey = options.storageKey ?? DEFAULT_DECISION_LOG_STORAGE_KEY;
    this.fallbackMemory = this.readAllFromStorage();
  }

  private readAllFromStorage(): DecisionLogEntry[] {
    const res = readLocalJsonArray<DecisionLogEntry>(this.storageKey, (raw) =>
      isValidDecisionLogEntry(raw) ? { ...raw } : null,
    );
    if (res.ok) {
      return res.items;
    }
    return this.fallbackMemory.map((e) => ({ ...e }));
  }

  private persistAll(entries: readonly DecisionLogEntry[]): void {
    this.fallbackMemory = entries.map((e) => ({ ...e }));
    writeLocalJson(this.storageKey, entries);
  }

  async append(entry: DecisionLogEntry): Promise<DecisionLogEntry> {
    const copy = { ...entry };
    const all = this.readAllFromStorage();
    all.push(copy);
    this.persistAll(all);
    return { ...copy };
  }

  async listRecent(limit = 50): Promise<DecisionLogEntry[]> {
    const all = this.readAllFromStorage();
    return all.slice(-limit).map((e) => ({ ...e }));
  }

  async clearAll(): Promise<void> {
    this.persistAll([]);
  }
}
