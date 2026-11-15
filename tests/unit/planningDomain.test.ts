import { describe, expect, it } from 'vitest';
import {
  detectScheduleConflicts,
  filterItemsInDateRange,
  getDayRange,
  getMonthRange,
  getWeekRange,
} from '@/domain/planning';
import { createDeadline, createSchedule, type CalendarItem } from '@/domain/schedule';

describe('Schedule Conflict Detection (Pure Planning Domain)', () => {
  const baseTime = '2026-11-13T00:00:00Z';

  const existingSchedule = createSchedule(
    {
      userId: 'user-1',
      title: 'Existing Block',
      startAt: '2026-11-14T09:00:00+08:00',
      endAt: '2026-11-14T11:00:00+08:00',
    },
    { id: 'sc-existing', now: baseTime },
  );

  const deadlineAtSameTime = createDeadline(
    {
      userId: 'user-1',
      title: 'Lab Report Due',
      dueDate: '2026-11-14T10:00:00+08:00',
    },
    { id: 'dl-same', now: baseTime },
  );

  const items: CalendarItem[] = [existingSchedule, deadlineAtSameTime];

  it('detects partial overlap and computes exact overlap interval', () => {
    const result = detectScheduleConflicts(
      {
        startAt: '2026-11-14T10:30:00+08:00',
        endAt: '2026-11-14T12:00:00+08:00',
      },
      items,
    );

    expect(result.hasConflict).toBe(true);
    expect(result.conflictingItems.map((i) => i.id)).toEqual(['sc-existing']);
    expect(result.conflicts[0]).toEqual({
      item: existingSchedule,
      overlapStartAt: new Date('2026-11-14T10:30:00+08:00').toISOString(),
      overlapEndAt: new Date('2026-11-14T11:00:00+08:00').toISOString(),
    });
  });

  it('detects containment (nested inside or enclosing) and exact identical windows', () => {
    const nested = detectScheduleConflicts(
      {
        startAt: '2026-11-14T09:30:00+08:00',
        endAt: '2026-11-14T10:30:00+08:00',
      },
      items,
    );
    expect(nested.hasConflict).toBe(true);

    const enclosing = detectScheduleConflicts(
      {
        startAt: '2026-11-14T08:00:00+08:00',
        endAt: '2026-11-14T12:00:00+08:00',
      },
      items,
    );
    expect(enclosing.hasConflict).toBe(true);

    const identical = detectScheduleConflicts(
      {
        startAt: '2026-11-14T09:00:00+08:00',
        endAt: '2026-11-14T11:00:00+08:00',
      },
      items,
    );
    expect(identical.hasConflict).toBe(true);
  });

  it('does NOT report conflict for head-to-tail adjacent schedules', () => {
    const beforeAdjacent = detectScheduleConflicts(
      {
        startAt: '2026-11-14T08:00:00+08:00',
        endAt: '2026-11-14T09:00:00+08:00',
      },
      items,
    );
    expect(beforeAdjacent.hasConflict).toBe(false);

    const afterAdjacent = detectScheduleConflicts(
      {
        startAt: '2026-11-14T11:00:00+08:00',
        endAt: '2026-11-14T12:00:00+08:00',
      },
      items,
    );
    expect(afterAdjacent.hasConflict).toBe(false);
  });

  it('ignores self when excludeItemId is specified and ignores all Deadlines', () => {
    const selfEdit = detectScheduleConflicts(
      {
        startAt: '2026-11-14T09:00:00+08:00',
        endAt: '2026-11-14T11:00:00+08:00',
      },
      items,
      { excludeItemId: 'sc-existing' },
    );
    expect(selfEdit.hasConflict).toBe(false);

    const onlyDeadlines = detectScheduleConflicts(
      {
        startAt: '2026-11-14T09:30:00+08:00',
        endAt: '2026-11-14T10:30:00+08:00',
      },
      [deadlineAtSameTime],
    );
    expect(onlyDeadlines.hasConflict).toBe(false);
  });

  it('detects overlap accurately across different timezone notations', () => {
    // 2026-11-14T09:00+08:00 is 2026-11-14T01:00:00Z
    const utcOverlap = detectScheduleConflicts(
      {
        startAt: '2026-11-14T01:30:00Z',
        endAt: '2026-11-14T02:30:00Z',
      },
      items,
    );
    expect(utcOverlap.hasConflict).toBe(true);
  });
});

describe('Date Range & Timezone Planning Utilities', () => {
  it('computes Day range respecting timezone boundaries', () => {
    // 2026-11-13T01:00:00+08:00 is 2026-11-12T17:00:00Z
    const taipeiDay = getDayRange('2026-11-13T01:00:00+08:00', {
      timeZone: 'Asia/Taipei',
    });
    expect(taipeiDay.startAt).toBe('2026-11-13T00:00:00+08:00');
    expect(taipeiDay.endAt).toBe('2026-11-14T00:00:00+08:00');

    const utcDay = getDayRange('2026-11-13T01:00:00+08:00', {
      timeZone: 'UTC',
    });
    expect(utcDay.startAt).toBe('2026-11-12T00:00:00Z');
    expect(utcDay.endAt).toBe('2026-11-13T00:00:00Z');
  });

  it('computes Week range for Monday-start and Sunday-start', () => {
    // 2026-11-13 is Friday
    const mondayWeek = getWeekRange('2026-11-13', {
      timeZone: '+08:00',
      weekStartsOn: 1,
    });
    expect(mondayWeek.startAt).toBe('2026-11-09T00:00:00+08:00');
    expect(mondayWeek.endAt).toBe('2026-11-16T00:00:00+08:00');

    const sundayWeek = getWeekRange('2026-11-13', {
      timeZone: '+08:00',
      weekStartsOn: 0,
    });
    expect(sundayWeek.startAt).toBe('2026-11-08T00:00:00+08:00');
    expect(sundayWeek.endAt).toBe('2026-11-15T00:00:00+08:00');
  });

  it('computes Month range including December rollover and leap February', () => {
    const decMonth = getMonthRange('2026-12-18', { timeZone: 'UTC' });
    expect(decMonth.startAt).toBe('2026-12-01T00:00:00Z');
    expect(decMonth.endAt).toBe('2027-01-01T00:00:00Z');

    const leapFeb = getMonthRange('2024-02-15', { timeZone: '+08:00' });
    expect(leapFeb.startAt).toBe('2024-02-01T00:00:00+08:00');
    expect(leapFeb.endAt).toBe('2024-03-01T00:00:00+08:00');
  });

  it('handles IANA DST transition day boundaries accurately', () => {
    // 2026-11-01 in America/New_York is fall-back DST day (25-hour day)
    const dstDay = getDayRange('2026-11-01', { timeZone: 'America/New_York' });
    expect(dstDay.startAt).toBe('2026-11-01T00:00:00-04:00');
    expect(dstDay.endAt).toBe('2026-11-02T00:00:00-05:00');
    expect(dstDay.endMs - dstDay.startMs).toBe(25 * 60 * 60 * 1000);
  });

  it('filters Schedules and Deadlines within a Day range properly', () => {
    const dayRange = getDayRange('2026-11-14', { timeZone: '+08:00' });
    const now = '2026-11-13T00:00:00Z';

    const insideSchedule = createSchedule(
      {
        userId: 'user-1',
        title: 'Morning Session',
        startAt: '2026-11-14T08:00:00+08:00',
        endAt: '2026-11-14T10:00:00+08:00',
      },
      { id: 'sc-in', now },
    );

    const endsAtMidnightBefore = createSchedule(
      {
        userId: 'user-1',
        title: 'Previous Night Ending at 00:00',
        startAt: '2026-11-13T22:00:00+08:00',
        endAt: '2026-11-14T00:00:00+08:00',
      },
      { id: 'sc-prev-edge', now },
    );

    const crossMidnightSchedule = createSchedule(
      {
        userId: 'user-1',
        title: 'Late Night Over Midnight',
        startAt: '2026-11-14T23:00:00+08:00',
        endAt: '2026-11-15T01:00:00+08:00',
      },
      { id: 'sc-cross', now },
    );

    const dateOnlyDeadline = createDeadline(
      {
        userId: 'user-1',
        title: 'Essay Due',
        dueDate: '2026-11-14',
      },
      { id: 'dl-in', now },
    );

    const nextDayDeadline = createDeadline(
      {
        userId: 'user-1',
        title: 'Next Day Quiz',
        dueDate: '2026-11-15T00:00:00+08:00',
      },
      { id: 'dl-out', now },
    );

    const filtered = filterItemsInDateRange(
      [
        insideSchedule,
        endsAtMidnightBefore,
        crossMidnightSchedule,
        dateOnlyDeadline,
        nextDayDeadline,
      ],
      dayRange,
    );

    expect(filtered.schedules.map((s) => s.id)).toEqual(['sc-in', 'sc-cross']);
    expect(filtered.deadlines.map((d) => d.id)).toEqual(['dl-in']);
  });
});
