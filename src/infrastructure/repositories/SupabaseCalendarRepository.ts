import { z } from 'zod';
import type { CalendarRepository } from '@/application/services';
import { isDeadline, type CalendarItem, type ItemAttachment } from '@/domain/schedule';
import { CalendarItemSchema, ItemAttachmentSchema } from '@/shared/schemas';
import { getSafeLocalStorage } from './localStorageUtils';
import {
  asTableClient,
  RepositoryRevisionConflictError,
  type AnySupabaseClient,
  type SupabaseQueryError,
} from './supabaseTypes';

const ATTACHMENT_FALLBACK_STORAGE_KEY = 'aurastudy.v1.supabaseAttachmentFallback';
const AttachmentsArraySchema = z.array(ItemAttachmentSchema);

interface CalendarItemRow {
  id: string;
  user_id: string;
  type: 'deadline' | 'schedule';
  title: string;
  due_date: string | null;
  start_at: string | null;
  end_at: string | null;
  revision: number;
  description: string | null;
  tag: string | null;
  status: string | null;
  attachments?: unknown;
  created_at: string;
  updated_at: string;
}

function isMissingAttachmentsColumnError(error: SupabaseQueryError | null): boolean {
  if (!error) return false;
  if (error.code === '42703' || error.code === 'PGRST204') {
    return error.message.toLowerCase().includes('attachments') || error.code === '42703';
  }
  const msg = error.message.toLowerCase();
  return (
    msg.includes('attachments') &&
    (msg.includes('column') || msg.includes('schema cache') || msg.includes('does not exist'))
  );
}

function readFallbackAttachmentMap(): Record<string, ItemAttachment[]> {
  const storage = getSafeLocalStorage();
  if (!storage) return {};
  try {
    const raw = storage.getItem(ATTACHMENT_FALLBACK_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    const result: Record<string, ItemAttachment[]> = {};
    for (const [id, list] of Object.entries(parsed)) {
      const valid = AttachmentsArraySchema.safeParse(list);
      if (valid.success && valid.data.length > 0) {
        result[id] = valid.data;
      }
    }
    return result;
  } catch {
    return {};
  }
}

function writeFallbackAttachments(itemId: string, attachments?: readonly ItemAttachment[]): void {
  const storage = getSafeLocalStorage();
  if (!storage) return;
  try {
    const map = readFallbackAttachmentMap();
    if (attachments && attachments.length > 0) {
      map[itemId] = [...attachments];
    } else {
      delete map[itemId];
    }
    storage.setItem(ATTACHMENT_FALLBACK_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore storage errors
  }
}

function clearAllFallbackAttachments(): void {
  const storage = getSafeLocalStorage();
  if (!storage) return;
  try {
    storage.removeItem(ATTACHMENT_FALLBACK_STORAGE_KEY);
  } catch {
    // ignore storage errors
  }
}

function parseRowAttachments(
  rawRow: CalendarItemRow,
  fallbackMap: Record<string, ItemAttachment[]>,
): ItemAttachment[] | undefined {
  if (rawRow.attachments !== undefined && rawRow.attachments !== null) {
    const parsed = AttachmentsArraySchema.safeParse(rawRow.attachments);
    if (parsed.success && parsed.data.length > 0) {
      return parsed.data;
    }
    return undefined;
  }

  const fallback = fallbackMap[rawRow.id];
  return fallback && fallback.length > 0 ? fallback : undefined;
}

function mapRowToCalendarItem(
  raw: Record<string, unknown>,
  fallbackMap: Record<string, ItemAttachment[]>,
): CalendarItem {
  const row = raw as unknown as CalendarItemRow;
  const parsedAttachments = parseRowAttachments(row, fallbackMap);
  const base = {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.description != null ? { description: row.description } : {}),
    ...(row.tag != null ? { tag: row.tag } : {}),
    ...(row.status != null ? { status: row.status } : {}),
    ...(parsedAttachments !== undefined ? { attachments: parsedAttachments } : {}),
  };

  const candidate =
    row.type === 'deadline'
      ? {
          ...base,
          type: 'deadline' as const,
          dueDate: row.due_date ?? '',
        }
      : {
          ...base,
          type: 'schedule' as const,
          startAt: row.start_at ?? '',
          endAt: row.end_at ?? '',
        };

  return CalendarItemSchema.parse(candidate);
}

function mapCalendarItemToRow(
  item: CalendarItem,
  includeAttachments: boolean,
): Record<string, unknown> {
  const base = {
    id: item.id,
    user_id: item.userId,
    title: item.title,
    revision: item.revision,
    description: item.description ?? null,
    tag: item.tag ?? null,
    status: item.status ?? null,
    created_at: item.createdAt,
    updated_at: item.updatedAt,
    ...(includeAttachments ? { attachments: item.attachments ?? [] } : {}),
  };

  if (isDeadline(item)) {
    return {
      ...base,
      type: 'deadline',
      due_date: item.dueDate,
      start_at: null,
      end_at: null,
    };
  }

  return {
    ...base,
    type: 'schedule',
    due_date: null,
    start_at: item.startAt,
    end_at: item.endAt,
  };
}

export class SupabaseCalendarRepository implements CalendarRepository {
  private attachmentsColumnAvailable = true;
  private syncQueue: Promise<void> = Promise.resolve();

  constructor(private readonly client: AnySupabaseClient) {}

  private enqueueSync<T>(task: () => Promise<T>): Promise<T> {
    const run = this.syncQueue.then(task, task);
    this.syncQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async findById(id: string): Promise<CalendarItem | null> {
    const { data, error } = await asTableClient(this.client, 'calendar_items')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw new Error(`讀取行程失敗：${error.message}`);
    }

    if (!data) {
      return null;
    }

    return mapRowToCalendarItem(
      data as unknown as Record<string, unknown>,
      readFallbackAttachmentMap(),
    );
  }

  async listByUser(userId: string): Promise<CalendarItem[]> {
    const { data, error } = await asTableClient(this.client, 'calendar_items')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });

    if (error) {
      throw new Error(`載入行程列表失敗：${error.message}`);
    }

    const fallbackMap = readFallbackAttachmentMap();
    return (data ?? []).map((row) => mapRowToCalendarItem(row, fallbackMap));
  }

  async save(item: CalendarItem): Promise<CalendarItem> {
    return this.enqueueSync(async () => {
      const table = asTableClient(this.client, 'calendar_items');

      if (item.revision === 1) {
        const rowWithAttachments = mapCalendarItemToRow(
          item,
          this.attachmentsColumnAvailable,
        );
        let { data, error } = await table.insert(rowWithAttachments).select('*').single();

        if (error && this.attachmentsColumnAvailable && isMissingAttachmentsColumnError(error)) {
          this.attachmentsColumnAvailable = false;
          const rowWithoutAttachments = mapCalendarItemToRow(item, false);
          const retry = await table.insert(rowWithoutAttachments).select('*').single();
          data = retry.data;
          error = retry.error;
        }

        if (error) {
          throw new Error(`建立行程失敗：${error.message}`);
        }
        if (!data) {
          throw new Error('建立行程失敗：資料庫未回傳儲存結果。');
        }

        if (!this.attachmentsColumnAvailable) {
          writeFallbackAttachments(item.id, item.attachments);
        }

        return mapRowToCalendarItem(
          data as unknown as Record<string, unknown>,
          readFallbackAttachmentMap(),
        );
      }

      const expectedPreviousRevision = item.revision - 1;
      const buildUpdatePayload = (includeAttachments: boolean): Record<string, unknown> => {
        const row = mapCalendarItemToRow(item, includeAttachments);
        return {
          title: row.title,
          due_date: row.due_date,
          start_at: row.start_at,
          end_at: row.end_at,
          revision: row.revision,
          description: row.description,
          tag: row.tag,
          status: row.status,
          updated_at: row.updated_at,
          ...(includeAttachments ? { attachments: row.attachments } : {}),
        };
      };

      let { data, error } = await table
        .update(buildUpdatePayload(this.attachmentsColumnAvailable))
        .eq('id', item.id)
        .eq('user_id', item.userId)
        .eq('revision', expectedPreviousRevision)
        .select('*')
        .maybeSingle();

      if (error && this.attachmentsColumnAvailable && isMissingAttachmentsColumnError(error)) {
        this.attachmentsColumnAvailable = false;
        const retry = await table
          .update(buildUpdatePayload(false))
          .eq('id', item.id)
          .eq('user_id', item.userId)
          .eq('revision', expectedPreviousRevision)
          .select('*')
          .maybeSingle();
        data = retry.data;
        error = retry.error;
      }

      if (error) {
        throw new Error(`更新行程失敗：${error.message}`);
      }

      if (!data) {
        throw new RepositoryRevisionConflictError(
          `樂觀鎖衝突：行程「${item.id}」版本已過期（預期版本 ${expectedPreviousRevision}），請重新整理後再試。`,
        );
      }

      if (!this.attachmentsColumnAvailable) {
        writeFallbackAttachments(item.id, item.attachments);
      }

      return mapRowToCalendarItem(
        data as unknown as Record<string, unknown>,
        readFallbackAttachmentMap(),
      );
    });
  }

  async delete(id: string): Promise<boolean> {
    return this.enqueueSync(async () => {
      const { data, error } = await asTableClient(this.client, 'calendar_items')
        .delete()
        .eq('id', id)
        .select('id');

      if (error) {
        throw new Error(`刪除行程失敗：${error.message}`);
      }

      writeFallbackAttachments(id, undefined);
      return (data?.length ?? 0) > 0;
    });
  }

  async deleteAllByUser(userId: string): Promise<void> {
    return this.enqueueSync(async () => {
      const { error } = await asTableClient(this.client, 'calendar_items')
        .delete()
        .eq('user_id', userId);

      if (error) {
        throw new Error(`清除雲端行程失敗：${error.message}`);
      }
      clearAllFallbackAttachments();
    });
  }

  async syncSnapshot(userId: string, items: readonly CalendarItem[]): Promise<void> {
    return this.enqueueSync(async () => {
      const table = asTableClient(this.client, 'calendar_items');
      const userItems = items.filter((item) => item.userId === userId);

      const { data: existingRows, error: existingError } = await table
        .select('id')
        .eq('user_id', userId);

      if (existingError) {
        throw new Error(`查詢雲端行程快照失敗：${existingError.message}`);
      }

      const existingIds = (existingRows ?? [])
        .map((row) => String(row.id ?? ''))
        .filter((id) => id.length > 0);

      if (userItems.length === 0) {
        if (existingIds.length > 0) {
          const { error: deleteAllError } = await table
            .delete()
            .eq('user_id', userId);
          if (deleteAllError) {
            throw new Error(`清除雲端過期行程快照失敗：${deleteAllError.message}`);
          }
        }
        for (const staleId of existingIds) {
          writeFallbackAttachments(staleId, undefined);
        }
        return;
      }

      const buildUpsertRows = (includeAttachments: boolean): Record<string, unknown>[] =>
        userItems.map((item) => mapCalendarItemToRow(item, includeAttachments));

      let { error: upsertError } = await table.upsert(
        buildUpsertRows(this.attachmentsColumnAvailable),
        { onConflict: 'id' },
      );

      if (
        upsertError &&
        this.attachmentsColumnAvailable &&
        isMissingAttachmentsColumnError(upsertError)
      ) {
        this.attachmentsColumnAvailable = false;
        const retry = await table.upsert(buildUpsertRows(false), {
          onConflict: 'id',
        });
        upsertError = retry.error;
      }

      if (upsertError) {
        throw new Error(`覆蓋上傳雲端行程快照失敗：${upsertError.message}`);
      }

      if (!this.attachmentsColumnAvailable) {
        for (const item of userItems) {
          writeFallbackAttachments(item.id, item.attachments);
        }
      }

      const localIds = new Set(userItems.map((item) => item.id));
      const staleIds = existingIds.filter((id) => !localIds.has(id));

      for (const staleId of staleIds) {
        const { error: deleteStaleError } = await table
          .delete()
          .eq('user_id', userId)
          .eq('id', staleId);

        if (deleteStaleError) {
          throw new Error(`清理雲端已刪除行程失敗：${deleteStaleError.message}`);
        }
        writeFallbackAttachments(staleId, undefined);
      }
    });
  }
}
