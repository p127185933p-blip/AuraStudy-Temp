import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildWidgetSnapshot } from '@/domain/planning';
import type { CalendarItem } from '@/domain/schedule';
import {
  WIDGET_SNAPSHOT_STORAGE_KEY,
  readStoredWidgetSnapshot,
  syncWidgetSnapshot,
} from '@/infrastructure/widget';

const NOW_ISO = '2026-11-13T08:00:00+08:00';
const TIME_ZONE = 'Asia/Taipei';

function makeSchedule(
  id: string,
  title: string,
  startAt: string,
  endAt: string,
  status: 'scheduled' | 'completed' | 'cancelled' = 'scheduled',
): CalendarItem {
  return {
    id,
    userId: 'user-1',
    type: 'schedule',
    title,
    startAt,
    endAt,
    status,
    revision: 1,
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
  };
}

function makeDeadline(
  id: string,
  title: string,
  dueDate: string,
  status: 'pending' | 'completed' = 'pending',
): CalendarItem {
  return {
    id,
    userId: 'user-1',
    type: 'deadline',
    title,
    dueDate,
    status,
    revision: 1,
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
  };
}

describe('Phase 6 Widget Summary Domain & Android Bridge', () => {
  afterEach(() => {
    delete window.AuraStudyAndroidBridge;
    delete window.Capacitor;
    window.localStorage.clear();
  });

  it('filters today schedules sorted by startAt (max 4), excludes cancelled, and tracks remainingCount', () => {
    const items: CalendarItem[] = [
      makeSchedule(
        's-late',
        '晚間英文閱讀',
        '2026-11-13T20:00:00+08:00',
        '2026-11-13T21:30:00+08:00',
      ),
      makeSchedule(
        's-cancelled',
        '已取消的討論課',
        '2026-11-13T10:00:00+08:00',
        '2026-11-13T11:00:00+08:00',
        'cancelled',
      ),
      makeSchedule(
        's-morning',
        '線性代數複習',
        '2026-11-13T09:00:00+08:00',
        '2026-11-13T10:30:00+08:00',
      ),
      makeSchedule(
        's-tomorrow',
        '明天的作業實作',
        '2026-11-14T09:00:00+08:00',
        '2026-11-14T11:00:00+08:00',
      ),
      makeSchedule(
        's-afternoon-1',
        '計算機結構筆記',
        '2026-11-13T13:00:00+08:00',
        '2026-11-13T14:30:00+08:00',
      ),
      makeSchedule(
        's-afternoon-2',
        '演算法習題演練',
        '2026-11-13T15:00:00+08:00',
        '2026-11-13T17:00:00+08:00',
      ),
      makeSchedule(
        's-evening',
        '資料結構刷題',
        '2026-11-13T18:30:00+08:00',
        '2026-11-13T19:30:00+08:00',
      ),
    ];

    const snapshot = buildWidgetSnapshot(items, {
      now: NOW_ISO,
      timeZone: TIME_ZONE,
    });

    expect(snapshot.dateLabel).toBe('2026-11-13');
    expect(snapshot.updatedAt).toBe(NOW_ISO);
    expect(snapshot.todaySchedules).toHaveLength(4);
    expect(snapshot.todaySchedules.map((s) => s.id)).toEqual([
      's-morning',
      's-afternoon-1',
      's-afternoon-2',
      's-evening',
    ]);
    expect(snapshot.todaySchedules[0]).toEqual({
      id: 's-morning',
      title: '線性代數複習',
      startTimeLabel: '09:00',
      endTimeLabel: '10:30',
    });
    expect(snapshot.remainingCount).toBe(1);
  });

  it('filters uncompleted deadlines within next 7 days sorted by dueDate (max 3)', () => {
    const items: CalendarItem[] = [
      makeDeadline('d-past', '已過期作業', '2026-11-12'),
      makeDeadline('d-completed', '已完成實驗', '2026-11-14', 'completed'),
      makeDeadline('d-far', '太遠的期末報告', '2026-11-25'),
      makeDeadline('d-day7', '第七天專題簡報', '2026-11-20'),
      makeDeadline('d-day3', '資料結構作業 3', '2026-11-16T23:59:00+08:00'),
      makeDeadline('d-day1', '微積分小考準備', '2026-11-14'),
      makeDeadline('d-today', '演算法作業上傳', '2026-11-13'),
    ];

    const snapshot = buildWidgetSnapshot(items, {
      now: NOW_ISO,
      timeZone: TIME_ZONE,
    });

    expect(snapshot.upcomingDeadlines).toHaveLength(3);
    expect(snapshot.upcomingDeadlines.map((d) => d.id)).toEqual([
      'd-today',
      'd-day1',
      'd-day3',
    ]);
    expect(snapshot.upcomingDeadlines[0].dueDateLabel).toBe('2026-11-13');
    expect(snapshot.upcomingDeadlines[2].dueDateLabel).toBe('2026-11-16 23:59');
  });

  it('syncWidgetSnapshot writes to localStorage and invokes Android WebView & Capacitor bridges', () => {
    const snapshot = buildWidgetSnapshot(
      [
        makeSchedule(
          's-1',
          '專題會議',
          '2026-11-13T10:00:00+08:00',
          '2026-11-13T11:00:00+08:00',
        ),
        makeDeadline('d-1', '系統分析報告', '2026-11-15'),
      ],
      { now: NOW_ISO, timeZone: TIME_ZONE },
    );

    const updateWidgetSnapshot = vi.fn();
    const capPreferencesSet = vi.fn().mockResolvedValue(undefined);

    window.AuraStudyAndroidBridge = { updateWidgetSnapshot };
    window.Capacitor = {
      Plugins: {
        Preferences: {
          set: capPreferencesSet,
        },
      },
    };

    const result = syncWidgetSnapshot(snapshot);

    expect(result).toEqual({
      persistedToLocalStorage: true,
      bridgedToAndroid: true,
      bridgedToCapacitor: true,
    });

    const expectedJson = JSON.stringify(snapshot);
    expect(window.localStorage.getItem(WIDGET_SNAPSHOT_STORAGE_KEY)).toBe(expectedJson);
    expect(readStoredWidgetSnapshot()).toEqual(snapshot);
    expect(updateWidgetSnapshot).toHaveBeenCalledTimes(1);
    expect(updateWidgetSnapshot).toHaveBeenCalledWith(expectedJson);
    expect(capPreferencesSet).toHaveBeenCalledTimes(1);
    expect(capPreferencesSet).toHaveBeenCalledWith({
      key: WIDGET_SNAPSHOT_STORAGE_KEY,
      value: expectedJson,
    });
  });
});
