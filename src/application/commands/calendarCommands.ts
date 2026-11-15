import { detectScheduleConflicts } from '@/domain/planning';
import {
  DomainValidationError,
  createDeadline as createDeadlineEntity,
  createSchedule as createScheduleEntity,
  isDeadline,
  isItemPast,
  updateDeadline as updateDeadlineEntity,
  updateSchedule as updateScheduleEntity,
  type CalendarItem,
  type CreateDeadlineInput,
  type CreateScheduleInput,
  type Deadline,
  type Schedule,
  type UpdateDeadlinePatch,
  type UpdateSchedulePatch,
} from '@/domain/schedule';
import type { CalendarRepository } from '@/application/services/CalendarRepository';
import { fail, ok, type ApplicationResult } from '@/application/services/types';
import { getBrowserTimeZone, getDateKeyFromInstant } from '@/shared/utils';

export const PAST_TIME_BUFFER_MS = 2 * 60 * 1000;
export const PAST_SCHEDULE_ERROR_MESSAGE = '無法在過去的時間設定行程';
export const PAST_DEADLINE_ERROR_MESSAGE = '截止日期不可設為過去的時間';

export interface CreateDeadlineCommand extends CreateDeadlineInput {
  allowPastTime?: boolean;
  now?: string;
  referenceNow?: Date;
  timeZone?: string;
}

export interface CreateScheduleCommand extends CreateScheduleInput {
  allowConflict?: boolean;
  allowPastTime?: boolean;
  now?: string;
  referenceNow?: Date;
  timeZone?: string;
}

export interface UpdateCalendarItemCommand {
  userId: string;
  itemId: string;
  expectedRevision: number;
  patch: UpdateDeadlinePatch | UpdateSchedulePatch;
  allowConflict?: boolean;
  now?: string;
  referenceNow?: Date;
  timeZone?: string;
}

export interface DeleteCalendarItemCommand {
  userId: string;
  itemId: string;
  expectedRevision: number;
}

export interface DeleteCalendarItemResult {
  deletedId: string;
  revision: number;
}

export interface ClearPastCalendarItemsCommand {
  userId: string;
  referenceNow?: Date;
  timeZone?: string;
}

export interface ClearPastCalendarItemsResult {
  deletedCount: number;
  deletedIds: string[];
  remainingItems: CalendarItem[];
}

function resolveReferenceDate(referenceNow?: Date, now?: string): Date {
  if (referenceNow instanceof Date && Number.isFinite(referenceNow.getTime())) {
    return referenceNow;
  }
  if (typeof now === 'string') {
    const parsed = Date.parse(now);
    if (Number.isFinite(parsed)) {
      return new Date(parsed);
    }
  }
  return new Date();
}

function resolveTimeZone(timeZone?: string): string {
  return timeZone?.trim() || getBrowserTimeZone();
}

function isDeadlineDueInPast(
  dueDate: string,
  referenceDate: Date,
  timeZone: string,
): boolean {
  const dueDateKey = getDateKeyFromInstant(dueDate, timeZone);
  const todayKey = getDateKeyFromInstant(referenceDate, timeZone);
  return dueDateKey < todayKey;
}

function isScheduleTimeInPast(isoInstant: string, referenceDate: Date): boolean {
  return Date.parse(isoInstant) < referenceDate.getTime() - PAST_TIME_BUFFER_MS;
}

function toValidationError(error: unknown): ApplicationResult<never> {
  if (error instanceof DomainValidationError) {
    return fail({
      code: 'VALIDATION_ERROR',
      message: error.message,
      issues: error.issues,
    });
  }
  throw error;
}

export async function createDeadline(
  repository: CalendarRepository,
  command: CreateDeadlineCommand,
): Promise<ApplicationResult<Deadline>> {
  const { allowPastTime = false, now, referenceNow, timeZone, ...input } = command;

  let deadline: Deadline;
  try {
    deadline = createDeadlineEntity(input, { now });
  } catch (error) {
    return toValidationError(error);
  }

  if (!allowPastTime) {
    const refDate = resolveReferenceDate(referenceNow, now);
    const tz = resolveTimeZone(timeZone);
    if (isDeadlineDueInPast(deadline.dueDate, refDate, tz)) {
      return fail({
        code: 'PAST_TIME_NOT_ALLOWED',
        message: PAST_DEADLINE_ERROR_MESSAGE,
      });
    }
  }

  const saved = await repository.save(deadline);
  return ok(saved as Deadline);
}

export async function createSchedule(
  repository: CalendarRepository,
  command: CreateScheduleCommand,
): Promise<ApplicationResult<Schedule>> {
  const {
    allowConflict = false,
    allowPastTime = false,
    now,
    referenceNow,
    timeZone: _tz,
    ...input
  } = command;

  let schedule: Schedule;
  try {
    schedule = createScheduleEntity(input, { now });
  } catch (error) {
    return toValidationError(error);
  }

  if (!allowPastTime) {
    const refDate = resolveReferenceDate(referenceNow, now);
    if (isScheduleTimeInPast(schedule.startAt, refDate)) {
      return fail({
        code: 'PAST_TIME_NOT_ALLOWED',
        message: PAST_SCHEDULE_ERROR_MESSAGE,
      });
    }
  }

  const existingItems = await repository.listByUser(schedule.userId);
  const conflictResult = detectScheduleConflicts(
    { startAt: schedule.startAt, endAt: schedule.endAt },
    existingItems,
  );

  if (conflictResult.hasConflict && !allowConflict) {
    return fail({
      code: 'TIME_CONFLICT',
      message: 'Schedule conflicts with one or more existing schedules',
      conflicts: conflictResult.conflicts,
      conflictingItems: conflictResult.conflictingItems,
    });
  }

  const saved = await repository.save(schedule);
  return ok(saved as Schedule);
}

export async function updateCalendarItem(
  repository: CalendarRepository,
  command: UpdateCalendarItemCommand,
): Promise<ApplicationResult<CalendarItem>> {
  if (!Number.isInteger(command.expectedRevision) || command.expectedRevision <= 0) {
    return fail({
      code: 'VALIDATION_ERROR',
      message: 'expectedRevision must be a positive integer',
    });
  }

  const existing = await repository.findById(command.itemId);
  if (!existing) {
    return fail({
      code: 'NOT_FOUND',
      message: `Calendar item "${command.itemId}" was not found`,
      itemId: command.itemId,
    });
  }

  if (existing.userId !== command.userId) {
    return fail({
      code: 'FORBIDDEN',
      message: `User "${command.userId}" is not allowed to modify item "${command.itemId}"`,
      itemId: command.itemId,
    });
  }

  if (existing.revision !== command.expectedRevision) {
    return fail({
      code: 'REVISION_CONFLICT',
      message: `Revision mismatch for item "${command.itemId}": expected ${command.expectedRevision}, actual ${existing.revision}`,
      itemId: command.itemId,
      expectedRevision: command.expectedRevision,
      actualRevision: existing.revision,
    });
  }

  const refDate = resolveReferenceDate(command.referenceNow, command.now);
  const tz = resolveTimeZone(command.timeZone);

  try {
    if (isDeadline(existing)) {
      const patch = command.patch as UpdateDeadlinePatch;
      let updated: Deadline;
      try {
        updated = updateDeadlineEntity(existing, patch, { now: command.now });
      } catch (error) {
        return toValidationError(error);
      }

      const dueDateChanged =
        patch.dueDate !== undefined && patch.dueDate !== existing.dueDate;
      if (dueDateChanged && isDeadlineDueInPast(updated.dueDate, refDate, tz)) {
        return fail({
          code: 'PAST_TIME_NOT_ALLOWED',
          message: PAST_DEADLINE_ERROR_MESSAGE,
        });
      }

      const saved = await repository.save(updated);
      return ok(saved);
    }

    const patch = command.patch as UpdateSchedulePatch;
    let updated: Schedule;
    try {
      updated = updateScheduleEntity(existing, patch, { now: command.now });
    } catch (error) {
      return toValidationError(error);
    }

    const startChanged =
      patch.startAt !== undefined &&
      Date.parse(patch.startAt) !== Date.parse(existing.startAt);
    const endChanged =
      patch.endAt !== undefined &&
      Date.parse(patch.endAt) !== Date.parse(existing.endAt);

    if (
      (startChanged && isScheduleTimeInPast(updated.startAt, refDate)) ||
      (endChanged && isScheduleTimeInPast(updated.endAt, refDate))
    ) {
      return fail({
        code: 'PAST_TIME_NOT_ALLOWED',
        message: PAST_SCHEDULE_ERROR_MESSAGE,
      });
    }

    const existingItems = await repository.listByUser(command.userId);
    const conflictResult = detectScheduleConflicts(
      { startAt: updated.startAt, endAt: updated.endAt },
      existingItems,
      { excludeItemId: existing.id },
    );

    if (conflictResult.hasConflict && !command.allowConflict) {
      return fail({
        code: 'TIME_CONFLICT',
        message: 'Updated schedule conflicts with one or more existing schedules',
        conflicts: conflictResult.conflicts,
        conflictingItems: conflictResult.conflictingItems,
      });
    }

    const saved = await repository.save(updated);
    return ok(saved);
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === 'REVISION_CONFLICT'
    ) {
      return fail({
        code: 'REVISION_CONFLICT',
        message:
          error instanceof Error
            ? error.message
            : `Revision conflict for item "${command.itemId}"`,
        itemId: command.itemId,
        expectedRevision: command.expectedRevision,
        actualRevision: existing.revision + 1,
      });
    }
    throw error;
  }
}

export async function deleteCalendarItem(
  repository: CalendarRepository,
  command: DeleteCalendarItemCommand,
): Promise<ApplicationResult<DeleteCalendarItemResult>> {
  if (!Number.isInteger(command.expectedRevision) || command.expectedRevision <= 0) {
    return fail({
      code: 'VALIDATION_ERROR',
      message: 'expectedRevision must be a positive integer',
    });
  }

  const existing = await repository.findById(command.itemId);
  if (!existing) {
    return fail({
      code: 'NOT_FOUND',
      message: `Calendar item "${command.itemId}" was not found`,
      itemId: command.itemId,
    });
  }

  if (existing.userId !== command.userId) {
    return fail({
      code: 'FORBIDDEN',
      message: `User "${command.userId}" is not allowed to delete item "${command.itemId}"`,
      itemId: command.itemId,
    });
  }

  if (existing.revision !== command.expectedRevision) {
    return fail({
      code: 'REVISION_CONFLICT',
      message: `Revision mismatch for item "${command.itemId}": expected ${command.expectedRevision}, actual ${existing.revision}`,
      itemId: command.itemId,
      expectedRevision: command.expectedRevision,
      actualRevision: existing.revision,
    });
  }

  await repository.delete(command.itemId);
  return ok({
    deletedId: command.itemId,
    revision: existing.revision,
  });
}

export async function clearPastCalendarItems(
  repository: CalendarRepository,
  command: ClearPastCalendarItemsCommand,
): Promise<ApplicationResult<ClearPastCalendarItemsResult>> {
  const refDate = resolveReferenceDate(command.referenceNow);
  const tz = resolveTimeZone(command.timeZone);
  const existingItems = await repository.listByUser(command.userId);
  const pastItems = existingItems.filter((item) => isItemPast(item, refDate, tz));
  const remainingItems = existingItems.filter((item) => !isItemPast(item, refDate, tz));

  const deletedIds: string[] = [];
  for (const item of pastItems) {
    const deleted = await repository.delete(item.id);
    if (deleted) {
      deletedIds.push(item.id);
    }
  }

  return ok({
    deletedCount: deletedIds.length,
    deletedIds,
    remainingItems,
  });
}
