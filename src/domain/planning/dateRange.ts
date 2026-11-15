import {
  DomainValidationError,
  isDeadline,
  isSchedule,
  type CalendarItem,
  type Deadline,
  type Schedule,
} from '@/domain/schedule';
import { isValidIsoDateOnly, isValidIsoDateTimeWithTimezone } from '@/shared/schemas';

export type DateRangeMode = 'day' | 'week' | 'month';
export type WeekStartsOn = 0 | 1;

export interface CalendarDateParts {
  year: number;
  month: number;
  day: number;
}

export type DateAnchor = Date | string | CalendarDateParts;

export interface DateRangeOptions {
  timeZone?: string;
  weekStartsOn?: WeekStartsOn;
}

export interface DateRange {
  mode: DateRangeMode;
  timeZone: string;
  startAt: string;
  endAt: string;
  startMs: number;
  endMs: number;
}

export interface FilteredDateRangeItems {
  schedules: Schedule[];
  deadlines: Deadline[];
  items: CalendarItem[];
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
  const hours = Number(match[3]);
  const minutes = Number(match[4]);
  if (hours > 23 || minutes > 59) {
    throw new DomainValidationError(`Invalid UTC offset timezone: ${timeZone}`);
  }
  return sign * (hours * 60 + minutes);
}

function assertValidTimeZone(timeZone: string): void {
  if (parseFixedOffsetMinutes(timeZone) !== null) {
    return;
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date(0));
  } catch {
    throw new DomainValidationError(`Unsupported timezone: ${timeZone}`);
  }
}

function getDatePartsInTimeZone(utcMs: number, timeZone: string): CalendarDateParts {
  const fixedOffset = parseFixedOffsetMinutes(timeZone);
  if (fixedOffset !== null) {
    const shifted = new Date(utcMs + fixedOffset * 60_000);
    return {
      year: shifted.getUTCFullYear(),
      month: shifted.getUTCMonth() + 1,
      day: shifted.getUTCDate(),
    };
  }

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(new Date(utcMs));
  const year = Number(parts.find((p) => p.type === 'year')?.value);
  const month = Number(parts.find((p) => p.type === 'month')?.value);
  const day = Number(parts.find((p) => p.type === 'day')?.value);
  return { year, month, day };
}

function getTimeZonePartsAtInstant(
  utcMs: number,
  timeZone: string,
): CalendarDateParts & { hour: number; minute: number; second: number } {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
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
    second: read('second'),
  };
}

function formatOffset(offsetMinutes: number): string {
  if (offsetMinutes === 0) {
    return 'Z';
  }
  const sign = offsetMinutes > 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  const hours = String(Math.floor(abs / 60)).padStart(2, '0');
  const minutes = String(abs % 60).padStart(2, '0');
  return `${sign}${hours}:${minutes}`;
}

function getLocalMidnightMs(parts: CalendarDateParts, timeZone: string): number {
  const fixedOffset = parseFixedOffsetMinutes(timeZone);
  if (fixedOffset !== null) {
    return Date.UTC(parts.year, parts.month - 1, parts.day, 0, 0, 0, 0) - fixedOffset * 60_000;
  }

  const utcGuess = Date.UTC(parts.year, parts.month - 1, parts.day, 0, 0, 0, 0);
  const shown1 = getTimeZonePartsAtInstant(utcGuess, timeZone);
  const shownUtc1 = Date.UTC(
    shown1.year,
    shown1.month - 1,
    shown1.day,
    shown1.hour,
    shown1.minute,
    shown1.second,
  );
  const candidate1 = utcGuess - (shownUtc1 - utcGuess);

  const shown2 = getTimeZonePartsAtInstant(candidate1, timeZone);
  const shownUtc2 = Date.UTC(
    shown2.year,
    shown2.month - 1,
    shown2.day,
    shown2.hour,
    shown2.minute,
    shown2.second,
  );
  return candidate1 - (shownUtc2 - utcGuess);
}

function formatIsoInTimeZone(utcMs: number, timeZone: string): string {
  const fixedOffset = parseFixedOffsetMinutes(timeZone);
  if (fixedOffset !== null) {
    const shifted = new Date(utcMs + fixedOffset * 60_000);
    const yyyy = String(shifted.getUTCFullYear()).padStart(4, '0');
    const mm = String(shifted.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(shifted.getUTCDate()).padStart(2, '0');
    const hh = String(shifted.getUTCHours()).padStart(2, '0');
    const min = String(shifted.getUTCMinutes()).padStart(2, '0');
    const ss = String(shifted.getUTCSeconds()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}T${hh}:${min}:${ss}${formatOffset(fixedOffset)}`;
  }

  const parts = getTimeZonePartsAtInstant(utcMs, timeZone);
  const shownUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  const offsetMinutes = Math.round((shownUtc - utcMs) / 60_000);
  const yyyy = String(parts.year).padStart(4, '0');
  const mm = String(parts.month).padStart(2, '0');
  const dd = String(parts.day).padStart(2, '0');
  const hh = String(parts.hour).padStart(2, '0');
  const min = String(parts.minute).padStart(2, '0');
  const ss = String(parts.second).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${min}:${ss}${formatOffset(offsetMinutes)}`;
}

function addCalendarDays(parts: CalendarDateParts, deltaDays: number): CalendarDateParts {
  const next = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + deltaDays));
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  };
}

function getDayOfWeek(parts: CalendarDateParts): number {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
}

function resolveAnchorDateParts(anchor: DateAnchor, timeZone: string): CalendarDateParts {
  if (anchor instanceof Date) {
    const ms = anchor.getTime();
    if (!Number.isFinite(ms)) {
      throw new DomainValidationError('Invalid Date anchor');
    }
    return getDatePartsInTimeZone(ms, timeZone);
  }

  if (typeof anchor === 'string') {
    if (isValidIsoDateOnly(anchor)) {
      const match = ISO_DATE_CAPTURE_REGEX.exec(anchor);
      if (!match) {
        throw new DomainValidationError(`Invalid date anchor: ${anchor}`);
      }
      return {
        year: Number(match[1]),
        month: Number(match[2]),
        day: Number(match[3]),
      };
    }
    if (isValidIsoDateTimeWithTimezone(anchor)) {
      return getDatePartsInTimeZone(Date.parse(anchor), timeZone);
    }
    throw new DomainValidationError(`Invalid ISO date anchor: ${anchor}`);
  }

  const probe = new Date(Date.UTC(anchor.year, anchor.month - 1, anchor.day));
  if (
    probe.getUTCFullYear() !== anchor.year ||
    probe.getUTCMonth() !== anchor.month - 1 ||
    probe.getUTCDate() !== anchor.day
  ) {
    throw new DomainValidationError('Invalid calendar date parts');
  }
  return anchor;
}

function buildDateRange(
  mode: DateRangeMode,
  startParts: CalendarDateParts,
  endParts: CalendarDateParts,
  timeZone: string,
): DateRange {
  const startMs = getLocalMidnightMs(startParts, timeZone);
  const endMs = getLocalMidnightMs(endParts, timeZone);

  return {
    mode,
    timeZone,
    startAt: formatIsoInTimeZone(startMs, timeZone),
    endAt: formatIsoInTimeZone(endMs, timeZone),
    startMs,
    endMs,
  };
}

export function getDayRange(anchor: DateAnchor, options: DateRangeOptions = {}): DateRange {
  const timeZone = options.timeZone ?? 'UTC';
  assertValidTimeZone(timeZone);
  const dayParts = resolveAnchorDateParts(anchor, timeZone);
  return buildDateRange('day', dayParts, addCalendarDays(dayParts, 1), timeZone);
}

export function getWeekRange(anchor: DateAnchor, options: DateRangeOptions = {}): DateRange {
  const timeZone = options.timeZone ?? 'UTC';
  const weekStartsOn: WeekStartsOn = options.weekStartsOn ?? 1;
  assertValidTimeZone(timeZone);

  const dayParts = resolveAnchorDateParts(anchor, timeZone);
  const dayOfWeek = getDayOfWeek(dayParts);
  const diffToWeekStart = (dayOfWeek - weekStartsOn + 7) % 7;
  const weekStartParts = addCalendarDays(dayParts, -diffToWeekStart);
  const weekEndParts = addCalendarDays(weekStartParts, 7);

  return buildDateRange('week', weekStartParts, weekEndParts, timeZone);
}

export function getMonthRange(anchor: DateAnchor, options: DateRangeOptions = {}): DateRange {
  const timeZone = options.timeZone ?? 'UTC';
  assertValidTimeZone(timeZone);

  const dayParts = resolveAnchorDateParts(anchor, timeZone);
  const monthStartParts: CalendarDateParts = {
    year: dayParts.year,
    month: dayParts.month,
    day: 1,
  };
  const nextMonthStartParts: CalendarDateParts =
    dayParts.month === 12
      ? { year: dayParts.year + 1, month: 1, day: 1 }
      : { year: dayParts.year, month: dayParts.month + 1, day: 1 };

  return buildDateRange('month', monthStartParts, nextMonthStartParts, timeZone);
}

export function getDateRange(
  mode: DateRangeMode,
  anchor: DateAnchor,
  options: DateRangeOptions = {},
): DateRange {
  switch (mode) {
    case 'day':
      return getDayRange(anchor, options);
    case 'week':
      return getWeekRange(anchor, options);
    case 'month':
      return getMonthRange(anchor, options);
  }
}

function getDeadlineAnchorMs(deadline: Deadline, timeZone: string): number {
  if (isValidIsoDateOnly(deadline.dueDate)) {
    const match = ISO_DATE_CAPTURE_REGEX.exec(deadline.dueDate);
    if (!match) {
      throw new DomainValidationError(`Invalid deadline dueDate: ${deadline.dueDate}`);
    }
    return getLocalMidnightMs(
      {
        year: Number(match[1]),
        month: Number(match[2]),
        day: Number(match[3]),
      },
      timeZone,
    );
  }
  return Date.parse(deadline.dueDate);
}

export function isItemInDateRange(item: CalendarItem, range: DateRange): boolean {
  if (isSchedule(item)) {
    const startMs = Date.parse(item.startAt);
    const endMs = Date.parse(item.endAt);
    return startMs < range.endMs && endMs > range.startMs;
  }

  const dueMs = getDeadlineAnchorMs(item, range.timeZone);
  return dueMs >= range.startMs && dueMs < range.endMs;
}

export function filterItemsInDateRange(
  items: readonly CalendarItem[],
  range: DateRange,
): FilteredDateRangeItems {
  const schedules: Schedule[] = [];
  const deadlines: Deadline[] = [];

  for (const item of items) {
    if (!isItemInDateRange(item, range)) {
      continue;
    }
    if (isSchedule(item)) {
      schedules.push(item);
    } else if (isDeadline(item)) {
      deadlines.push(item);
    }
  }

  schedules.sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
  deadlines.sort(
    (a, b) => getDeadlineAnchorMs(a, range.timeZone) - getDeadlineAnchorMs(b, range.timeZone),
  );

  const combined: CalendarItem[] = [...deadlines, ...schedules];

  return {
    schedules,
    deadlines,
    items: combined,
  };
}
