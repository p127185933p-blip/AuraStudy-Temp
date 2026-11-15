import type { TagRepository } from '@/application/services';
import type { CalendarTag } from '@/domain/schedule';
import { CalendarTagSchema } from '@/shared/schemas';
import { LocalStorageTagRepository } from './LocalStorageTagRepository';
import {
  asTableClient,
  type AnySupabaseClient,
  type SupabaseQueryError,
} from './supabaseTypes';

interface UserTagRow {
  id: string;
  user_id: string;
  name: string;
  color: string;
  created_at: string;
}

function isMissingTagsTableError(error: SupabaseQueryError | null): boolean {
  if (!error) return false;
  if (error.code === '42P01' || error.code === 'PGRST205') {
    return true;
  }
  const msg = error.message.toLowerCase();
  return (
    msg.includes('user_tags') &&
    (msg.includes('does not exist') ||
      msg.includes('schema cache') ||
      msg.includes('could not find'))
  );
}

function mapRowToTag(raw: Record<string, unknown>): CalendarTag {
  const row = raw as unknown as UserTagRow;
  return CalendarTagSchema.parse({
    id: row.id,
    userId: row.user_id,
    name: row.name,
    color: row.color,
    createdAt: row.created_at,
  });
}

function mapTagToRow(tag: CalendarTag): Record<string, unknown> {
  return {
    id: tag.id,
    user_id: tag.userId,
    name: tag.name,
    color: tag.color,
    created_at: tag.createdAt,
  };
}

export class SupabaseTagRepository implements TagRepository {
  private tableUnavailable = false;
  private syncQueue: Promise<void> = Promise.resolve();
  private readonly localFallback = new LocalStorageTagRepository({
    storageKey: 'aurastudy.v1.supabaseTagFallback',
  });

  constructor(private readonly client: AnySupabaseClient) {}

  private enqueueSync<T>(task: () => Promise<T>): Promise<T> {
    const run = this.syncQueue.then(task, task);
    this.syncQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async findById(id: string): Promise<CalendarTag | null> {
    if (this.tableUnavailable) {
      return this.localFallback.findById(id);
    }

    const { data, error } = await asTableClient(this.client, 'user_tags')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      if (isMissingTagsTableError(error)) {
        this.tableUnavailable = true;
        return this.localFallback.findById(id);
      }
      throw new Error(`讀取標籤失敗：${error.message}`);
    }

    if (!data) {
      return null;
    }

    return mapRowToTag(data);
  }

  async listByUser(userId: string): Promise<CalendarTag[]> {
    if (this.tableUnavailable) {
      return this.localFallback.listByUser(userId);
    }

    const { data, error } = await asTableClient(this.client, 'user_tags')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });

    if (error) {
      if (isMissingTagsTableError(error)) {
        this.tableUnavailable = true;
        return this.localFallback.listByUser(userId);
      }
      throw new Error(`載入標籤列表失敗：${error.message}`);
    }

    return (data ?? []).map((row) => mapRowToTag(row));
  }

  async save(tag: CalendarTag): Promise<CalendarTag> {
    return this.enqueueSync(async () => {
      if (this.tableUnavailable) {
        return this.localFallback.save(tag);
      }

      const row = mapTagToRow(tag);
      const { data, error } = await asTableClient(this.client, 'user_tags')
        .upsert(row, { onConflict: 'id' })
        .select('*')
        .single();

      if (error) {
        if (isMissingTagsTableError(error)) {
          this.tableUnavailable = true;
          return this.localFallback.save(tag);
        }
        throw new Error(`儲存標籤失敗：${error.message}`);
      }

      if (!data) {
        return { ...tag };
      }

      return mapRowToTag(data);
    });
  }

  async delete(id: string): Promise<boolean> {
    return this.enqueueSync(async () => {
      if (this.tableUnavailable) {
        return this.localFallback.delete(id);
      }

      const { data, error } = await asTableClient(this.client, 'user_tags')
        .delete()
        .eq('id', id)
        .select('id');

      if (error) {
        if (isMissingTagsTableError(error)) {
          this.tableUnavailable = true;
          return this.localFallback.delete(id);
        }
        throw new Error(`刪除標籤失敗：${error.message}`);
      }

      return (data?.length ?? 0) > 0;
    });
  }

  async deleteAllByUser(userId: string): Promise<void> {
    return this.enqueueSync(async () => {
      if (this.tableUnavailable) {
        await this.localFallback.deleteAllByUser(userId);
        return;
      }

      const { error } = await asTableClient(this.client, 'user_tags')
        .delete()
        .eq('user_id', userId);

      if (error) {
        if (isMissingTagsTableError(error)) {
          this.tableUnavailable = true;
          await this.localFallback.deleteAllByUser(userId);
          return;
        }
        throw new Error(`清除雲端標籤失敗：${error.message}`);
      }
    });
  }

  async syncSnapshot(userId: string, tags: readonly CalendarTag[]): Promise<void> {
    return this.enqueueSync(async () => {
      const userTags = tags.filter((tag) => tag.userId === userId);
      const syncLocalFallback = async () => {
        await this.localFallback.deleteAllByUser(userId);
        for (const tag of userTags) {
          await this.localFallback.save(tag);
        }
      };

      if (this.tableUnavailable) {
        await syncLocalFallback();
        return;
      }

      const table = asTableClient(this.client, 'user_tags');
      const { data: existingRows, error: existingError } = await table
        .select('id')
        .eq('user_id', userId);

      if (existingError) {
        if (isMissingTagsTableError(existingError)) {
          this.tableUnavailable = true;
          await syncLocalFallback();
          return;
        }
        throw new Error(`查詢雲端標籤快照失敗：${existingError.message}`);
      }

      const existingIds = (existingRows ?? [])
        .map((row) => String(row.id ?? ''))
        .filter((id) => id.length > 0);

      if (userTags.length === 0) {
        if (existingIds.length > 0) {
          const { error: deleteAllError } = await table
            .delete()
            .eq('user_id', userId);
          if (deleteAllError) {
            if (isMissingTagsTableError(deleteAllError)) {
              this.tableUnavailable = true;
              await syncLocalFallback();
              return;
            }
            throw new Error(`清除雲端過期標籤失敗：${deleteAllError.message}`);
          }
        }
        return;
      }

      const { error: upsertError } = await table.upsert(
        userTags.map((tag) => mapTagToRow(tag)),
        { onConflict: 'id' },
      );

      if (upsertError) {
        if (isMissingTagsTableError(upsertError)) {
          this.tableUnavailable = true;
          await syncLocalFallback();
          return;
        }
        throw new Error(`覆蓋上傳雲端標籤快照失敗：${upsertError.message}`);
      }

      const localIds = new Set(userTags.map((tag) => tag.id));
      const staleIds = existingIds.filter((id) => !localIds.has(id));
      for (const staleId of staleIds) {
        const { error: deleteStaleError } = await table
          .delete()
          .eq('user_id', userId)
          .eq('id', staleId);
        if (deleteStaleError) {
          if (isMissingTagsTableError(deleteStaleError)) {
            this.tableUnavailable = true;
            await syncLocalFallback();
            return;
          }
          throw new Error(`清理雲端已刪除標籤失敗：${deleteStaleError.message}`);
        }
      }
    });
  }
}
