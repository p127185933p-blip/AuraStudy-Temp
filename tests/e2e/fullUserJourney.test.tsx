import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { CalendarProvider } from '@/app';
import { isDeadline, isSchedule } from '@/domain/schedule';
import {
  InMemoryCalendarRepository,
  InMemoryDecisionLogRepository,
  InMemoryProposalRepository,
} from '@/infrastructure/repositories';
import { TimelinePage } from '@/pages';

describe('Phase 5 E2E — Part 14 Full 10-Step User Journey & Backup/Restore', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
  });

  it('completes the full 10-step E2E workflow and JSON backup/restore round-trip', async () => {
    const calendarRepo = new InMemoryCalendarRepository();
    const proposalRepo = new InMemoryProposalRepository();
    const decisionRepo = new InMemoryDecisionLogRepository();

    // Capture downloaded backup JSON via Blob interception
    let capturedBackupJson = '';
    const originalBlob = globalThis.Blob;
    const blobSpy = vi
      .spyOn(globalThis, 'Blob')
      .mockImplementation(function (
        parts?: BlobPart[],
        options?: BlobPropertyBag,
      ) {
        if (options?.type === 'application/json' && Array.isArray(parts)) {
          capturedBackupJson = parts.map((p) => String(p)).join('');
        }
        return new originalBlob(parts, options);
      } as unknown as typeof Blob);
    const originalCreateObjectUrl = URL.createObjectURL;
    const originalRevokeObjectUrl = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:mock-aurastudy-backup');
    URL.revokeObjectURL = vi.fn();

    try {
      const { container } = render(
        <CalendarProvider
          repository={calendarRepo}
          proposalRepository={proposalRepo}
          decisionLogRepository={decisionRepo}
          timeZone="Asia/Taipei"
          initialDate="2026-11-13"
          initialViewMode="week"
          seedDemoData={false}
        >
          <TimelinePage />
        </CalendarProvider>,
      );

      const getProposalCards = () =>
        Array.from(container.querySelectorAll<HTMLElement>('[data-proposal-action]'));

      await waitFor(() => {
        expect(screen.getByTestId('week-timeline')).toBeInTheDocument();
      });

      // Step 1: Create a Deadline
      fireEvent.click(screen.getByRole('button', { name: '新增' }));
      fireEvent.click(screen.getByRole('button', { name: 'Deadline 截止事項' }));
      fireEvent.change(screen.getByLabelText('標題'), {
        target: { value: '期末專題計畫書繳交' },
      });
      fireEvent.change(screen.getByLabelText('截止日期'), {
        target: { value: '2026-11-15' },
      });
      fireEvent.click(screen.getByRole('button', { name: '建立項目' }));

      await waitFor(() => {
        expect(screen.getByText('期末專題計畫書繳交')).toBeInTheDocument();
      });

      // Step 2: Create a Schedule
      fireEvent.click(screen.getByRole('button', { name: '新增' }));
      fireEvent.change(screen.getByLabelText('標題'), {
        target: { value: '資料結構複習' },
      });
      fireEvent.change(screen.getByLabelText('日期'), {
        target: { value: '2026-11-13' },
      });
      fireEvent.change(screen.getByLabelText('開始時間'), {
        target: { value: '09:00' },
      });
      fireEvent.change(screen.getByLabelText('結束時間'), {
        target: { value: '10:30' },
      });
      fireEvent.click(screen.getByRole('button', { name: '建立項目' }));

      await waitFor(() => {
        expect(screen.getByText('資料結構複習')).toBeInTheDocument();
      });

      // Step 3: Switch Month -> Day -> Week views, verifying data consistency & selectedDate preservation
      fireEvent.click(screen.getByRole('button', { name: '月' }));
      expect(screen.getByTestId('month-timeline')).toBeInTheDocument();
      expect(screen.getByText('2026-11-13（週五）摘要')).toBeInTheDocument();
      expect(screen.getAllByText(/資料結構複習/).length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText(/期末專題計畫書繳交/)).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: '日' }));
      expect(screen.getByTestId('day-timeline')).toBeInTheDocument();
      expect(screen.getByText('資料結構複習')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: '週' }));
      expect(screen.getByTestId('week-timeline')).toBeInTheDocument();
      expect(screen.getByText('資料結構複習')).toBeInTheDocument();
      expect(screen.getByText('期末專題計畫書繳交')).toBeInTheDocument();

      // Step 4: Manually update the existing Schedule and verify revision increment
      fireEvent.click(screen.getByText('資料結構複習'));
      fireEvent.change(screen.getByLabelText('標題'), {
        target: { value: '資料結構樹狀圖精讀' },
      });
      fireEvent.change(screen.getByLabelText('開始時間'), {
        target: { value: '10:00' },
      });
      fireEvent.change(screen.getByLabelText('結束時間'), {
        target: { value: '11:30' },
      });
      fireEvent.click(screen.getByRole('button', { name: '儲存變更' }));

      await waitFor(() => {
        expect(screen.getByText('資料結構樹狀圖精讀')).toBeInTheDocument();
      });
      const itemsAfterEdit = await calendarRepo.listByUser('demo-student');
      const editedSchedule = itemsAfterEdit.find(
        (i) => i.title === '資料結構樹狀圖精讀',
      );
      expect(editedSchedule?.revision).toBe(2);

      // Step 5: Send prompt via FloatingAIChat producing multi-change proposals
      const chatInput = screen.getByLabelText('輸入學習規劃指令');
      fireEvent.change(chatInput, {
        target: { value: '安排今天下午英文閱讀並且新增明天作業報告截止' },
      });
      fireEvent.click(screen.getByRole('button', { name: '送出規劃指令' }));

      await waitFor(() => {
        expect(getProposalCards()).toHaveLength(2);
      });

      const proposalCards = getProposalCards();

      // Step 6: Click ✓ to accept partial proposal (作業報告 Deadline)
      const reportCard = proposalCards.find((card) =>
        within(card).queryByText('作業報告'),
      )!;
      expect(reportCard).toBeDefined();
      fireEvent.click(within(reportCard).getByRole('button', { name: '接受提案' }));

      await waitFor(() => {
        expect(getProposalCards()).toHaveLength(1);
      });
      expect(screen.getByText('作業報告')).toBeInTheDocument();

      // Step 7: Click × to reject the other proposal (英文閱讀 Schedule)
      const remainingCard = getProposalCards()[0];
      expect(within(remainingCard).getByText('英文閱讀')).toBeInTheDocument();
      fireEvent.click(within(remainingCard).getByRole('button', { name: '拒絕提案' }));

      await waitFor(() => {
        expect(getProposalCards()).toHaveLength(0);
      });
      expect(screen.getByText(/剛拒絕「英文閱讀」/)).toBeInTheDocument();

      // Step 8 & 9: Continue discussing the rejected proposal in the same chatbox -> new proposal appears
      fireEvent.change(screen.getByLabelText('輸入學習規劃指令'), {
        target: { value: '把剛剛拒絕的那項改成今天 18:00-19:30' },
      });
      fireEvent.click(screen.getByRole('button', { name: '送出規劃指令' }));

      await waitFor(() => {
        expect(getProposalCards()).toHaveLength(1);
      });
      const revisedCard = getProposalCards()[0];
      expect(within(revisedCard).getByText('英文閱讀')).toBeInTheDocument();
      expect(within(revisedCard).getByText(/18:00 – 20:00/)).toBeInTheDocument();

      // Step 10: Click ✓ to accept the revised proposal and verify final formal state
      fireEvent.click(within(revisedCard).getByRole('button', { name: '接受提案' }));

      await waitFor(() => {
        expect(getProposalCards()).toHaveLength(0);
      });

      const finalItems = await calendarRepo.listByUser('demo-student');
      expect(finalItems).toHaveLength(4);
      expect(finalItems.filter(isDeadline)).toHaveLength(2);
      expect(finalItems.filter(isSchedule)).toHaveLength(2);
      expect(finalItems.map((i) => i.title).sort()).toEqual(
        [
          '作業報告',
          '期末專題計畫書繳交',
          '英文閱讀',
          '資料結構樹狀圖精讀',
        ].sort(),
      );

      // Step 11: Backup & Restore E2E Verification
      fireEvent.click(screen.getByRole('button', { name: '開啟設定' }));
      expect(screen.getByTestId('settings-modal')).toBeInTheDocument();

      // Export backup JSON
      fireEvent.click(screen.getByRole('button', { name: '匯出備份（.json）' }));
      await waitFor(() => {
        expect(screen.getByTestId('backup-feedback')).toHaveTextContent(
          /已匯出 4 筆正式行程備份/,
        );
      });
      expect(capturedBackupJson).toContain('期末專題計畫書繳交');
      expect(capturedBackupJson).toContain('資料結構樹狀圖精讀');

      // All 4 items are in the future, so clear-past button must be disabled
      expect(
        screen.getByRole('button', { name: '清除已過期行程（共 0 筆）' }),
      ).toBeDisabled();

      // Close settings and delete all 4 items via ItemEditorModal before testing clean restore
      fireEvent.click(screen.getByRole('button', { name: '關閉設定視窗' }));
      for (const titleToDelete of [
        '作業報告',
        '期末專題計畫書繳交',
        '英文閱讀',
        '資料結構樹狀圖精讀',
      ]) {
        fireEvent.click(screen.getByText(titleToDelete));
        fireEvent.click(screen.getByRole('button', { name: '刪除' }));
        fireEvent.click(screen.getByRole('button', { name: '確認刪除' }));
        await waitFor(() => {
          expect(screen.queryByText(titleToDelete)).not.toBeInTheDocument();
        });
      }

      await waitFor(async () => {
        expect(await calendarRepo.listByUser('demo-student')).toHaveLength(0);
      });

      fireEvent.click(screen.getByRole('button', { name: '開啟設定' }));
      expect(screen.getByTestId('settings-modal')).toBeInTheDocument();

      // Attempt importing corrupted JSON -> safely rejected
      const backupFileInput = screen.getByLabelText(
        '選擇備份 JSON 檔案',
      ) as HTMLInputElement;
      const corruptedFile = new File(
        ['{ invalid json !!!'],
        'corrupted.json',
        { type: 'application/json' },
      );
      fireEvent.change(backupFileInput, { target: { files: [corruptedFile] } });
      await waitFor(() => {
        expect(screen.getByTestId('backup-feedback')).toHaveTextContent(
          /不是有效的 JSON 格式/,
        );
      });
      expect(await calendarRepo.listByUser('demo-student')).toHaveLength(0);

      // Import valid backup JSON -> all 4 items cleanly restored
      const validBackupFile = new File(
        [capturedBackupJson],
        'aurastudy-backup.json',
        { type: 'application/json' },
      );
      fireEvent.change(backupFileInput, { target: { files: [validBackupFile] } });

      await waitFor(() => {
        expect(screen.getByTestId('backup-feedback')).toHaveTextContent(
          /已成功還原 4 筆行程（2 筆截止事項、2 筆排程時段）/,
        );
      });

      const restoredItems = await calendarRepo.listByUser('demo-student');
      expect(restoredItems).toHaveLength(4);
      expect(restoredItems.map((i) => i.title).sort()).toEqual(
        [
          '作業報告',
          '期末專題計畫書繳交',
          '英文閱讀',
          '資料結構樹狀圖精讀',
        ].sort(),
      );
      expect(restoredItems.every((i) => i.revision === 1)).toBe(true);
    } finally {
      blobSpy.mockRestore();
      URL.createObjectURL = originalCreateObjectUrl;
      URL.revokeObjectURL = originalRevokeObjectUrl;
    }
  });
});
