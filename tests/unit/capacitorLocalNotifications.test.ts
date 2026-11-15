import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const capacitorMocks = vi.hoisted(() => ({
  isNativePlatform: vi.fn<() => boolean>(() => false),
  checkPermissions: vi.fn(),
  requestPermissions: vi.fn(),
  getPending: vi.fn(),
  cancel: vi.fn(),
  schedule: vi.fn(),
  createChannel: vi.fn(),
  checkExactNotificationSetting: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: capacitorMocks.isNativePlatform,
  },
}));

vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: {
    checkPermissions: capacitorMocks.checkPermissions,
    requestPermissions: capacitorMocks.requestPermissions,
    getPending: capacitorMocks.getPending,
    cancel: capacitorMocks.cancel,
    schedule: capacitorMocks.schedule,
    createChannel: capacitorMocks.createChannel,
    checkExactNotificationSetting: capacitorMocks.checkExactNotificationSetting,
  },
}));

import {
  createDeadline as createDeadlineEntity,
  createSchedule as createScheduleEntity,
  type CalendarItem,
} from '@/domain/schedule';
import {
  ANDROID_NOTIFICATION_CHANNEL_ID,
  ScheduleNotificationScheduler,
  buildNativeLocalNotifications,
  checkNotificationPermission,
  isNotificationSupported,
  requestNotificationPermission,
  syncNativeScheduleNotifications,
  toAndroidNotificationId,
} from '@/infrastructure/notifications';

const TIME_ZONE = 'Asia/Taipei';
const USER_ID = 'student-1';

describe('Capacitor Android LocalNotifications Adapter', () => {
  const hadNotificationProp = 'Notification' in window;
  const originalNotification = window.Notification;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-13T18:00:00+08:00'));

    capacitorMocks.isNativePlatform.mockReturnValue(true);
    capacitorMocks.checkPermissions.mockResolvedValue({ display: 'granted' });
    capacitorMocks.requestPermissions.mockResolvedValue({ display: 'granted' });
    capacitorMocks.getPending.mockResolvedValue({ notifications: [] });
    capacitorMocks.cancel.mockResolvedValue(undefined);
    capacitorMocks.schedule.mockResolvedValue({ notifications: [] });
    capacitorMocks.createChannel.mockResolvedValue(undefined);
    capacitorMocks.checkExactNotificationSetting.mockResolvedValue({
      exact_alarm: 'granted',
    });

    // Simulate Capacitor Android WebView where window.Notification does NOT exist
    Reflect.deleteProperty(window, 'Notification');
  });

  afterEach(() => {
    vi.useRealTimers();
    if (hadNotificationProp) {
      Object.defineProperty(window, 'Notification', {
        configurable: true,
        writable: true,
        value: originalNotification,
      });
    } else {
      Reflect.deleteProperty(window, 'Notification');
    }
  });

  it('treats notifications as supported on native Capacitor even without window.Notification, and falls back on web', () => {
    expect(isNotificationSupported()).toBe(true);

    capacitorMocks.isNativePlatform.mockReturnValue(false);
    expect(isNotificationSupported()).toBe(false);
  });

  it('checks and requests permissions via Capacitor LocalNotifications', async () => {
    capacitorMocks.checkPermissions.mockResolvedValueOnce({ display: 'prompt' });
    expect(await checkNotificationPermission()).toBe('default');

    capacitorMocks.checkPermissions.mockResolvedValueOnce({ display: 'prompt' });
    capacitorMocks.requestPermissions.mockResolvedValueOnce({ display: 'granted' });
    expect(await requestNotificationPermission()).toBe('granted');
    expect(capacitorMocks.requestPermissions).toHaveBeenCalledTimes(1);

    capacitorMocks.checkPermissions.mockResolvedValueOnce({ display: 'prompt' });
    capacitorMocks.requestPermissions.mockResolvedValueOnce({ display: 'denied' });
    expect(await requestNotificationPermission()).toBe('denied');
  });

  it('builds strictly future two-stage native notifications and excludes past or cancelled items', () => {
    const items: CalendarItem[] = [
      // Past schedule -> should NOT be scheduled
      createScheduleEntity(
        {
          userId: USER_ID,
          title: '早上的微積分',
          startAt: '2026-11-13T09:00:00+08:00',
          endAt: '2026-11-13T10:00:00+08:00',
        },
        { id: 'sc-past', now: '2026-11-13T00:00:00Z' },
      ),
      // Deadline -> should NOT be scheduled
      createDeadlineEntity(
        {
          userId: USER_ID,
          title: '演算法作業',
          dueDate: '2026-11-14',
        },
        { id: 'dl-1', now: '2026-11-13T00:00:00Z' },
      ),
      // Future schedule 1: 19:30 - 20:30 (before_start at 19:10, at_end at 20:30)
      createScheduleEntity(
        {
          userId: USER_ID,
          title: '線性代數複習',
          startAt: '2026-11-13T19:30:00+08:00',
          endAt: '2026-11-13T20:30:00+08:00',
        },
        { id: 'sc-1', now: '2026-11-13T00:00:00Z' },
      ),
      // Cancelled schedule -> skipped
      createScheduleEntity(
        {
          userId: USER_ID,
          title: '取消的讀書會',
          startAt: '2026-11-13T20:30:00+08:00',
          endAt: '2026-11-13T21:00:00+08:00',
          status: 'cancelled',
        },
        { id: 'sc-cancelled', now: '2026-11-13T00:00:00Z' },
      ),
      // Future schedule 2: 21:00 - 22:00
      createScheduleEntity(
        {
          userId: USER_ID,
          title: '英文閱讀練習',
          startAt: '2026-11-13T21:00:00+08:00',
          endAt: '2026-11-13T22:00:00+08:00',
        },
        { id: 'sc-2', now: '2026-11-13T00:00:00Z' },
      ),
    ];

    const nowMs = Date.parse('2026-11-13T18:00:00+08:00');
    const notifications = buildNativeLocalNotifications(items, TIME_ZONE, {
      nowMs,
      channelId: ANDROID_NOTIFICATION_CHANNEL_ID,
      isExactNotification: true,
    });

    expect(notifications).toHaveLength(4);
    for (const notif of notifications) {
      expect(Number.isInteger(notif.id)).toBe(true);
      expect(notif.id).toBeGreaterThan(0);
      expect(notif.id).toBeLessThanOrEqual(0x7fffffff);
      expect(notif.schedule?.at?.getTime()).toBeGreaterThan(nowMs);
      expect(notif.schedule?.allowWhileIdle).toBe(true);
      expect(notif.channelId).toBe(ANDROID_NOTIFICATION_CHANNEL_ID);
      expect(notif.extra?.source).toBe('aurastudy');
    }

    // 1) sc-1 before_start at 19:10
    expect(notifications[0].title).toContain('線性代數複習');
    expect(notifications[0].body).toContain('19:30 – 20:30');
    expect(notifications[0].schedule?.at?.getTime()).toBe(
      Date.parse('2026-11-13T19:10:00+08:00'),
    );

    // 2) sc-1 at_end at 20:30 -> next active schedule title ONLY (no time range!)
    expect(notifications[1].title).toBe('行程時間到了');
    expect(notifications[1].body).toBe('下一個行程：英文閱讀練習');
    expect(notifications[1].body).not.toContain('21:00');
    expect(notifications[1].schedule?.at?.getTime()).toBe(
      Date.parse('2026-11-13T20:30:00+08:00'),
    );

    // 3) sc-2 before_start at 20:40
    expect(notifications[2].title).toContain('英文閱讀練習');
    expect(notifications[2].body).toContain('21:00 – 22:00');

    // 4) sc-2 at_end at 22:00
    expect(notifications[3].title).toBe('行程時間到了');
    expect(notifications[3].body).toBe('目前沒有下一個行程');
  });

  it('cancels existing AuraStudy pending notifications before scheduling new ones, and clears all when disabled', async () => {
    const items: CalendarItem[] = [
      createScheduleEntity(
        {
          userId: USER_ID,
          title: '演算法刷題',
          startAt: '2026-11-13T19:30:00+08:00',
          endAt: '2026-11-13T20:30:00+08:00',
        },
        { id: 'sc-algo', now: '2026-11-13T00:00:00Z' },
      ),
    ];

    capacitorMocks.getPending.mockResolvedValueOnce({
      notifications: [
        { id: 101, title: '舊通知', body: '...', extra: { source: 'aurastudy' } },
        { id: 202, title: '外部通知', body: '...', extra: { source: 'other-module' } },
      ],
    });

    const scheduler = new ScheduleNotificationScheduler();
    await scheduler.sync(items, TIME_ZONE, true);

    expect(capacitorMocks.getPending).toHaveBeenCalledTimes(1);
    expect(capacitorMocks.cancel).toHaveBeenCalledWith({
      notifications: [{ id: 101 }],
    });
    expect(capacitorMocks.createChannel).toHaveBeenCalledTimes(1);
    expect(capacitorMocks.schedule).toHaveBeenCalledTimes(1);
    const scheduledPayload = capacitorMocks.schedule.mock.calls[0][0];
    expect(scheduledPayload.notifications).toHaveLength(2);

    // Disabling notifications cancels pending and does not schedule
    capacitorMocks.getPending.mockResolvedValueOnce({
      notifications: [{ id: scheduledPayload.notifications[0].id }],
    });
    await scheduler.sync(items, TIME_ZONE, false);

    expect(capacitorMocks.cancel).toHaveBeenLastCalledWith({
      notifications: [{ id: scheduledPayload.notifications[0].id }],
    });
    expect(capacitorMocks.schedule).toHaveBeenCalledTimes(1);

    scheduler.dispose();
  });

  it('produces deterministic positive 32-bit notification IDs and skips scheduling if permission is denied', async () => {
    expect(toAndroidNotificationId('sc-1:before_start:2026-11-13T19:30:00+08:00')).toBe(
      toAndroidNotificationId('sc-1:before_start:2026-11-13T19:30:00+08:00'),
    );

    capacitorMocks.checkPermissions.mockResolvedValueOnce({ display: 'denied' });
    const scheduled = await syncNativeScheduleNotifications([], TIME_ZONE, true);
    expect(scheduled).toEqual([]);
    expect(capacitorMocks.schedule).not.toHaveBeenCalled();
  });
});
