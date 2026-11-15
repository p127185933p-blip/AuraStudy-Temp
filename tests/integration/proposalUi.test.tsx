import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AppShell, CalendarProvider } from '@/app';
import { createSchedule } from '@/domain/schedule';
import { MockAIProvider } from '@/infrastructure/ai';
import {
  InMemoryCalendarRepository,
  InMemoryDecisionLogRepository,
  InMemoryProposalRepository,
} from '@/infrastructure/repositories';
import { TimelinePage } from '@/pages';

function renderPhase3App(options?: {
  initialItems?: ReturnType<typeof createSchedule>[];
  initialDate?: string;
  initialViewMode?: 'month' | 'week' | 'day';
}) {
  const repository = new InMemoryCalendarRepository(options?.initialItems ?? []);
  const proposalRepository = new InMemoryProposalRepository();
  const decisionLogRepository = new InMemoryDecisionLogRepository();
  const aiProvider = new MockAIProvider();

  return {
    repository,
    proposalRepository,
    decisionLogRepository,
    ...render(
      <CalendarProvider
        repository={repository}
        proposalRepository={proposalRepository}
        decisionLogRepository={decisionLogRepository}
        aiProvider={aiProvider}
        userId="ui-student"
        timeZone="+08:00"
        initialDate={options?.initialDate ?? '2026-11-13'}
        initialViewMode={options?.initialViewMode ?? 'week'}
        seedDemoData={false}
      >
        <AppShell>
          <TimelinePage />
        </AppShell>
      </CalendarProvider>,
    ),
  };
}

describe('Phase 3 AI Proposal & Floating Chat UI Integration', () => {
  it('renders green CREATE, diff UPDATE, and red DELETE proposal cards and toggles 💡 explanation popover', async () => {
    const existing1 = createSchedule(
      {
        userId: 'ui-student',
        title: '線性代數重點複習',
        startAt: '2026-11-13T09:00:00+08:00',
        endAt: '2026-11-13T10:30:00+08:00',
      },
      { id: 'sc-lin', now: '2026-11-13T00:00:00+08:00' },
    );
    const existing2 = createSchedule(
      {
        userId: 'ui-student',
        title: '計算機結構練習',
        startAt: '2026-11-13T14:00:00+08:00',
        endAt: '2026-11-13T16:00:00+08:00',
      },
      { id: 'sc-arch', now: '2026-11-13T00:00:00+08:00' },
    );

    renderPhase3App({
      initialItems: [existing1, existing2],
      initialDate: '2026-11-13',
      initialViewMode: 'week',
    });

    await screen.findByTestId('week-timeline');
    const chatInput = screen.getByLabelText('輸入學習規劃指令');
    const sendBtn = screen.getByLabelText('送出規劃指令');

    // 1. Send batch prompt producing UPDATE + CREATE + DELETE
    fireEvent.change(chatInput, {
      target: {
        value: '調整線性代數重點複習改到11:00並安排今天19:00英文複習並刪除計算機結構練習',
      },
    });
    fireEvent.click(sendBtn);

    // Wait for all 3 action cards to render on the Week timeline
    await waitFor(() => {
      expect(screen.getByText('AI 建議調整')).toBeInTheDocument();
      expect(screen.getByText('AI 建議新增')).toBeInTheDocument();
      expect(screen.getByText('AI 建議刪除')).toBeInTheDocument();
    });

    // 2. Click 💡 on the CREATE card to show floating explanation popover, then click again to hide
    const createCard = screen
      .getByText('AI 建議新增')
      .closest('[data-proposal-action="create"]') as HTMLElement;
    const explainBtn = within(createCard).getByLabelText('查看提案理由');
    fireEvent.click(explainBtn);

    const popover = await within(createCard).findByRole('dialog', {
      name: '提案說明',
    });
    expect(popover).toBeInTheDocument();

    fireEvent.click(explainBtn);
    await waitFor(() => {
      expect(within(createCard).queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('supports partial accept (✓), reject (×), and seamless follow-up discussion in the same floating chatbox', async () => {
    const existing = createSchedule(
      {
        userId: 'ui-student',
        title: '線性代數重點複習',
        startAt: '2026-11-13T09:00:00+08:00',
        endAt: '2026-11-13T10:30:00+08:00',
      },
      { id: 'sc-lin', now: '2026-11-13T00:00:00+08:00' },
    );

    const { repository } = renderPhase3App({
      initialItems: [existing],
      initialDate: '2026-11-13',
      initialViewMode: 'week',
    });

    await screen.findByTestId('week-timeline');

    // Ask AI for 2 changes: DELETE existing + CREATE tomorrow study
    const chatInput = screen.getByLabelText('輸入學習規劃指令');
    fireEvent.change(chatInput, {
      target: { value: '刪除線性代數重點複習並安排明天下午讀書' },
    });
    fireEvent.click(screen.getByLabelText('送出規劃指令'));

    await waitFor(() => {
      expect(screen.getByText('AI 建議刪除')).toBeInTheDocument();
      expect(screen.getByText('AI 建議新增')).toBeInTheDocument();
    });

    // Accept ONLY the DELETE proposal via ✓
    const deleteCard = screen
      .getByText('AI 建議刪除')
      .closest('[data-proposal-action="delete"]') as HTMLElement;
    fireEvent.click(within(deleteCard).getByLabelText('接受提案'));

    await waitFor(async () => {
      expect(await repository.findById('sc-lin')).toBeNull();
    });

    // Reject the CREATE proposal via ×
    const createCard = screen
      .getByText('AI 建議新增')
      .closest('[data-proposal-action="create"]') as HTMLElement;
    fireEvent.click(within(createCard).getByLabelText('拒絕提案'));

    await waitFor(() => {
      expect(screen.queryByText('AI 建議新增')).not.toBeInTheDocument();
    });

    // Directly continue discussing in the same bottom floating chatbox
    fireEvent.change(screen.getByLabelText('輸入學習規劃指令'), {
      target: { value: '我剛剛按叉的那項，改到週三 16:00' },
    });
    fireEvent.click(screen.getByLabelText('送出規劃指令'));

    // Navigate to next week (2026-11-16..22) where Wednesday 2026-11-18 sits
    fireEvent.click(screen.getByLabelText('下一段'));

    // New revised proposal appears (Wednesday 2026-11-18 16:00)
    await waitFor(() => {
      expect(screen.getByText('AI 建議新增')).toBeInTheDocument();
    });
    const revisedCard = screen
      .getByText('AI 建議新增')
      .closest('[data-proposal-action="create"]') as HTMLElement;
    expect(revisedCard).toHaveTextContent('2026-11-18 16:00');

    // Accept the revised proposal via ✓
    fireEvent.click(within(revisedCard).getByLabelText('接受提案'));
    await waitFor(async () => {
      const items = await repository.listByUser('ui-student');
      expect(items).toHaveLength(1);
      expect(items[0].type).toBe('schedule');
    });
  });

  it('continues from rejected proposal across weeks and accepts revised proposal, plus disables ✓ when stale', async () => {
    const existing = createSchedule(
      {
        userId: 'ui-student',
        title: '微積分練習',
        startAt: '2026-11-13T09:00:00+08:00',
        endAt: '2026-11-13T10:30:00+08:00',
      },
      { id: 'sc-calc', now: '2026-11-13T00:00:00+08:00' },
    );

    const { repository } = renderPhase3App({
      initialItems: [existing],
      initialDate: '2026-11-13',
      initialViewMode: 'week',
    });

    await screen.findByTestId('week-timeline');

    // 1. Request UPDATE for 微積分練習
    fireEvent.change(screen.getByLabelText('輸入學習規劃指令'), {
      target: { value: '調整微積分練習到 11:00' },
    });
    fireEvent.click(screen.getByLabelText('送出規劃指令'));

    await waitFor(() => {
      expect(screen.getByText('AI 建議調整')).toBeInTheDocument();
    });

    // 2. Manually edit 微積分練習 via ItemEditorModal -> proposal becomes STALE and ✓ is disabled!
    fireEvent.click(screen.getByTestId('calendar-card-sc-calc').querySelector('button')!);
    const editDialog = await screen.findByRole('dialog');
    fireEvent.change(within(editDialog).getByLabelText('標題'), {
      target: { value: '微積分進階練習' },
    });
    fireEvent.click(within(editDialog).getByRole('button', { name: '儲存變更' }));

    await waitFor(() => {
      expect(screen.getByText('已過期（資料已變更）')).toBeInTheDocument();
    });

    const staleCard = screen
      .getByText('已過期（資料已變更）')
      .closest('[data-proposal-status="stale"]') as HTMLElement;
    expect(within(staleCard).getByLabelText('接受提案')).toBeDisabled();

    // Dismiss stale card via ×
    fireEvent.click(within(staleCard).getByLabelText('拒絕提案'));
    await waitFor(() => {
      expect(screen.queryByText('已過期（資料已變更）')).not.toBeInTheDocument();
    });

    // 3. Create + Reject + Follow-up to 週日 (2026-11-15, same week) -> Accept!
    fireEvent.change(screen.getByLabelText('輸入學習規劃指令'), {
      target: { value: '安排明天下午英文讀書' },
    });
    fireEvent.click(screen.getByLabelText('送出規劃指令'));

    await waitFor(() => {
      expect(screen.getByText('AI 建議新增')).toBeInTheDocument();
    });

    const firstCreate = screen
      .getByText('AI 建議新增')
      .closest('[data-proposal-action="create"]') as HTMLElement;
    fireEvent.click(within(firstCreate).getByLabelText('拒絕提案'));
    await waitFor(() => {
      expect(screen.queryByText('AI 建議新增')).not.toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('輸入學習規劃指令'), {
      target: { value: '我剛剛按叉的那項改到週日 16:00' },
    });
    fireEvent.click(screen.getByLabelText('送出規劃指令'));

    await waitFor(() => {
      expect(screen.getByText('AI 建議新增')).toBeInTheDocument();
    });
    const revisedCreate = screen
      .getByText('AI 建議新增')
      .closest('[data-proposal-action="create"]') as HTMLElement;
    expect(revisedCreate).toHaveTextContent('2026-11-15 16:00');

    fireEvent.click(within(revisedCreate).getByLabelText('接受提案'));
    await waitFor(async () => {
      const items = await repository.listByUser('ui-student');
      expect(items).toHaveLength(2);
    });
  });
});
