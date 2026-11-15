import type { DecisionLogEntry, ProposalChange } from '@/domain/proposals';

export interface ProposalRepository {
  findById(id: string): Promise<ProposalChange | null>;
  listAll(): Promise<ProposalChange[]>;
  listByProposalId(proposalId: string): Promise<ProposalChange[]>;
  save(change: ProposalChange): Promise<ProposalChange>;
  saveMany(changes: readonly ProposalChange[]): Promise<ProposalChange[]>;
}

export interface DecisionLogRepository {
  append(entry: DecisionLogEntry): Promise<DecisionLogEntry>;
  listRecent(limit?: number): Promise<DecisionLogEntry[]>;
}
