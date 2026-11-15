import type { ProposalRepository } from '@/application/services';
import type { ProposalChange } from '@/domain/proposals';

function cloneProposal(change: ProposalChange): ProposalChange {
  return {
    ...change,
    ...(change.before ? { before: { ...change.before } } : {}),
    ...(change.after ? { after: { ...change.after } } : {}),
  };
}

export class InMemoryProposalRepository implements ProposalRepository {
  private readonly changes = new Map<string, ProposalChange>();

  constructor(initialChanges: readonly ProposalChange[] = []) {
    for (const change of initialChanges) {
      this.changes.set(change.id, cloneProposal(change));
    }
  }

  async findById(id: string): Promise<ProposalChange | null> {
    const found = this.changes.get(id);
    return found ? cloneProposal(found) : null;
  }

  async listAll(): Promise<ProposalChange[]> {
    return Array.from(this.changes.values()).map(cloneProposal);
  }

  async listByProposalId(proposalId: string): Promise<ProposalChange[]> {
    const result: ProposalChange[] = [];
    for (const change of this.changes.values()) {
      if (change.proposalId === proposalId) {
        result.push(cloneProposal(change));
      }
    }
    return result;
  }

  async save(change: ProposalChange): Promise<ProposalChange> {
    const stored = cloneProposal(change);
    this.changes.set(stored.id, stored);
    return cloneProposal(stored);
  }

  async saveMany(changes: readonly ProposalChange[]): Promise<ProposalChange[]> {
    const saved: ProposalChange[] = [];
    for (const change of changes) {
      saved.push(await this.save(change));
    }
    return saved;
  }

  async clearAll(): Promise<void> {
    this.changes.clear();
  }
}
