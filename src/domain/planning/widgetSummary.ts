import {
  DomainValidationError,
  isDeadline,
  isSchedule,
  type CalendarItem,
  type Deadline,
  type Schedule,
} from '@/domain/schedule';
import { getDayRange } from './dateRange';
import { isValidIsoDateOnly, isValidIsoDateTimeWithTimezone } from '@/shared/schemas';

export const WIDGET_MAX_TODAY_SCHEDULES = 4;
export const WIDGET_MAX_UPCOMING_DEADLINES = 3;
export const WIDGET_UPCOMING_DEADLINE_DAYS = 7;

export interface WidgetScheduleItem {
  id: string;
  title: string;
  startTimeLabel: string;
  endTimeLabel: string;
  tag?: string;
}

export interface WidgetDeadlineItem {
  id: string;
  title: string;
  dueDateLabel: string;
  tag?: string;
}

export interface WidgetSnapshot {
  dateLabel: string;
  todaySchedules: WidgetScheduleItem[];
  upcomingDeadlines: WidgetDeadlineItem[];
  remainingCount: number;
  updatedAt: string;
}

export interface BuildWidgetSnapshotOptions {
  now?: Date | string;
  timeZone?: string;
}

const FIXED_OFFSET_REGEX = /^(Z|([+-])(\d{2}):(\d{2}))$/;
const ISO_DATE_CAPTURE_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;

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

function getZonedParts(
  utcMs: number,
  timeZone: string,
): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
} {
  const fixedOffset = parseFixedOffsetMinutes(timeZone);
  if (fixedOffset !== null) {
    const shifted = new Date(utcMs + fixedOffset * 60_000);
    return {
      year: shifted.getUTCFullYear(),
      month: shifted.getUTCMonth() + 1,
      day: shifted.getUTCDate(),
      hour: shifted.getUTCHours(),
      minute: shifted.getUTCMinutes(),
    };
  }

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = formatter.formatToParts(new Date(utcMs));
  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value);

  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
  };
}

function formatDateLabel(utcMs: number, timeZone: string): string {
  const parts = getZonedParts(utcMs, timeZone);
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function formatTimeHHmm(utcMs: number, timeZone: string): string {
  const parts = getZonedParts(utcMs, timeZone);
  return `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
}

function resolveReferenceInstant(now?: Date | string): { ms: number; iso: string } {
  if (now === undefined) {
    const current = new Date();
    return { ms: current.getTime(), iso: current.toISOString() };
  }
  if (now instanceof Date) {
    const ms = now.getTime();
    if (!Number.isFinite(ms)) {
      throw new DomainValidationError('Invalid Date passed to buildWidgetSnapshot');
    }
    return { ms, iso: now.toISOString() };
  }
  if (isValidIsoDateOnly(now)) {
    const match = ISO_DATE_CAPTURE_REGEX.exec(now);
    if (!match) {
      throw new DomainValidationError(`Invalid date string: ${now}`);
    }
    const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 0, 0, 0);
    return { ms, iso: new Date(ms).toISOString() };
  }
  if (isValidIsoDateTimeWithTimezone(now)) {
    const ms = Date.parse(now);
    return { ms, iso: now };
  }
  throw new DomainValidationError(`Invalid reference timestamp: ${now}`);
}

function getDeadlineDueMs(deadline: Deadline, timeZone: string): number {
  if (isValidIsoDateOnly(deadline.dueDate)) {
    return getDayRange(deadline.dueDate, { timeZone }).startMs;
  }
  return Date.parse(deadline.dueDate);
}

function formatDeadlineDueLabel(deadline: Deadline, timeZone: string): string {
  if (isValidIsoDateOnly(deadline.dueDate)) {
    return deadline.dueDate;
  }
  const ms = Date.parse(deadline.dueDate);
  return `${formatDateLabel(ms, timeZone)} ${formatTimeHHmm(ms, timeZone)}`;
}

function addCalendarDaysToDateLabel(dateLabel: string, deltaDays: number): string {
  const match = ISO_DATE_CAPTURE_REGEX.exec(dateLabel);
  if (!match) {
    throw new DomainValidationError(`Invalid dateLabel: ${dateLabel}`);
  }
  const next = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + deltaDays),
  );
  return `${String(next.getUTCFullYear()).padStart(4, '0')}-${String(
    next.getUTCMonth() + 1,
  ).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
}

/**
 * Pure domain extractor producing a compact Android Widget snapshot from formal CalendarItem[].
 * - Excludes cancelled schedules and completed deadlines.
 * - Strictly expects committed formal items (never pending AI proposals).
 */
export function buildWidgetSnapshot(
  items: readonly CalendarItem[],
  options: BuildWidgetSnapshotOptions = {},
): WidgetSnapshot {
  const timeZone = options.timeZone ?? 'UTC';
  const reference = resolveReferenceInstant(options.now);

  const todayAnchor =
    typeof options.now === 'string' && isValidIsoDateOnly(options.now)
      ? options.now
      : new Date(reference.ms);
  const todayRange = getDayRange(todayAnchor, { timeZone });
  const dateLabel = todayRange.startAt.slice(0, 10);

  const windowEndDateLabel = addCalendarDaysToDateLabel(
    dateLabel,
    WIDGET_UPCOMING_DEADLINE_DAYS + 1,
  );
  const upcomingWindowEndMs = getDayRange(windowEndDateLabel, { timeZone }).startMs;

  const todayActiveSchedules: Schedule[] = [];
  const upcomingActiveDeadlines: Deadline[] = [];

  for (const item of items) {
    if (isSchedule(item)) {
      if (item.status === 'cancelled') {
        continue;
      }
      const startMs = Date.parse(item.startAt);
      const endMs = Date.parse(item.endAt);
      if (startMs < todayRange.endMs && endMs > todayRange.startMs) {
        todayActiveSchedules.push(item);
      }
      continue;
    }

    if (isDeadline(item)) {
      if (item.status === 'completed') {
        continue;
      }
      const dueMs = getDeadlineDueMs(item, timeZone);
      if (dueMs >= todayRange.startMs && dueMs < upcomingWindowEndMs) {
        upcomingActiveDeadlines.push(item);
      }
    }
  }

  todayActiveSchedules.sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
  upcomingActiveDeadlines.sort(
    (a, b) => getDeadlineDueMs(a, timeZone) - getDeadlineDueMs(b, timeZone),
  );

  const visibleSchedules = todayActiveSchedules.slice(0, WIDGET_MAX_TODAY_SCHEDULES);
  const visibleDeadlines = upcomingActiveDeadlines.slice(0, WIDGET_MAX_UPCOMING_DEADLINES);

  return {
    dateLabel,
    todaySchedules: visibleSchedules.map((schedule) => ({
      id: schedule.id,
      title: schedule.title,
      startTimeLabel: formatTimeHHmm(Date.parse(schedule.startAt), timeZone),
      endTimeLabel: formatTimeHHmm(Date.parse(schedule.endAt), timeZone),
      ...(schedule.tag ? { tag: schedule.tag } : {}),
    })),
    upcomingDeadlines: visibleDeadlines.map((deadline) => ({
      id: deadline.id,
      title: deadline.title,
      dueDateLabel: formatDeadlineDueLabel(deadline, timeZone),
      ...(deadline.tag ? { tag: deadline.tag } : {}),
    })),
    remainingCount: Math.max(0, todayActiveSchedules.length - visibleSchedules.length),
    updatedAt: reference.iso,
  };
}
