import { updateCalendarItem } from '@/application/commands/calendarCommands';
import type { CalendarRepository } from '@/application/services/CalendarRepository';
import type { TagRepository } from '@/application/services/TagRepository';
import { fail, ok, type ApplicationResult } from '@/application/services/types';
import {
  DomainValidationError,
  createTagEntity,
  updateTagEntity,
  type CalendarTag,
  type CreateTagInput,
  type UpdateTagPatch,
} from '@/domain/schedule';

export interface CreateTagCommand extends CreateTagInput {
  now?: string;
}

export interface UpdateTagCommand {
  userId: string;
  tagId: string;
  patch: UpdateTagPatch;
}

export interface DeleteTagCommand {
  userId: string;
  tagId: string;
}

export async function createTag(
  tagRepository: TagRepository,
  command: CreateTagCommand,
): Promise<ApplicationResult<CalendarTag>> {
  const { now, ...input } = command;
  const trimmedName = input.name.trim();
  if (!trimmedName) {
    return fail({
      code: 'VALIDATION_ERROR',
      message: '請輸入標籤名稱',
    });
  }

  const existing = await tagRepository.listByUser(input.userId);
  if (
    existing.some(
      (tag) => tag.name.trim().toLowerCase() === trimmedName.toLowerCase(),
    )
  ) {
    return fail({
      code: 'VALIDATION_ERROR',
      message: `標籤「${trimmedName}」已存在`,
    });
  }

  let entity: CalendarTag;
  try {
    entity = createTagEntity({ ...input, name: trimmedName }, { now });
  } catch (error) {
    if (error instanceof DomainValidationError) {
      return fail({
        code: 'VALIDATION_ERROR',
        message: error.message,
        issues: error.issues,
      });
    }
    throw error;
  }

  const saved = await tagRepository.save(entity);
  return ok(saved);
}

export async function updateTag(
  tagRepository: TagRepository,
  calendarRepository: CalendarRepository,
  command: UpdateTagCommand,
): Promise<ApplicationResult<CalendarTag>> {
  const existing = await tagRepository.findById(command.tagId);
  if (!existing) {
    return fail({
      code: 'NOT_FOUND',
      message: '找不到指定的標籤',
      itemId: command.tagId,
    });
  }
  if (existing.userId !== command.userId) {
    return fail({
      code: 'FORBIDDEN',
      message: '無權修改此標籤',
      itemId: command.tagId,
    });
  }

  if (command.patch.name !== undefined) {
    const trimmed = command.patch.name.trim();
    if (!trimmed) {
      return fail({
        code: 'VALIDATION_ERROR',
        message: '標籤名稱不可為空',
      });
    }
    const allTags = await tagRepository.listByUser(command.userId);
    if (
      allTags.some(
        (t) =>
          t.id !== existing.id &&
          t.name.trim().toLowerCase() === trimmed.toLowerCase(),
      )
    ) {
      return fail({
        code: 'VALIDATION_ERROR',
        message: `標籤「${trimmed}」已存在`,
      });
    }
  }

  let updated: CalendarTag;
  try {
    updated = updateTagEntity(existing, {
      ...(command.patch.name !== undefined ? { name: command.patch.name.trim() } : {}),
      ...(command.patch.color !== undefined ? { color: command.patch.color } : {}),
    });
  } catch (error) {
    if (error instanceof DomainValidationError) {
      return fail({
        code: 'VALIDATION_ERROR',
        message: error.message,
        issues: error.issues,
      });
    }
    throw error;
  }

  const saved = await tagRepository.save(updated);

  if (existing.name !== saved.name) {
    const items = await calendarRepository.listByUser(command.userId);
    for (const item of items) {
      if (item.tag === existing.name) {
        await updateCalendarItem(calendarRepository, {
          userId: command.userId,
          itemId: item.id,
          expectedRevision: item.revision,
          allowConflict: true,
          patch: { tag: saved.name },
        });
      }
    }
  }

  return ok(saved);
}

export async function deleteTag(
  tagRepository: TagRepository,
  calendarRepository: CalendarRepository,
  command: DeleteTagCommand,
): Promise<ApplicationResult<{ deletedId: string; detachedCount: number }>> {
  const existing = await tagRepository.findById(command.tagId);
  if (!existing) {
    return fail({
      code: 'NOT_FOUND',
      message: '找不到指定的標籤',
      itemId: command.tagId,
    });
  }
  if (existing.userId !== command.userId) {
    return fail({
      code: 'FORBIDDEN',
      message: '無權刪除此標籤',
      itemId: command.tagId,
    });
  }

  await tagRepository.delete(existing.id);

  let detachedCount = 0;
  const items = await calendarRepository.listByUser(command.userId);
  for (const item of items) {
    if (item.tag === existing.name) {
      const updateRes = await updateCalendarItem(calendarRepository, {
        userId: command.userId,
        itemId: item.id,
        expectedRevision: item.revision,
        allowConflict: true,
        patch: { tag: null },
      });
      if (updateRes.ok) {
        detachedCount += 1;
      }
    }
  }

  return ok({ deletedId: existing.id, detachedCount });
}
