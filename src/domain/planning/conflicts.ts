import {
  DomainValidationError,
  isSchedule,
  type CalendarItem,
  type Schedule,
} from '@/domain/schedule';
import { IsoDateTimeWithTzSchema } from '@/shared/schemas';

export interface ScheduleTimeWindow {
  startAt: string;
  endAt: string;
}

export interface ConflictDetectionOptions {
  excludeItemId?: string;
}

export interface ScheduleConflictDetail {
  item: Schedule;
  overlapStartAt: string;
  overlapEndAt: string;
}

export interface ScheduleConflictResult {
  hasConflict: boolean;
  conflictingItems: Schedule[];
  conflicts: ScheduleConflictDetail[];
}

function parseValidatedWindow(window: ScheduleTimeWindow): {
  startMs: number;
  endMs: number;
} {
  const startResult = IsoDateTimeWithTzSchema.safeParse(window.startAt);
  const endResult = IsoDateTimeWithTzSchema.safeParse(window.endAt);

  if (!startResult.success || !endResult.success) {
    throw new DomainValidationError(
      'Schedule time window must use valid ISO 8601 datetime strings with timezone',
    );
  }

  const startMs = Date.parse(startResult.data);
  const endMs = Date.parse(endResult.data);

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    throw new DomainValidationError('Schedule time window requires endAt > startAt');
  }

  return { startMs, endMs };
}

/**
 * Pure conflict detection for Schedules using half-open interval overlap:
 * A conflicts with B iff A.startAt < B.endAt && A.endAt > B.startAt.
 * Adjacent intervals (e.g. 09:00-10:00 and 10:00-11:00) do NOT conflict.
 * Deadlines are strictly ignored.
 */
export function detectScheduleConflicts(
  target: ScheduleTimeWindow,
  existingItems: readonly CalendarItem[],
  options: ConflictDetectionOptions = {},
): ScheduleConflictResult {
  const { startMs: targetStartMs, endMs: targetEndMs } = parseValidatedWindow(target);
  const conflicts: ScheduleConflictDetail[] = [];

  for (const existing of existingItems) {
    if (!isSchedule(existing)) {
      continue;
    }

    if (options.excludeItemId !== undefined && existing.id === options.excludeItemId) {
      continue;
    }

    const existingStartMs = Date.parse(existing.startAt);
    const existingEndMs = Date.parse(existing.endAt);

    if (targetStartMs < existingEndMs && targetEndMs > existingStartMs) {
      const overlapStartMs = Math.max(targetStartMs, existingStartMs);
      const overlapEndMs = Math.min(targetEndMs, existingEndMs);

      conflicts.push({
        item: existing,
        overlapStartAt: new Date(overlapStartMs).toISOString(),
        overlapEndAt: new Date(overlapEndMs).toISOString(),
      });
    }
  }

  conflicts.sort((a, b) => Date.parse(a.item.startAt) - Date.parse(b.item.startAt));

  return {
    hasConflict: conflicts.length > 0,
    conflictingItems: conflicts.map((conflict) => conflict.item),
    conflicts,
  };
}
