import { isValidIsoDateOnly } from '@/shared/schemas';
import { isDeadline, type CalendarItem } from './types';

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

function getDefaultTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function getDateKeyAtInstant(utcMs: number, timeZone: string): string {
  const fixedOffset = parseFixedOffsetMinutes(timeZone);
  if (fixedOffset !== null) {
    const shifted = new Date(utcMs + fixedOffset * 60_000);
    const y = String(shifted.getUTCFullYear()).padStart(4, '0');
    const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
    const d = String(shifted.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(new Date(utcMs));
  const year = parts.find((p) => p.type === 'year')?.value ?? '1970';
  const month = parts.find((p) => p.type === 'month')?.value ?? '01';
  const day = parts.find((p) => p.type === 'day')?.value ?? '01';
  return `${year.padStart(4, '0')}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

/**
 * Pure domain predicate determining whether a formal CalendarItem has already expired:
 * - Schedule: endAt < referenceDate
 * - Deadline:
 *   - with time (ISO datetime): dueDate < referenceDate
 *   - date-only (YYYY-MM-DD): dueDate < today dateKey in resolved timeZone
 */
export function isItemPast(
  item: CalendarItem,
  referenceDate: Date = new Date(),
  timeZone?: string,
): boolean {
  const refMs = referenceDate.getTime();
  if (!Number.isFinite(refMs)) {
    return false;
  }

  if (isDeadline(item)) {
    if (!isValidIsoDateOnly(item.dueDate)) {
      const dueMs = Date.parse(item.dueDate);
      return Number.isFinite(dueMs) && dueMs < refMs;
    }

    const resolvedTz = timeZone?.trim() || getDefaultTimeZone();
    const todayKey = getDateKeyAtInstant(refMs, resolvedTz);
    return item.dueDate < todayKey;
  }

  const endMs = Date.parse(item.endAt);
  return Number.isFinite(endMs) && endMs < refMs;
}
