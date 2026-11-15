import type { DateRangeMode, WeekStartsOn } from '@/domain/planning';
import { isValidIsoDateOnly } from '@/shared/schemas';

const FIXED_OFFSET_REGEX = /^(Z|([+-])(\d{2}):(\d{2}))$/;
const DATE_KEY_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;
const WEEKDAY_ZH = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'] as const;

export interface ParsedDateKey {
  year: number;
  month: number;
  day: number;
}

export function parseDateKey(dateKey: string): ParsedDateKey {
  const match = DATE_KEY_REGEX.exec(dateKey);
  if (!match) {
    throw new Error(`Invalid dateKey: ${dateKey}`);
  }
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

export function formatDateKey(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

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

function formatOffset(offsetMinutes: number): string {
  if (offsetMinutes === 0) {
    return 'Z';
  }
  const sign = offsetMinutes > 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${sign}${hh}:${mm}`;
}

function getZonedDateTimeParts(
  utcMs: number,
  timeZone: string,
): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
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
      second: shifted.getUTCSeconds(),
    };
  }

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

export function getBrowserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Taipei';
  } catch {
    return 'Asia/Taipei';
  }
}

export function getDateKeyFromInstant(
  dateOrIso: Date | string,
  timeZone: string,
): string {
  if (typeof dateOrIso === 'string' && isValidIsoDateOnly(dateOrIso)) {
    return dateOrIso;
  }
  const ms = typeof dateOrIso === 'string' ? Date.parse(dateOrIso) : dateOrIso.getTime();
  const parts = getZonedDateTimeParts(ms, timeZone);
  return formatDateKey(parts.year, parts.month, parts.day);
}

export function getLocalTimeHHmm(isoString: string, timeZone: string): string {
  const ms = Date.parse(isoString);
  const parts = getZonedDateTimeParts(ms, timeZone);
  return `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
}

export function getMinutesFromMidnight(isoString: string, timeZone: string): number {
  const ms = Date.parse(isoString);
  const parts = getZonedDateTimeParts(ms, timeZone);
  return parts.hour * 60 + parts.minute;
}

export function minutesToHHmm(totalMinutes: number): string {
  const clamped = Math.max(0, Math.min(24 * 60, Math.round(totalMinutes)));
  if (clamped === 24 * 60) {
    return '23:59';
  }
  const hh = String(Math.floor(clamped / 60)).padStart(2, '0');
  const mm = String(clamped % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function buildIsoFromLocalDateTime(
  dateKey: string,
  timeHHmm: string,
  timeZone: string,
): string {
  const { year, month, day } = parseDateKey(dateKey);
  const [hourStr, minuteStr] = timeHHmm.split(':');
  const hour = Number(hourStr);
  const minute = Number(minuteStr);

  const fixedOffset = parseFixedOffsetMinutes(timeZone);
  if (fixedOffset !== null) {
    return `${dateKey}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00${formatOffset(fixedOffset)}`;
  }

  const targetLocalAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const shown1 = getZonedDateTimeParts(targetLocalAsUtc, timeZone);
  const shownUtc1 = Date.UTC(
    shown1.year,
    shown1.month - 1,
    shown1.day,
    shown1.hour,
    shown1.minute,
    shown1.second,
  );
  const candidate1 = targetLocalAsUtc - (shownUtc1 - targetLocalAsUtc);

  const shown2 = getZonedDateTimeParts(candidate1, timeZone);
  const shownUtc2 = Date.UTC(
    shown2.year,
    shown2.month - 1,
    shown2.day,
    shown2.hour,
    shown2.minute,
    shown2.second,
  );
  const exactUtcMs = candidate1 - (shownUtc2 - targetLocalAsUtc);
  const finalParts = getZonedDateTimeParts(exactUtcMs, timeZone);
  const finalShownUtc = Date.UTC(
    finalParts.year,
    finalParts.month - 1,
    finalParts.day,
    finalParts.hour,
    finalParts.minute,
    finalParts.second,
  );
  const offsetMinutes = Math.round((finalShownUtc - exactUtcMs) / 60_000);

  return `${formatDateKey(finalParts.year, finalParts.month, finalParts.day)}T${String(
    finalParts.hour,
  ).padStart(2, '0')}:${String(finalParts.minute).padStart(2, '0')}:00${formatOffset(
    offsetMinutes,
  )}`;
}

export function shiftDateKey(dateKey: string, deltaDays: number): string {
  const { year, month, day } = parseDateKey(dateKey);
  const next = new Date(Date.UTC(year, month - 1, day + deltaDays));
  return formatDateKey(
    next.getUTCFullYear(),
    next.getUTCMonth() + 1,
    next.getUTCDate(),
  );
}

export function shiftMonthDateKey(dateKey: string, deltaMonths: number): string {
  const { year, month, day } = parseDateKey(dateKey);
  const targetMonthIndex = year * 12 + (month - 1) + deltaMonths;
  const targetYear = Math.floor(targetMonthIndex / 12);
  const targetMonth = (targetMonthIndex % 12) + 1;
  const daysInTargetMonth = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  const clampedDay = Math.min(day, daysInTargetMonth);
  return formatDateKey(targetYear, targetMonth, clampedDay);
}

export function getDayOfWeekFromDateKey(dateKey: string): number {
  const { year, month, day } = parseDateKey(dateKey);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function getWeekDateKeys(
  anchorDateKey: string,
  weekStartsOn: WeekStartsOn = 1,
): string[] {
  const dow = getDayOfWeekFromDateKey(anchorDateKey);
  const diffToStart = (dow - weekStartsOn + 7) % 7;
  const startKey = shiftDateKey(anchorDateKey, -diffToStart);
  return Array.from({ length: 7 }, (_, i) => shiftDateKey(startKey, i));
}

export function getMonthGridDateKeys(
  anchorDateKey: string,
  weekStartsOn: WeekStartsOn = 1,
): string[] {
  const { year, month } = parseDateKey(anchorDateKey);
  const firstOfMonth = formatDateKey(year, month, 1);
  const firstDow = getDayOfWeekFromDateKey(firstOfMonth);
  const leadingDays = (firstDow - weekStartsOn + 7) % 7;

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const totalCells = leadingDays + daysInMonth > 35 ? 42 : 35;
  const gridStart = shiftDateKey(firstOfMonth, -leadingDays);

  return Array.from({ length: totalCells }, (_, i) => shiftDateKey(gridStart, i));
}

export function formatDayHeaderParts(dateKey: string): {
  weekday: string;
  monthDay: string;
  dayNumber: number;
} {
  const { month, day } = parseDateKey(dateKey);
  const dow = getDayOfWeekFromDateKey(dateKey);
  return {
    weekday: WEEKDAY_ZH[dow],
    monthDay: `${month}/${day}`,
    dayNumber: day,
  };
}

export function formatRangeTitle(
  mode: DateRangeMode,
  anchorDateKey: string,
  weekStartsOn: WeekStartsOn = 1,
): string {
  const { year, month, day } = parseDateKey(anchorDateKey);

  if (mode === 'month') {
    return `${year}年${month}月`;
  }

  if (mode === 'week') {
    const weekKeys = getWeekDateKeys(anchorDateKey, weekStartsOn);
    const start = parseDateKey(weekKeys[0]);
    const end = parseDateKey(weekKeys[6]);
    if (start.year !== end.year) {
      return `${start.year}年${start.month}月${start.day}日 – ${end.year}年${end.month}月${end.day}日`;
    }
    if (start.month !== end.month) {
      return `${start.year}年 ${start.month}月${start.day}日 – ${end.month}月${end.day}日`;
    }
    return `${start.year}年 ${start.month}月${start.day}日 – ${end.day}日`;
  }

  const dow = getDayOfWeekFromDateKey(anchorDateKey);
  return `${year}年${month}月${day}日 ${WEEKDAY_ZH[dow]}`;
}
