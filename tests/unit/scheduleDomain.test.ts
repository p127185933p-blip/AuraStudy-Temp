import { describe, expect, it } from 'vitest';
import {
  DomainValidationError,
  createDeadline,
  createSchedule,
  isDeadline,
  isSchedule,
  updateDeadline,
  updateSchedule,
} from '@/domain/schedule';
import { CalendarItemSchema, DeadlineSchema } from '@/shared/schemas';

describe('Schedule & Deadline Domain Models', () => {
  const createdAt = '2026-11-13T08:00:00+08:00';
  const updatedAt = '2026-11-13T09:30:00+08:00';

  it('creates and validates a Deadline with revision 1 and no time range', () => {
    const deadline = createDeadline(
      {
        userId: 'user-1',
        title: 'Linear Algebra Homework 3',
        dueDate: '2026-11-20',
        description: 'Submit PDF on portal',
        tag: 'Math',
        status: 'pending',
      },
      { id: 'dl-1', now: createdAt },
    );

    expect(isDeadline(deadline)).toBe(true);
    expect(isSchedule(deadline)).toBe(false);
    expect(deadline).toEqual({
      id: 'dl-1',
      userId: 'user-1',
      type: 'deadline',
      title: 'Linear Algebra Homework 3',
      dueDate: '2026-11-20',
      description: 'Submit PDF on portal',
      tag: 'Math',
      status: 'pending',
      revision: 1,
      createdAt,
      updatedAt: createdAt,
    });
    expect(CalendarItemSchema.safeParse(deadline).success).toBe(true);
  });

  it('rejects Deadline containing startAt/endAt or invalid ISO dates', () => {
    const withScheduleFields = DeadlineSchema.safeParse({
      id: 'dl-bad',
      userId: 'user-1',
      type: 'deadline',
      title: 'Bad Deadline',
      dueDate: '2026-11-20',
      startAt: '2026-11-20T09:00:00+08:00',
      revision: 1,
      createdAt,
      updatedAt: createdAt,
    });
    expect(withScheduleFields.success).toBe(false);

    expect(() =>
      createDeadline({
        userId: 'user-1',
        title: 'Invalid Calendar Date',
        dueDate: '2026-02-30',
      }),
    ).toThrow(DomainValidationError);

    expect(() =>
      createDeadline({
        userId: 'user-1',
        title: '   ',
        dueDate: '2026-11-20',
      }),
    ).toThrow(DomainValidationError);
  });

  it('updates Deadline and increments revision and updatedAt', () => {
    const initial = createDeadline(
      {
        userId: 'user-1',
        title: 'OS Project Milestone',
        dueDate: '2026-11-22T23:59:00+08:00',
      },
      { id: 'dl-2', now: createdAt },
    );

    const next = updateDeadline(
      initial,
      { status: 'completed', title: 'OS Project Milestone (Submitted)' },
      { now: updatedAt },
    );

    expect(next.revision).toBe(2);
    expect(next.createdAt).toBe(createdAt);
    expect(next.updatedAt).toBe(updatedAt);
    expect(next.status).toBe('completed');
    expect(next.title).toBe('OS Project Milestone (Submitted)');
  });

  it('creates a valid Schedule with revision 1', () => {
    const schedule = createSchedule(
      {
        userId: 'user-1',
        title: 'Algorithms Deep Study',
        startAt: '2026-11-14T09:00:00+08:00',
        endAt: '2026-11-14T11:00:00+08:00',
        tag: 'CS',
        status: 'scheduled',
      },
      { id: 'sc-1', now: createdAt },
    );

    expect(isSchedule(schedule)).toBe(true);
    expect(isDeadline(schedule)).toBe(false);
    expect(schedule.revision).toBe(1);
    expect(CalendarItemSchema.safeParse(schedule).success).toBe(true);
  });

  it('rejects Schedule when endAt <= startAt or timezone is missing', () => {
    expect(() =>
      createSchedule({
        userId: 'user-1',
        title: 'Zero Duration',
        startAt: '2026-11-14T09:00:00+08:00',
        endAt: '2026-11-14T09:00:00+08:00',
      }),
    ).toThrow(DomainValidationError);

    expect(() =>
      createSchedule({
        userId: 'user-1',
        title: 'Reversed Window',
        startAt: '2026-11-14T11:00:00+08:00',
        endAt: '2026-11-14T09:00:00+08:00',
      }),
    ).toThrow(DomainValidationError);

    expect(() =>
      createSchedule({
        userId: 'user-1',
        title: 'Missing Timezone',
        startAt: '2026-11-14T09:00:00',
        endAt: '2026-11-14T10:00:00',
      }),
    ).toThrow(DomainValidationError);
  });

  it('updates Schedule, increments revision, and re-enforces endAt > startAt', () => {
    const schedule = createSchedule(
      {
        userId: 'user-1',
        title: 'Physics Review',
        startAt: '2026-11-14T14:00:00+08:00',
        endAt: '2026-11-14T15:30:00+08:00',
      },
      { id: 'sc-2', now: createdAt },
    );

    const updated = updateSchedule(
      schedule,
      { endAt: '2026-11-14T16:00:00+08:00' },
      { now: updatedAt },
    );
    expect(updated.revision).toBe(2);
    expect(updated.updatedAt).toBe(updatedAt);

    expect(() =>
      updateSchedule(schedule, { endAt: '2026-11-14T13:30:00+08:00' }),
    ).toThrow(DomainValidationError);
  });
});
