import type { ProposalRepository } from '@/application/services';
import type { ProposalChange } from '@/domain/proposals';
import { ProposalChangeSchema } from '@/shared/schemas';
import { asTableClient, type AnySupabaseClient } from './supabaseTypes';

interface ProposalRow {
  id: string;
  proposal_id: string;
  user_id: string;
  target_item_id: string | null;
  action: 'create' | 'update' | 'delete';
  status: 'pending' | 'accepted' | 'rejected' | 'stale' | 'blocked';
  before_snapshot: unknown;
  after_snapshot: unknown;
  base_revision: number | null;
  reason: string | null;
  created_at: string;
  updated_at: string;
}

function mapRowToProposal(raw: Record<string, unknown>): ProposalChange {
  const row = raw as unknown as ProposalRow;
  const candidate = {
    id: row.id,
    proposalId: row.proposal_id,
    action: row.action,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.target_item_id != null ? { targetItemId: row.target_item_id } : {}),
    ...(row.before_snapshot != null ? { before: row.before_snapshot } : {}),
    ...(row.after_snapshot != null ? { after: row.after_snapshot } : {}),
    ...(row.base_revision != null ? { baseRevision: row.base_revision } : {}),
    ...(row.reason != null ? { reason: row.reason } : {}),
  };

  return ProposalChangeSchema.parse(candidate);
}

function mapProposalToRow(
  change: ProposalChange,
  userId: string,
): Record<string, unknown> {
  return {
    id: change.id,
    proposal_id: change.proposalId,
    user_id: userId,
    target_item_id: change.targetItemId ?? null,
    action: change.action,
    status: change.status,
    before_snapshot: change.before ?? null,
    after_snapshot: change.after ?? null,
    base_revision: change.baseRevision ?? null,
    reason: change.reason ?? null,
    created_at: change.createdAt,
    updated_at: change.updatedAt,
  };
}

export class SupabaseProposalRepository implements ProposalRepository {
  constructor(
    private readonly client: AnySupabaseClient,
    private readonly userId: string,
  ) {}

  async findById(id: string): Promise<ProposalChange | null> {
    const { data, error } = await asTableClient(this.client, 'proposal_changes')
      .select('*')
      .eq('id', id)
      .eq('user_id', this.userId)
      .maybeSingle();

    if (error) {
      throw new Error(`讀取提案失敗：${error.message}`);
    }

    if (!data) {
      return null;
    }

    return mapRowToProposal(data as unknown as Record<string, unknown>);
  }

  async listAll(): Promise<ProposalChange[]> {
    const { data, error } = await asTableClient(this.client, 'proposal_changes')
      .select('*')
      .eq('user_id', this.userId)
      .order('created_at', { ascending: true });

    if (error) {
      throw new Error(`載入提案列表失敗：${error.message}`);
    }

    return (data ?? []).map((row) => mapRowToProposal(row));
  }

  async listByProposalId(proposalId: string): Promise<ProposalChange[]> {
    const { data, error } = await asTableClient(this.client, 'proposal_changes')
      .select('*')
      .eq('user_id', this.userId)
      .eq('proposal_id', proposalId)
      .order('created_at', { ascending: true });

    if (error) {
      throw new Error(`查詢提案批次失敗：${error.message}`);
    }

    return (data ?? []).map((row) => mapRowToProposal(row));
  }

  async save(change: ProposalChange): Promise<ProposalChange> {
    const row = mapProposalToRow(change, this.userId);
    const { data, error } = await asTableClient(this.client, 'proposal_changes')
      .upsert(row, { onConflict: 'id' })
      .select('*')
      .single();

    if (error) {
      throw new Error(`儲存提案失敗：${error.message}`);
    }

    if (!data) {
      throw new Error('儲存提案失敗：資料庫未回傳結果。');
    }

    return mapRowToProposal(data as unknown as Record<string, unknown>);
  }

  async saveMany(changes: readonly ProposalChange[]): Promise<ProposalChange[]> {
    if (changes.length === 0) {
      return [];
    }
    const rows = changes.map((c) => mapProposalToRow(c, this.userId));
    const { data, error } = await asTableClient(this.client, 'proposal_changes')
      .upsert(rows, { onConflict: 'id' })
      .select('*');

    if (error) {
      throw new Error(`批次儲存提案失敗：${error.message}`);
    }

    return (data ?? []).map((row) => mapRowToProposal(row));
  }

  async deleteAllByUser(): Promise<void> {
    const { error } = await asTableClient(this.client, 'proposal_changes')
      .delete()
      .eq('user_id', this.userId);

    if (error) {
      throw new Error(`清除雲端提案失敗：${error.message}`);
    }
  }
}
