import { beforeEach, describe, expect, it } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { CalendarProvider } from '@/app';
import { createSchedule } from '@/domain/schedule';
import { LocalStorageCalendarRepository } from '@/infrastructure/repositories';
import { TimelinePage } from '@/pages';

describe('V1.0.1 LocalStorage Standalone Persistence & F5 Reload', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it('persists items in LocalStorageCalendarRepository across re-instantiation and recovers from corrupted storage', async () => {
    const storageKey = 'aurastudy.test.calendar';
    const repo1 = new LocalStorageCalendarRepository({ storageKey });

    const item = createSchedule(
      {
        userId: 'local-user',
        title: '分散式系統複習',
        startAt: '2026-11-13T18:00:00+08:00',
        endAt: '2026-11-13T20:00:00+08:00',
      },
      { id: 'sc-dist-1', now: '2026-11-13T08:00:00Z' },
    );
    await repo1.save(item);

    // Simulate F5 reload with a brand-new repository instance
    const repo2 = new LocalStorageCalendarRepository({ storageKey });
    const reloaded = await repo2.listByUser('local-user');
    expect(reloaded).toHaveLength(1);
    expect(reloaded[0].title).toBe('分散式系統複習');

    // Simulate corrupted JSON in localStorage -> safely recovers without throwing
    window.localStorage.setItem(storageKey, '{not valid json');
    const repo3 = new LocalStorageCalendarRepository({ storageKey });
    expect(await repo3.listByUser('local-user')).toEqual([]);
  });

  it('retains future user schedules and suppresses cleared past demo items across simulated F5 remounts in CalendarProvider local mode', async () => {
    const refNow = new Date('2026-11-13T17:00:00+08:00');
    const firstMount = render(
      <CalendarProvider
        timeZone="Asia/Taipei"
        initialDate="2026-11-13"
        referenceNow={refNow}
        initialViewMode="week"
        seedDemoData
      >
        <TimelinePage />
      </CalendarProvider>,
    );

    // Initial demo seed appears
    await waitFor(() => {
      expect(screen.getByText('線性代數重點複習')).toBeInTheDocument();
    });

    // User creates a new future schedule (19:00-21:00 > 17:00)
    fireEvent.click(screen.getByRole('button', { name: '新增' }));
    fireEvent.change(screen.getByLabelText('標題'), {
      target: { value: '編譯器期末衝刺' },
    });
    fireEvent.change(screen.getByLabelText('日期'), {
      target: { value: '2026-11-13' },
    });
    fireEvent.change(screen.getByLabelText('開始時間'), {
      target: { value: '19:00' },
    });
    fireEvent.change(screen.getByLabelText('結束時間'), {
      target: { value: '21:00' },
    });
    fireEvent.click(screen.getByRole('button', { name: '建立項目' }));

    await waitFor(() => {
      expect(screen.getByText('編譯器期末衝刺')).toBeInTheDocument();
    });

    // Simulate F5 reload: unmount and mount fresh CalendarProvider
    firstMount.unmount();
    cleanup();

    const secondMount = render(
      <CalendarProvider
        timeZone="Asia/Taipei"
        initialDate="2026-11-13"
        referenceNow={refNow}
        initialViewMode="week"
        seedDemoData
      >
        <TimelinePage />
      </CalendarProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('編譯器期末衝刺')).toBeInTheDocument();
      expect(screen.getByText('線性代數重點複習')).toBeInTheDocument();
    });

    // User clears ONLY past items in SettingsModal (2 demo schedules 09:00-10:30, 14:00-16:00)
    fireEvent.click(screen.getByRole('button', { name: '開啟設定' }));
    fireEvent.click(
      screen.getByRole('button', { name: '清除已過期行程（共 2 筆）' }),
    );
    fireEvent.click(screen.getByRole('button', { name: '確認清除已過期行程' }));

    await waitFor(() => {
      expect(screen.queryByText('線性代數重點複習')).not.toBeInTheDocument();
      expect(screen.queryByText('計算機結構實作練習')).not.toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: '關閉設定視窗' }));
    expect(screen.getByText('編譯器期末衝刺')).toBeInTheDocument();
    expect(screen.getByText('演算法作業 3 繳交')).toBeInTheDocument();

    // Simulate F5 reload after clearing past items: past demo items MUST NOT reappear, future items stay
    secondMount.unmount();
    cleanup();

    render(
      <CalendarProvider
        timeZone="Asia/Taipei"
        initialDate="2026-11-13"
        referenceNow={refNow}
        initialViewMode="week"
        seedDemoData
      >
        <TimelinePage />
      </CalendarProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('week-timeline')).toBeInTheDocument();
    });
    expect(screen.queryByText('線性代數重點複習')).not.toBeInTheDocument();
    expect(screen.queryByText('計算機結構實作練習')).not.toBeInTheDocument();
    expect(screen.getByText('演算法作業 3 繳交')).toBeInTheDocument();
    expect(screen.getByText('編譯器期末衝刺')).toBeInTheDocument();
  });
});
