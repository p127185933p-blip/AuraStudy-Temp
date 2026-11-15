import type { ProposalRepository } from '@/application/services';
import type { ProposalChange } from '@/domain/proposals';
import { ProposalChangeSchema } from '@/shared/schemas';
import { readLocalJsonArray, writeLocalJson } from './localStorageUtils';

export const DEFAULT_PROPOSAL_STORAGE_KEY = 'aurastudy.v1.proposals';

function cloneProposal(change: ProposalChange): ProposalChange {
  return {
    ...change,
    ...(change.before ? { before: { ...change.before } } : {}),
    ...(change.after ? { after: { ...change.after } } : {}),
  };
}

export interface LocalStorageProposalRepositoryOptions {
  storageKey?: string;
}

export class LocalStorageProposalRepository implements ProposalRepository {
  private readonly storageKey: string;
  private readonly fallbackMemory = new Map<string, ProposalChange>();

  constructor(options: LocalStorageProposalRepositoryOptions = {}) {
    this.storageKey = options.storageKey ?? DEFAULT_PROPOSAL_STORAGE_KEY;
    const initial = this.readAllFromStorage();
    for (const change of initial) {
      this.fallbackMemory.set(change.id, cloneProposal(change));
    }
  }

  private readAllFromStorage(): ProposalChange[] {
    const res = readLocalJsonArray<ProposalChange>(this.storageKey, (raw) => {
      const parsed = ProposalChangeSchema.safeParse(raw);
      return parsed.success ? parsed.data : null;
    });
    if (res.ok) {
      return res.items;
    }
    return Array.from(this.fallbackMemory.values()).map(cloneProposal);
  }

  private persistAll(changes: readonly ProposalChange[]): void {
    this.fallbackMemory.clear();
    for (const change of changes) {
      this.fallbackMemory.set(change.id, cloneProposal(change));
    }
    writeLocalJson(this.storageKey, changes);
  }

  async findById(id: string): Promise<ProposalChange | null> {
    const found = this.readAllFromStorage().find((c) => c.id === id);
    return found ? cloneProposal(found) : null;
  }

  async listAll(): Promise<ProposalChange[]> {
    return this.readAllFromStorage().map(cloneProposal);
  }

  async listByProposalId(proposalId: string): Promise<ProposalChange[]> {
    return this.readAllFromStorage()
      .filter((c) => c.proposalId === proposalId)
      .map(cloneProposal);
  }

  async save(change: ProposalChange): Promise<ProposalChange> {
    const stored = cloneProposal(change);
    const all = this.readAllFromStorage();
    const index = all.findIndex((c) => c.id === stored.id);
    if (index >= 0) {
      all[index] = stored;
    } else {
      all.push(stored);
    }
    this.persistAll(all);
    return cloneProposal(stored);
  }

  async saveMany(changes: readonly ProposalChange[]): Promise<ProposalChange[]> {
    if (changes.length === 0) {
      return [];
    }
    const all = this.readAllFromStorage();
    const byId = new Map<string, ProposalChange>(all.map((c) => [c.id, c]));
    const saved: ProposalChange[] = [];
    for (const change of changes) {
      const stored = cloneProposal(change);
      byId.set(stored.id, stored);
      saved.push(cloneProposal(stored));
    }
    this.persistAll(Array.from(byId.values()));
    return saved;
  }

  async clearAll(): Promise<void> {
    this.persistAll([]);
  }
}
