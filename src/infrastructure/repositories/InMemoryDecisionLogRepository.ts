import type { DecisionLogRepository } from '@/application/services';
import type { DecisionLogEntry } from '@/domain/proposals';

export class InMemoryDecisionLogRepository implements DecisionLogRepository {
  private readonly entries: DecisionLogEntry[] = [];

  async append(entry: DecisionLogEntry): Promise<DecisionLogEntry> {
    const copy = { ...entry };
    this.entries.push(copy);
    return { ...copy };
  }

  async listRecent(limit = 50): Promise<DecisionLogEntry[]> {
    return this.entries.slice(-limit).map((e) => ({ ...e }));
  }

  async clearAll(): Promise<void> {
    this.entries.length = 0;
  }
}
