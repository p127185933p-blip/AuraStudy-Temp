import { describe, expect, it } from 'vitest';
import {
  acceptProposalChange,
  createDeadline,
  createSchedule,
  updateCalendarItem,
} from '@/application/commands';
import { computeUpcomingScheduleNotifications } from '@/domain/planning';
import {
  createDeadline as createDeadlineEntity,
  createSchedule as createScheduleEntity,
  type CalendarItem,
} from '@/domain/schedule';
import {
  InMemoryCalendarRepository,
  InMemoryDecisionLogRepository,
  InMemoryProposalRepository,
} from '@/infrastructure/repositories';

const REF_NOW = new Date('2026-11-13T10:00:00+08:00');
const TIME_ZONE = 'Asia/Taipei';
const USER_ID = 'student-1';

describe('Past-Time Guard Rules (Application Commands & Proposal Acceptance)', () => {
  it('blocks creating a Schedule in the past (>2m ago) and allows within 2-minute buffer or future', async () => {
    const repo = new InMemoryCalendarRepository();

    // 5 minutes in the past -> rejected
    const pastRes = await createSchedule(repo, {
      userId: USER_ID,
      title: '過去的微積分課',
      startAt: '2026-11-13T09:55:00+08:00',
      endAt: '2026-11-13T11:00:00+08:00',
      referenceNow: REF_NOW,
      timeZone: TIME_ZONE,
    });
    expect(pastRes.ok).toBe(false);
    if (!pastRes.ok) {
      expect(pastRes.error.code).toBe('PAST_TIME_NOT_ALLOWED');
      expect(pastRes.error.message).toBe('無法在過去的時間設定行程');
    }

    // 90 seconds ago (inside 2-minute buffer) -> allowed
    const bufferRes = await createSchedule(repo, {
      userId: USER_ID,
      title: '剛開始的複習',
      startAt: '2026-11-13T09:58:30+08:00',
      endAt: '2026-11-13T10:30:00+08:00',
      referenceNow: REF_NOW,
      timeZone: TIME_ZONE,
    });
    expect(bufferRes.ok).toBe(true);

    // Future time -> allowed
    const futureRes = await createSchedule(repo, {
      userId: USER_ID,
      title: '下午演算法練習',
      startAt: '2026-11-13T14:00:00+08:00',
      endAt: '2026-11-13T15:30:00+08:00',
      referenceNow: REF_NOW,
      timeZone: TIME_ZONE,
    });
    expect(futureRes.ok).toBe(true);
  });

  it('blocks creating a Deadline before today in local timezone, but allows today and future dates', async () => {
    const repo = new InMemoryCalendarRepository();

    const yesterdayRes = await createDeadline(repo, {
      userId: USER_ID,
      title: '昨天的作業',
      dueDate: '2026-11-12',
      referenceNow: REF_NOW,
      timeZone: TIME_ZONE,
    });
    expect(yesterdayRes.ok).toBe(false);
    if (!yesterdayRes.ok) {
      expect(yesterdayRes.error.code).toBe('PAST_TIME_NOT_ALLOWED');
      expect(yesterdayRes.error.message).toBe('截止日期不可設為過去的時間');
    }

    const todayRes = await createDeadline(repo, {
      userId: USER_ID,
      title: '今日應繳報告',
      dueDate: '2026-11-13',
      referenceNow: REF_NOW,
      timeZone: TIME_ZONE,
    });
    expect(todayRes.ok).toBe(true);
  });

  it('allows metadata-only updates on old items without changing time, while blocking moving time into the past', async () => {
    const oldSchedule = createScheduleEntity(
      {
        userId: USER_ID,
        title: '早上的課程',
        startAt: '2026-11-12T09:00:00+08:00',
        endAt: '2026-11-12T10:30:00+08:00',
      },
      { id: 'sc-old', now: '2026-11-11T00:00:00Z' },
    );
    const oldDeadline = createDeadlineEntity(
      {
        userId: USER_ID,
        title: '舊作業',
        dueDate: '2026-11-12',
      },
      { id: 'dl-old', now: '2026-11-11T00:00:00Z' },
    );

    const repo = new InMemoryCalendarRepository([oldSchedule, oldDeadline]);

    // Metadata edit on old Schedule (even if identical startAt/endAt sent) -> allowed
    const metaScheduleRes = await updateCalendarItem(repo, {
      userId: USER_ID,
      itemId: oldSchedule.id,
      expectedRevision: 1,
      patch: {
        title: '早上的課程（已補筆記）',
        startAt: oldSchedule.startAt,
        endAt: oldSchedule.endAt,
        tag: '複習',
      },
      referenceNow: REF_NOW,
      timeZone: TIME_ZONE,
    });
    expect(metaScheduleRes.ok).toBe(true);

    // Moving Schedule to a different past time -> blocked
    const movePastRes = await updateCalendarItem(repo, {
      userId: USER_ID,
      itemId: oldSchedule.id,
      expectedRevision: 2,
      patch: {
        startAt: '2026-11-13T08:00:00+08:00',
        endAt: '2026-11-13T09:30:00+08:00',
      },
      referenceNow: REF_NOW,
      timeZone: TIME_ZONE,
    });
    expect(movePastRes.ok).toBe(false);
    if (!movePastRes.ok) {
      expect(movePastRes.error.code).toBe('PAST_TIME_NOT_ALLOWED');
    }

    // Metadata edit on old Deadline -> allowed
    const metaDeadlineRes = await updateCalendarItem(repo, {
      userId: USER_ID,
      itemId: oldDeadline.id,
      expectedRevision: 1,
      patch: { status: 'completed', dueDate: oldDeadline.dueDate },
      referenceNow: REF_NOW,
      timeZone: TIME_ZONE,
    });
    expect(metaDeadlineRes.ok).toBe(true);

    // Moving Deadline to another past date -> blocked
    const moveDeadlinePastRes = await updateCalendarItem(repo, {
      userId: USER_ID,
      itemId: oldDeadline.id,
      expectedRevision: 2,
      patch: { dueDate: '2026-11-11' },
      referenceNow: REF_NOW,
      timeZone: TIME_ZONE,
    });
    expect(moveDeadlinePastRes.ok).toBe(false);
    if (!moveDeadlinePastRes.ok) {
      expect(moveDeadlinePastRes.error.code).toBe('PAST_TIME_NOT_ALLOWED');
    }
  });

  it('blocks accepting an AI proposal whose target startAt is in the past', async () => {
    const calendarRepo = new InMemoryCalendarRepository();
    const proposalRepo = new InMemoryProposalRepository();
    const logRepo = new InMemoryDecisionLogRepository();

    const pastSchedule = createScheduleEntity(
      {
        userId: USER_ID,
        title: 'AI 誤排的過去時段',
        startAt: '2026-11-13T08:00:00+08:00',
        endAt: '2026-11-13T09:00:00+08:00',
      },
      { id: 'sc-ai-past', now: '2026-11-13T00:00:00Z' },
    );

    await proposalRepo.save({
      id: 'chg-past-1',
      proposalId: 'prop-1',
      action: 'create',
      status: 'pending',
      after: pastSchedule,
      reason: '測試過去提案',
      createdAt: '2026-11-13T00:00:00Z',
      updatedAt: '2026-11-13T00:00:00Z',
    });

    const acceptRes = await acceptProposalChange(
      {
        calendarRepository: calendarRepo,
        proposalRepository: proposalRepo,
        decisionLogRepository: logRepo,
      },
      {
        userId: USER_ID,
        changeId: 'chg-past-1',
        referenceNow: REF_NOW,
        timeZone: TIME_ZONE,
      },
    );

    expect(acceptRes.ok).toBe(false);
    if (!acceptRes.ok) {
      expect(acceptRes.error.code).toBe('PAST_TIME_NOT_ALLOWED');
    }
    expect(await calendarRepo.listByUser(USER_ID)).toHaveLength(0);
  });
});

describe('Smart Schedule Notifications Pure Domain Calculation', () => {
  it('computes 20-minute pre-start alerts with time range and end-time alerts with ONLY the next schedule title', () => {
    const items: CalendarItem[] = [
      createScheduleEntity(
        {
          userId: USER_ID,
          title: '線性代數複習',
          startAt: '2026-11-13T10:30:00+08:00',
          endAt: '2026-11-13T11:30:00+08:00',
        },
        { id: 'sc-1', now: '2026-11-13T00:00:00Z' },
      ),
      createScheduleEntity(
        {
          userId: USER_ID,
          title: '已取消的會議',
          startAt: '2026-11-13T11:30:00+08:00',
          endAt: '2026-11-13T12:00:00+08:00',
          status: 'cancelled',
        },
        { id: 'sc-cancelled', now: '2026-11-13T00:00:00Z' },
      ),
      createScheduleEntity(
        {
          userId: USER_ID,
          title: '演算法刷題',
          startAt: '2026-11-13T13:00:00+08:00',
          endAt: '2026-11-13T14:30:00+08:00',
        },
        { id: 'sc-2', now: '2026-11-13T00:00:00Z' },
      ),
    ];

    const events = computeUpcomingScheduleNotifications(items, {
      now: '2026-11-13T10:00:00+08:00',
      timeZone: TIME_ZONE,
    });

    // 2 schedules * 2 events (cancelled excluded) = 4 events
    expect(events).toHaveLength(4);

    // Event A for sc-1: 10:10 (+08:00)
    const sc1Before = events.find(
      (e) => e.scheduleId === 'sc-1' && e.type === 'before_start',
    )!;
    expect(sc1Before.triggerAtMs).toBe(Date.parse('2026-11-13T10:10:00+08:00'));
    expect(sc1Before.title).toBe('即將開始：線性代數複習');
    expect(sc1Before.body).toBe('執行時段：10:30 – 11:30');

    // Event B for sc-1: 11:30 (+08:00) -> next active is 演算法刷題 (cancelled skipped!), NO time attached!
    const sc1End = events.find(
      (e) => e.scheduleId === 'sc-1' && e.type === 'at_end',
    )!;
    expect(sc1End.triggerAtMs).toBe(Date.parse('2026-11-13T11:30:00+08:00'));
    expect(sc1End.title).toBe('行程時間到了');
    expect(sc1End.body).toBe('下一個行程：演算法刷題');
    expect(sc1End.body).not.toContain('13:00');
    expect(sc1End.body).not.toContain('14:30');

    // Event B for sc-2: no subsequent schedule
    const sc2End = events.find(
      (e) => e.scheduleId === 'sc-2' && e.type === 'at_end',
    )!;
    expect(sc2End.title).toBe('行程時間到了');
    expect(sc2End.body).toBe('目前沒有下一個行程');
  });

  it('schedules before_start immediately when created within 20 minutes of startAt', () => {
    const items: CalendarItem[] = [
      createScheduleEntity(
        {
          userId: USER_ID,
          title: '即將開始的英文聽力',
          startAt: '2026-11-13T10:12:00+08:00',
          endAt: '2026-11-13T11:00:00+08:00',
        },
        { id: 'sc-soon', now: '2026-11-13T00:00:00Z' },
      ),
    ];

    const nowIso = '2026-11-13T10:00:00+08:00';
    const events = computeUpcomingScheduleNotifications(items, {
      now: nowIso,
      timeZone: TIME_ZONE,
    });

    const beforeEvent = events.find((e) => e.type === 'before_start')!;
    expect(beforeEvent.triggerAtMs).toBe(Date.parse(nowIso));
    expect(beforeEvent.title).toBe('即將開始：即將開始的英文聽力');
    expect(beforeEvent.body).toBe('執行時段：10:12 – 11:00');
  });
});
