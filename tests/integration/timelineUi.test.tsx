import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AppShell, CalendarProvider } from '@/app';
import { createSchedule } from '@/domain/schedule';
import { InMemoryCalendarRepository } from '@/infrastructure/repositories';
import { TimelinePage } from '@/pages';

function renderTimelineApp(options?: {
  repository?: InMemoryCalendarRepository;
  initialDate?: string;
  initialViewMode?: 'month' | 'week' | 'day';
  seedDemoData?: boolean;
}) {
  const repository = options?.repository ?? new InMemoryCalendarRepository();
  return {
    repository,
    ...render(
      <CalendarProvider
        repository={repository}
        userId="test-student"
        timeZone="+08:00"
        initialDate={options?.initialDate ?? '2026-11-13'}
        initialViewMode={options?.initialViewMode ?? 'week'}
        seedDemoData={options?.seedDemoData ?? false}
      >
        <AppShell>
          <TimelinePage />
        </AppShell>
      </CalendarProvider>,
    ),
  };
}

describe('Phase 2 Timeline UI Integration', () => {
  it('shares the same items and preserves selectedDate across Month, Week, and Day views', async () => {
    const existing = createSchedule(
      {
        userId: 'test-student',
        title: '資料結構複習',
        startAt: '2026-11-13T09:00:00+08:00',
        endAt: '2026-11-13T10:30:00+08:00',
      },
      { id: 'sc-shared', now: '2026-11-13T00:00:00+08:00' },
    );
    const repo = new InMemoryCalendarRepository([existing]);

    renderTimelineApp({ repository: repo, initialDate: '2026-11-13', initialViewMode: 'week' });

    // Week view shows range & item
    await screen.findByTestId('week-timeline');
    expect(screen.getByTestId('timeline-range-title')).toHaveTextContent(
      '2026年 11月9日 – 15日',
    );
    expect(screen.getByText('資料結構複習')).toBeInTheDocument();

    // Switch to Month view -> preserves Nov 2026 & shows item
    fireEvent.click(screen.getByRole('button', { name: '月' }));
    await screen.findByTestId('month-timeline');
    expect(screen.getByTestId('timeline-range-title')).toHaveTextContent('2026年11月');
    expect(screen.getAllByText(/資料結構複習/).length).toBeGreaterThan(0);

    // Click another day (2026-11-18) cell to select it, then click its day button to jump to Day view
    const nov18Cell = screen.getByTestId('month-cell-2026-11-18');
    fireEvent.click(nov18Cell);
    fireEvent.click(screen.getByRole('button', { name: '查看 2026-11-18 日視圖' }));

    await screen.findByTestId('day-timeline');
    expect(screen.getByTestId('timeline-range-title')).toHaveTextContent(
      '2026年11月18日 週三',
    );

    // Navigate back to Today (2026-11-13) -> Day view displays the shared schedule
    fireEvent.click(screen.getByRole('button', { name: '今天' }));
    expect(screen.getByTestId('timeline-range-title')).toHaveTextContent(
      '2026年11月13日 週五',
    );
    expect(screen.getByText('資料結構複習')).toBeInTheDocument();
  });

  it('creates both Deadline and Schedule via UI and displays them across all three views', async () => {
    renderTimelineApp({ initialDate: '2026-11-13', initialViewMode: 'day' });
    await screen.findByTestId('day-timeline');

    // 1. Create a Deadline
    fireEvent.click(screen.getByRole('button', { name: '新增' }));
    const dialog1 = await screen.findByRole('dialog');
    fireEvent.click(within(dialog1).getByRole('button', { name: 'Deadline 截止事項' }));
    fireEvent.change(within(dialog1).getByLabelText('標題'), {
      target: { value: '作業系統報告截止' },
    });
    fireEvent.change(within(dialog1).getByLabelText('截止日期'), {
      target: { value: '2026-11-13' },
    });
    fireEvent.click(within(dialog1).getByRole('button', { name: '建立項目' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(screen.getByText('作業系統報告截止')).toBeInTheDocument();

    // 2. Create a Schedule
    fireEvent.click(screen.getByRole('button', { name: '新增' }));
    const dialog2 = await screen.findByRole('dialog');
    fireEvent.change(within(dialog2).getByLabelText('標題'), {
      target: { value: '微積分專題研討' },
    });
    fireEvent.change(within(dialog2).getByLabelText('開始時間'), {
      target: { value: '10:00' },
    });
    fireEvent.change(within(dialog2).getByLabelText('結束時間'), {
      target: { value: '11:30' },
    });
    fireEvent.click(within(dialog2).getByRole('button', { name: '建立項目' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(screen.getByText('微積分專題研討')).toBeInTheDocument();
    expect(screen.getByText('10:00 – 11:30')).toBeInTheDocument();

    // Verify in Week view
    fireEvent.click(screen.getByRole('button', { name: '週' }));
    await screen.findByTestId('week-timeline');
    expect(screen.getByText('作業系統報告截止')).toBeInTheDocument();
    expect(screen.getByText('微積分專題研討')).toBeInTheDocument();

    // Verify in Month view
    fireEvent.click(screen.getByRole('button', { name: '月' }));
    await screen.findByTestId('month-timeline');
    expect(screen.getAllByText(/作業系統報告截止/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/微積分專題研討/).length).toBeGreaterThan(0);
  });

  it('handles editing, deleting, and TIME_CONFLICT with allowConflict override', async () => {
    const existing = createSchedule(
      {
        userId: 'test-student',
        title: '物理實驗課',
        startAt: '2026-11-13T09:00:00+08:00',
        endAt: '2026-11-13T11:00:00+08:00',
      },
      { id: 'sc-physics', now: '2026-11-13T00:00:00+08:00' },
    );
    const repo = new InMemoryCalendarRepository([existing]);
    renderTimelineApp({ repository: repo, initialDate: '2026-11-13', initialViewMode: 'day' });
    await screen.findByText('物理實驗課');

    // Attempt to create overlapping Schedule (10:00 - 12:00)
    fireEvent.click(screen.getByRole('button', { name: '新增' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('標題'), {
      target: { value: '英文口說練習' },
    });
    fireEvent.change(within(dialog).getByLabelText('開始時間'), {
      target: { value: '10:00' },
    });
    fireEvent.change(within(dialog).getByLabelText('結束時間'), {
      target: { value: '12:00' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: '建立項目' }));

    // Conflict alert should appear listing conflicting item
    const conflictAlert = await within(dialog).findByTestId('time-conflict-alert');
    expect(conflictAlert).toHaveTextContent('物理實驗課');
    expect(conflictAlert).toHaveTextContent('09:00 – 11:00');

    // Click "仍要排程" to force schedule with allowConflict: true
    fireEvent.click(within(conflictAlert).getByRole('button', { name: '仍要排程' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(screen.getByText('英文口說練習')).toBeInTheDocument();

    // Delete "英文口說練習" with inline confirmation
    fireEvent.click(screen.getByText('英文口說練習'));
    const deleteDialog = await screen.findByRole('dialog');
    fireEvent.click(within(deleteDialog).getByRole('button', { name: '刪除' }));
    fireEvent.click(within(deleteDialog).getByRole('button', { name: '確認刪除' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(screen.queryByText('英文口說練習')).not.toBeInTheDocument();

    // Edit "物理實驗課" title
    fireEvent.click(screen.getByText('物理實驗課'));
    const editDialog = await screen.findByRole('dialog');
    fireEvent.change(within(editDialog).getByLabelText('標題'), {
      target: { value: '近代物理實驗課' },
    });
    fireEvent.click(within(editDialog).getByRole('button', { name: '儲存變更' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(screen.getByText('近代物理實驗課')).toBeInTheDocument();
  });

  it('reschedules a Schedule in Day view via drag handle and persists updated time through Application layer', async () => {
    const existing = createSchedule(
      {
        userId: 'test-student',
        title: '離散數學自習',
        startAt: '2026-11-13T09:00:00+08:00',
        endAt: '2026-11-13T10:00:00+08:00',
      },
      { id: 'sc-drag', now: '2026-11-13T00:00:00+08:00' },
    );
    const repo = new InMemoryCalendarRepository([existing]);

    renderTimelineApp({ repository: repo, initialDate: '2026-11-13', initialViewMode: 'day' });
    const dragHandle = await screen.findByTestId('drag-handle-sc-drag');

    // Drag downward by 64px (= 1 hour at DAY_TIMELINE_HOUR_HEIGHT = 64) -> 10:00 - 11:00
    fireEvent.pointerDown(dragHandle, { clientY: 100, pointerId: 1 });
    fireEvent(window, new PointerEvent('pointermove', { clientY: 164, pointerId: 1 }));
    expect(screen.getByText('10:00 – 11:00')).toBeInTheDocument();

    fireEvent(window, new PointerEvent('pointerup', { clientY: 164, pointerId: 1 }));

    await waitFor(async () => {
      const updated = await repo.findById('sc-drag');
      expect(updated?.revision).toBe(2);
      if (updated?.type === 'schedule') {
        expect(updated.startAt).toBe('2026-11-13T10:00:00+08:00');
        expect(updated.endAt).toBe('2026-11-13T11:00:00+08:00');
      }
    });

    expect(screen.getByText('10:00 – 11:00')).toBeInTheDocument();
  });
});
