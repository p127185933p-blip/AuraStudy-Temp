import {
  DomainValidationError,
  isSchedule,
  type CalendarItem,
  type Schedule,
} from '@/domain/schedule';
import { isValidIsoDateTimeWithTimezone } from '@/shared/schemas';

export const NOTIFICATION_BEFORE_START_MINUTES = 20;
export const NOTIFICATION_BEFORE_START_MS = NOTIFICATION_BEFORE_START_MINUTES * 60_000;

export type ScheduleNotificationEventType = 'before_start' | 'at_end';

export interface ScheduledNotificationEvent {
  id: string;
  dedupeKey: string;
  scheduleId: string;
  type: ScheduleNotificationEventType;
  triggerAt: string;
  triggerAtMs: number;
  title: string;
  body: string;
}

export interface ComputeScheduleNotificationsOptions {
  now?: Date | string;
  timeZone?: string;
  endGraceWindowMs?: number;
}

const FIXED_OFFSET_REGEX = /^(Z|([+-])(\d{2}):(\d{2}))$/;

function parseFixedOffsetMinutes(timeZone: string): number | null {
  if (timeZone === 'UTC' || timeZone === 'Z') {
    return 0;
  }
  const match = FIXED_OFFSET_REGEX.exec(timeZone);
  if (!match) {
    return null;
  }
  const sign = match[2] === '-' ? -1 : 1;
  return sign * (Number(match[3]) * 60 + Number(match[4]));
}

function formatTimeHHmm(utcMs: number, timeZone: string): string {
  const fixedOffset = parseFixedOffsetMinutes(timeZone);
  if (fixedOffset !== null) {
    const shifted = new Date(utcMs + fixedOffset * 60_000);
    return `${String(shifted.getUTCHours()).padStart(2, '0')}:${String(
      shifted.getUTCMinutes(),
    ).padStart(2, '0')}`;
  }

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = formatter.formatToParts(new Date(utcMs));
  const hour = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
}

function resolveNowMs(now?: Date | string): number {
  if (now === undefined) {
    return Date.now();
  }
  if (now instanceof Date) {
    const ms = now.getTime();
    if (!Number.isFinite(ms)) {
      throw new DomainValidationError('Invalid Date passed to computeUpcomingScheduleNotifications');
    }
    return ms;
  }
  if (isValidIsoDateTimeWithTimezone(now)) {
    return Date.parse(now);
  }
  throw new DomainValidationError(`Invalid reference timestamp: ${now}`);
}

function findNextScheduleAfter(
  endedSchedule: Schedule,
  sortedActiveSchedules: readonly Schedule[],
): Schedule | null {
  const endedMs = Date.parse(endedSchedule.endAt);
  for (const candidate of sortedActiveSchedules) {
    if (candidate.id === endedSchedule.id) {
      continue;
    }
    const candidateStartMs = Date.parse(candidate.startAt);
    if (candidateStartMs >= endedMs) {
      return candidate;
    }
  }
  return null;
}

/**
 * Pure domain scheduler computing upcoming notification events for active (non-cancelled) Schedules:
 * 1. Event A (before_start): 20 minutes before startAt (or immediately if 0 < startAt - now <= 20m).
 * 2. Event B (at_end): at endAt, showing only the next schedule's title (without time) or empty state.
 */
export function computeUpcomingScheduleNotifications(
  items: readonly CalendarItem[],
  options: ComputeScheduleNotificationsOptions = {},
): ScheduledNotificationEvent[] {
  const timeZone = options.timeZone ?? 'UTC';
  const nowMs = resolveNowMs(options.now);
  const endGraceWindowMs = Math.max(0, options.endGraceWindowMs ?? 0);

  const activeSchedules = items
    .filter((item): item is Schedule => isSchedule(item) && item.status !== 'cancelled')
    .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));

  const events: ScheduledNotificationEvent[] = [];

  for (const schedule of activeSchedules) {
    const startMs = Date.parse(schedule.startAt);
    const endMs = Date.parse(schedule.endAt);
    const startLabel = formatTimeHHmm(startMs, timeZone);
    const endLabel = formatTimeHHmm(endMs, timeZone);

    // Event A: 20 minutes before startAt (or immediately if within [0, 20m) before start)
    if (startMs > nowMs) {
      const scheduledTriggerMs = startMs - NOTIFICATION_BEFORE_START_MS;
      const effectiveTriggerMs = Math.max(nowMs, scheduledTriggerMs);
      const dedupeKey = `${schedule.id}:before_start:${schedule.startAt}`;
      events.push({
        id: dedupeKey,
        dedupeKey,
        scheduleId: schedule.id,
        type: 'before_start',
        triggerAt: new Date(effectiveTriggerMs).toISOString(),
        triggerAtMs: effectiveTriggerMs,
        title: `即將開始：${schedule.title}`,
        body: `執行時段：${startLabel} – ${endLabel}`,
      });
    }

    // Event B: at endAt
    if (endMs >= nowMs - endGraceWindowMs) {
      const effectiveTriggerMs = Math.max(nowMs, endMs);
      const nextSchedule = findNextScheduleAfter(schedule, activeSchedules);
      const dedupeKey = `${schedule.id}:at_end:${schedule.endAt}`;
      events.push({
        id: dedupeKey,
        dedupeKey,
        scheduleId: schedule.id,
        type: 'at_end',
        triggerAt: new Date(effectiveTriggerMs).toISOString(),
        triggerAtMs: effectiveTriggerMs,
        title: '行程時間到了',
        body: nextSchedule
          ? `下一個行程：${nextSchedule.title}`
          : '目前沒有下一個行程',
      });
    }
  }

  events.sort((a, b) => a.triggerAtMs - b.triggerAtMs);
  return events;
}
