import { describe, expect, it } from 'vitest';
import { clearPastCalendarItems } from '@/application/commands';
import {
  createDeadline as createDeadlineEntity,
  createSchedule as createScheduleEntity,
  isItemPast,
} from '@/domain/schedule';
import { InMemoryCalendarRepository } from '@/infrastructure/repositories';

describe('isItemPast & clearPastCalendarItems', () => {
  const timeZone = 'Asia/Taipei';
  const refNow = new Date('2026-11-13T14:00:00+08:00');

  it('evaluates Schedule expiration strictly by endAt < referenceDate', () => {
    const endedSchedule = createScheduleEntity(
      {
        userId: 'u1',
        title: '上午微積分',
        startAt: '2026-11-13T09:00:00+08:00',
        endAt: '2026-11-13T11:00:00+08:00',
      },
      { id: 's-past', now: '2026-11-01T00:00:00Z' },
    );
    const ongoingSchedule = createScheduleEntity(
      {
        userId: 'u1',
        title: '進行中專題',
        startAt: '2026-11-13T13:00:00+08:00',
        endAt: '2026-11-13T15:00:00+08:00',
      },
      { id: 's-ongoing', now: '2026-11-01T00:00:00Z' },
    );
    const exactBoundarySchedule = createScheduleEntity(
      {
        userId: 'u1',
        title: '剛結束邊界',
        startAt: '2026-11-13T12:00:00+08:00',
        endAt: '2026-11-13T14:00:00+08:00',
      },
      { id: 's-eq', now: '2026-11-01T00:00:00Z' },
    );

    expect(isItemPast(endedSchedule, refNow, timeZone)).toBe(true);
    expect(isItemPast(ongoingSchedule, refNow, timeZone)).toBe(false);
    expect(isItemPast(exactBoundarySchedule, refNow, timeZone)).toBe(false);
  });

  it('evaluates Deadline expiration for both ISO datetime and YYYY-MM-DD date-only', () => {
    const yesterdayDeadline = createDeadlineEntity(
      { userId: 'u1', title: '昨日截止', dueDate: '2026-11-12' },
      { id: 'd-yesterday', now: '2026-11-01T00:00:00Z' },
    );
    const todayDateOnlyDeadline = createDeadlineEntity(
      { userId: 'u1', title: '今日整天截止', dueDate: '2026-11-13' },
      { id: 'd-today', now: '2026-11-01T00:00:00Z' },
    );
    const pastTimeDeadline = createDeadlineEntity(
      {
        userId: 'u1',
        title: '今天中午已過截止',
        dueDate: '2026-11-13T12:00:00+08:00',
      },
      { id: 'd-noon', now: '2026-11-01T00:00:00Z' },
    );
    const futureTimeDeadline = createDeadlineEntity(
      {
        userId: 'u1',
        title: '今天傍晚尚未到截止',
        dueDate: '2026-11-13T18:00:00+08:00',
      },
      { id: 'd-evening', now: '2026-11-01T00:00:00Z' },
    );

    expect(isItemPast(yesterdayDeadline, refNow, timeZone)).toBe(true);
    expect(isItemPast(todayDateOnlyDeadline, refNow, timeZone)).toBe(false);
    expect(isItemPast(pastTimeDeadline, refNow, timeZone)).toBe(true);
    expect(isItemPast(futureTimeDeadline, refNow, timeZone)).toBe(false);
  });

  it('clearPastCalendarItems deletes only past items for target user and keeps ongoing/future items and other users intact', async () => {
    const repo = new InMemoryCalendarRepository();

    await repo.save(
      createScheduleEntity(
        {
          userId: 'u1',
          title: '過去排程',
          startAt: '2026-11-12T09:00:00+08:00',
          endAt: '2026-11-12T10:30:00+08:00',
        },
        { id: 'u1-past-sched', now: '2026-11-01T00:00:00Z' },
      ),
    );
    await repo.save(
      createDeadlineEntity(
        { userId: 'u1', title: '過去截止', dueDate: '2026-11-12' },
        { id: 'u1-past-dl', now: '2026-11-01T00:00:00Z' },
      ),
    );
    await repo.save(
      createScheduleEntity(
        {
          userId: 'u1',
          title: '進行中排程',
          startAt: '2026-11-13T13:00:00+08:00',
          endAt: '2026-11-13T16:00:00+08:00',
        },
        { id: 'u1-ongoing-sched', now: '2026-11-01T00:00:00Z' },
      ),
    );
    await repo.save(
      createDeadlineEntity(
        { userId: 'u1', title: '未來截止', dueDate: '2026-11-20' },
        { id: 'u1-future-dl', now: '2026-11-01T00:00:00Z' },
      ),
    );
    await repo.save(
      createDeadlineEntity(
        { userId: 'u2', title: '其他使用者過去截止', dueDate: '2026-11-10' },
        { id: 'u2-past-dl', now: '2026-11-01T00:00:00Z' },
      ),
    );

    const result = await clearPastCalendarItems(repo, {
      userId: 'u1',
      referenceNow: refNow,
      timeZone,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.deletedCount).toBe(2);
    expect(result.data.remainingItems.map((i) => i.title).sort()).toEqual([
      '未來截止',
      '進行中排程',
    ]);

    const u1After = await repo.listByUser('u1');
    expect(u1After).toHaveLength(2);
    const u2After = await repo.listByUser('u2');
    expect(u2After).toHaveLength(1);
  });
});
