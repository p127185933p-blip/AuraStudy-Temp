import { z } from 'zod';
import {
  createDeadline,
  createSchedule,
} from '@/application/commands/calendarCommands';
import { createTag } from '@/application/commands/tagCommands';
import type { CalendarRepository } from '@/application/services/CalendarRepository';
import type { TagRepository } from '@/application/services/TagRepository';
import { isDeadline, type CalendarItem, type CalendarTag } from '@/domain/schedule';
import {
  CalendarItemSchema,
  CalendarTagSchema,
  IsoDateTimeWithTzSchema,
} from '@/shared/schemas';

export const AuraStudyBackupSchema = z.strictObject({
  version: z.literal(1),
  exportedAt: IsoDateTimeWithTzSchema,
  items: z.array(CalendarItemSchema),
  tags: z.array(CalendarTagSchema).optional(),
});

export type AuraStudyBackup = z.infer<typeof AuraStudyBackupSchema>;

export interface ImportBackupSummary {
  importedCount: number;
  deadlinesCount: number;
  schedulesCount: number;
  tagsCount: number;
  items: CalendarItem[];
  tags: CalendarTag[];
}

export type BackupResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: {
        code: 'BACKUP_VALIDATION_ERROR' | 'BACKUP_IMPORT_ERROR';
        message: string;
        issues?: readonly string[];
      };
    };

export async function exportUserBackup(
  repository: CalendarRepository,
  userId: string,
  now?: string,
  tagRepository?: TagRepository,
): Promise<AuraStudyBackup> {
  const exportedAt = now ?? new Date().toISOString();
  const parsedTime = IsoDateTimeWithTzSchema.safeParse(exportedAt);
  const safeExportedAt = parsedTime.success
    ? parsedTime.data
    : new Date().toISOString();

  const [items, tags] = await Promise.all([
    repository.listByUser(userId),
    tagRepository ? tagRepository.listByUser(userId) : Promise.resolve(undefined),
  ]);

  return {
    version: 1,
    exportedAt: safeExportedAt,
    items,
    ...(tags !== undefined ? { tags } : {}),
  };
}

export async function importUserBackup(
  repository: CalendarRepository,
  userId: string,
  rawInput: unknown,
  now?: string,
  tagRepository?: TagRepository,
): Promise<BackupResult<ImportBackupSummary>> {
  let parsedPayload: unknown = rawInput;

  if (typeof rawInput === 'string') {
    const trimmed = rawInput.trim();
    if (!trimmed) {
      return {
        ok: false,
        error: {
          code: 'BACKUP_VALIDATION_ERROR',
          message: '備份檔案內容為空，無法還原。',
        },
      };
    }

    try {
      parsedPayload = JSON.parse(trimmed);
    } catch {
      return {
        ok: false,
        error: {
          code: 'BACKUP_VALIDATION_ERROR',
          message: '備份檔案不是有效的 JSON 格式，已安全拒絕匯入。',
        },
      };
    }
  }

  const validation = AuraStudyBackupSchema.safeParse(parsedPayload);
  if (!validation.success) {
    const issues = validation.error.issues.map((issue) => {
      const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
      return `${path}${issue.message}`;
    });
    return {
      ok: false,
      error: {
        code: 'BACKUP_VALIDATION_ERROR',
        message: `備份檔案格式驗證失敗（${issues.slice(0, 3).join('; ')}），已安全拒絕匯入。`,
        issues,
      },
    };
  }

  const importedItems: CalendarItem[] = [];
  const importedTags: CalendarTag[] = [];
  let deadlinesCount = 0;
  let schedulesCount = 0;

  if (tagRepository && validation.data.tags) {
    for (const tag of validation.data.tags) {
      const tagRes = await createTag(tagRepository, {
        userId,
        name: tag.name,
        color: tag.color,
        now,
      });
      if (tagRes.ok) {
        importedTags.push(tagRes.data);
      }
    }
  }

  for (const item of validation.data.items) {
    if (isDeadline(item)) {
      const res = await createDeadline(repository, {
        userId,
        title: item.title,
        dueDate: item.dueDate,
        description: item.description,
        tag: item.tag,
        status: item.status,
        attachments: item.attachments,
        allowPastTime: true,
        now,
      });
      if (!res.ok) {
        return {
          ok: false,
          error: {
            code: 'BACKUP_IMPORT_ERROR',
            message: `匯入截止事項「${item.title}」失敗：${res.error.message}`,
          },
        };
      }
      importedItems.push(res.data);
      deadlinesCount += 1;
    } else {
      const res = await createSchedule(repository, {
        userId,
        title: item.title,
        startAt: item.startAt,
        endAt: item.endAt,
        description: item.description,
        tag: item.tag,
        status: item.status,
        attachments: item.attachments,
        allowConflict: true,
        allowPastTime: true,
        now,
      });
      if (!res.ok) {
        return {
          ok: false,
          error: {
            code: 'BACKUP_IMPORT_ERROR',
            message: `匯入排程「${item.title}」失敗：${res.error.message}`,
          },
        };
      }
      importedItems.push(res.data);
      schedulesCount += 1;
    }
  }

  return {
    ok: true,
    data: {
      importedCount: importedItems.length,
      deadlinesCount,
      schedulesCount,
      tagsCount: importedTags.length,
      items: importedItems,
      tags: importedTags,
    },
  };
}
