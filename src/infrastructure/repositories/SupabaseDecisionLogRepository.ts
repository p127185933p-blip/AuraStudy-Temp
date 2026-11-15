import type { DecisionLogRepository } from '@/application/services';
import type { DecisionLogEntry } from '@/domain/proposals';
import { asTableClient, type AnySupabaseClient } from './supabaseTypes';

interface DecisionLogRow {
  id: string;
  user_id: string;
  change_id: string;
  proposal_id: string;
  action: 'create' | 'update' | 'delete';
  decision: 'accepted' | 'rejected';
  target_item_id: string | null;
  summary: string;
  reason: string | null;
  decided_at: string;
}

function mapRowToDecisionLog(raw: Record<string, unknown>): DecisionLogEntry {
  const row = raw as unknown as DecisionLogRow;
  return {
    id: row.id,
    userId: row.user_id,
    changeId: row.change_id,
    proposalId: row.proposal_id,
    action: row.action,
    decision: row.decision,
    ...(row.target_item_id != null ? { targetItemId: row.target_item_id } : {}),
    summary: row.summary,
    ...(row.reason != null ? { reason: row.reason } : {}),
    decidedAt: row.decided_at,
  };
}

export class SupabaseDecisionLogRepository implements DecisionLogRepository {
  constructor(
    private readonly client: AnySupabaseClient,
    private readonly userId: string,
  ) {}

  async append(entry: DecisionLogEntry): Promise<DecisionLogEntry> {
    const row = {
      id: entry.id,
      user_id: this.userId,
      change_id: entry.changeId,
      proposal_id: entry.proposalId,
      action: entry.action,
      decision: entry.decision,
      target_item_id: entry.targetItemId ?? null,
      summary: entry.summary,
      reason: entry.reason ?? null,
      decided_at: entry.decidedAt,
    };

    const { data, error } = await asTableClient(this.client, 'decision_logs')
      .insert(row)
      .select('*')
      .single();

    if (error) {
      throw new Error(`寫入決策紀錄失敗：${error.message}`);
    }

    if (!data) {
      throw new Error('寫入決策紀錄失敗：資料庫未回傳結果。');
    }

    return mapRowToDecisionLog(data as unknown as Record<string, unknown>);
  }

  async listRecent(limit = 50): Promise<DecisionLogEntry[]> {
    const { data, error } = await asTableClient(this.client, 'decision_logs')
      .select('*')
      .eq('user_id', this.userId)
      .order('decided_at', { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(`讀取決策紀錄失敗：${error.message}`);
    }

    return (data ?? []).map((row) => mapRowToDecisionLog(row)).reverse();
  }

  async deleteAllByUser(): Promise<void> {
    const { error } = await asTableClient(this.client, 'decision_logs')
      .delete()
      .eq('user_id', this.userId);

    if (error) {
      throw new Error(`清除雲端決策紀錄失敗：${error.message}`);
    }
  }
}
