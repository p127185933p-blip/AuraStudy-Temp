import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CalendarProvider } from '@/app';
import { NOTIFICATIONS_ENABLED_STORAGE_KEY } from '@/infrastructure/notifications';
import {
  InMemoryCalendarRepository,
  InMemoryDecisionLogRepository,
  InMemoryProposalRepository,
} from '@/infrastructure/repositories';
import { SettingsModal } from '@/features/settings';
import { TimelinePage } from '@/pages';
import { THEME_COLOR_BY_MODE, THEME_STORAGE_KEY } from '@/shared/utils';

describe('Phase 4 SettingsModal, BYOK Locking & Data Clear UI', () => {
  const originalNotification = window.Notification;

  beforeEach(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  afterEach(() => {
    Object.defineProperty(window, 'Notification', {
      configurable: true,
      writable: true,
      value: originalNotification,
    });
  });

  function renderPhase4Page(options?: {
    seedDemoData?: boolean;
    referenceNow?: Date;
  }) {
    const calendarRepo = new InMemoryCalendarRepository();
    const proposalRepo = new InMemoryProposalRepository();
    const decisionRepo = new InMemoryDecisionLogRepository();

    render(
      <CalendarProvider
        repository={calendarRepo}
        proposalRepository={proposalRepo}
        decisionLogRepository={decisionRepo}
        timeZone="Asia/Taipei"
        initialDate="2026-11-13"
        referenceNow={options?.referenceNow}
        initialViewMode="week"
        seedDemoData={options?.seedDemoData ?? true}
      >
        <TimelinePage />
      </CalendarProvider>,
    );
  }

  it('locks FloatingAIChat when switching to Gemini without API key and unlocks after saving key', async () => {
    renderPhase4Page();

    await waitFor(() => {
      expect(screen.getByText('線性代數重點複習')).toBeInTheDocument();
    });

    // Open Settings via header button
    fireEvent.click(screen.getByRole('button', { name: '開啟設定' }));
    expect(screen.getByTestId('settings-modal')).toBeInTheDocument();
    expect(screen.getByTestId('local-preview-mode-banner')).toBeInTheDocument();
    expect(
      screen.getByText(/隱私權與第三方資料傳輸告知/),
    ).toBeInTheDocument();

    // Select Google Gemini without entering an API Key
    fireEvent.click(screen.getByLabelText(/Google Gemini/));
    fireEvent.click(screen.getByRole('button', { name: '關閉設定視窗' }));

    // FloatingAIChat should now be in locked disabled state
    const chatAside = screen.getByTestId('floating-ai-chat');
    expect(chatAside).toHaveAttribute('data-disabled', 'true');
    expect(screen.getByTestId('ai-chat-locked-banner')).toBeInTheDocument();
    expect(screen.getByLabelText('輸入學習規劃指令')).toBeDisabled();

    // Click "前往設定 API Key" button inside the chat banner
    fireEvent.click(screen.getByRole('button', { name: '前往設定 API Key' }));
    expect(screen.getByTestId('settings-modal')).toBeInTheDocument();

    // Enter a Gemini API Key and save
    fireEvent.change(screen.getByLabelText('輸入 API Key'), {
      target: { value: 'AIzaSyFakeUiTestKey123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: '儲存 Key' }));
    fireEvent.click(screen.getByRole('button', { name: '關閉設定視窗' }));

    // FloatingAIChat is immediately unlocked
    expect(screen.getByTestId('floating-ai-chat')).toHaveAttribute(
      'data-disabled',
      'false',
    );
    expect(screen.queryByTestId('ai-chat-locked-banner')).not.toBeInTheDocument();
    expect(screen.getByLabelText('輸入學習規劃指令')).not.toBeDisabled();
  });

  it('rejects oversized or unsupported file attachments in FloatingAIChat UI', async () => {
    renderPhase4Page({ seedDemoData: false });

    await waitFor(() => {
      expect(screen.getByTestId('floating-ai-chat')).toBeInTheDocument();
    });

    const fileInput = screen.getByLabelText('選擇附件檔案') as HTMLInputElement;
    const pdfFile = new File(['%PDF-1.4'], 'syllabus.pdf', {
      type: 'application/pdf',
    });

    fireEvent.change(fileInput, { target: { files: [pdfFile] } });

    await waitFor(() => {
      expect(screen.getByTestId('chat-attachment-error')).toHaveTextContent(
        /不支援的檔案格式/,
      );
    });
  });

  it('clears only past items in SettingsModal while preserving future items and disabling when pastCount is 0', async () => {
    // At 17:00 on 2026-11-13, the two seeded schedules (09:00-10:30, 14:00-16:00) are past,
    // while the seeded deadline (2026-11-15) is in the future.
    renderPhase4Page({
      seedDemoData: true,
      referenceNow: new Date('2026-11-13T17:00:00+08:00'),
    });

    await waitFor(() => {
      expect(screen.getByText('線性代數重點複習')).toBeInTheDocument();
      expect(screen.getByText('演算法作業 3 繳交')).toBeInTheDocument();
    });

    // Past items have muted card metadata and line-through on title, but remain clickable
    const pastCard = screen.getByTestId(
      screen.getByText('線性代數重點複習').closest('[data-testid^="calendar-card-"]')!.getAttribute('data-testid')!,
    );
    expect(pastCard).toHaveAttribute('data-item-past', 'true');
    expect(pastCard.className).toContain('opacity-60');
    expect(screen.getByText('線性代數重點複習').className).toContain('line-through');

    // Today's time indicator line is visible
    expect(screen.getByTestId('current-time-indicator')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '開啟設定' }));
    const clearBtn = screen.getByRole('button', {
      name: '清除已過期行程（共 2 筆）',
    });
    expect(clearBtn).not.toBeDisabled();
    fireEvent.click(clearBtn);

    expect(
      screen.getByText(
        '將刪除 2 筆已結束的過去行程與截止日期，進行中與未來的排程將完整保留。',
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '確認清除已過期行程' }));

    await waitFor(() => {
      expect(screen.getByTestId('clear-past-feedback')).toHaveTextContent(
        /已清除 2 筆已過期行程/,
      );
      expect(
        screen.getByRole('button', { name: '清除已過期行程（共 0 筆）' }),
      ).toBeDisabled();
    });

    fireEvent.click(screen.getByRole('button', { name: '關閉設定視窗' }));

    await waitFor(() => {
      expect(screen.queryByText('線性代數重點複習')).not.toBeInTheDocument();
      expect(screen.queryByText('計算機結構實作練習')).not.toBeInTheDocument();
      // Future deadline remains intact
      expect(screen.getByText('演算法作業 3 繳交')).toBeInTheDocument();
    });
  });

  it('switches between light and dark themes and updates DOM dataset, theme-color meta, and localStorage', async () => {
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'theme-color');
      meta.setAttribute('content', THEME_COLOR_BY_MODE.light);
      document.head.appendChild(meta);
    }

    renderPhase4Page({ seedDemoData: false });

    await waitFor(() => {
      expect(screen.getByTestId('week-timeline')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: '開啟設定' }));
    const darkBtn = screen.getByRole('button', { name: '黑色模式（深色）' });
    const lightBtn = screen.getByRole('button', { name: '白色模式（淺色）' });

    expect(lightBtn).toHaveAttribute('aria-pressed', 'true');
    expect(darkBtn).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(darkBtn);
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(meta.getAttribute('content')).toBe(THEME_COLOR_BY_MODE.dark);
    expect(darkBtn).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(lightBtn);
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    expect(meta.getAttribute('content')).toBe(THEME_COLOR_BY_MODE.light);
  });

  it('requests notification permission when enabling smart notifications and reverts toggle on denial', async () => {
    const requestPermissionMock = vi
      .fn<() => Promise<NotificationPermission>>()
      .mockResolvedValueOnce('denied')
      .mockResolvedValueOnce('granted');

    const MockNotification = vi.fn() as unknown as typeof Notification;
    Object.defineProperty(MockNotification, 'permission', {
      configurable: true,
      get: () => 'default' as NotificationPermission,
    });
    Object.defineProperty(MockNotification, 'requestPermission', {
      configurable: true,
      value: requestPermissionMock,
    });
    Object.defineProperty(window, 'Notification', {
      configurable: true,
      writable: true,
      value: MockNotification,
    });

    renderPhase4Page({ seedDemoData: false });
    await waitFor(() => {
      expect(screen.getByTestId('week-timeline')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: '開啟設定' }));
    const toggle = screen.getByRole('switch', { name: '行程提醒通知' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');

    // First attempt: user denies permission -> switch stays OFF and shows guidance
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(screen.getByTestId('notification-feedback')).toHaveTextContent(
        /允許 AuraStudy 通知權限/,
      );
    });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(window.localStorage.getItem(NOTIFICATIONS_ENABLED_STORAGE_KEY)).toBe('false');

    // Second attempt: user grants permission -> switch turns ON and persists
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(toggle).toHaveAttribute('aria-checked', 'true');
    });
    expect(window.localStorage.getItem(NOTIFICATIONS_ENABLED_STORAGE_KEY)).toBe('true');
  });

  it('translates common Supabase Auth errors to Traditional Chinese and shows confirmation prompt on signup', async () => {
    const onSignIn = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, message: '登入失敗：Invalid login credentials' })
      .mockResolvedValueOnce({ ok: false, message: '登入失敗：Email not confirmed' });
    const onSignUp = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, message: '註冊失敗：User already registered' })
      .mockResolvedValueOnce({
        ok: false,
        message: '註冊失敗：Password should be at least 6 characters',
      })
      .mockResolvedValueOnce({
        ok: true,
        message: '註冊成功！請至信箱點擊驗證連結後再登入',
      });

    render(
      <SettingsModal
        isOpen={true}
        onClose={vi.fn()}
        isSupabaseMode={true}
        authUserEmail={null}
        isAuthBusy={false}
        onSignIn={onSignIn}
        onSignUp={onSignUp}
        onSignOut={vi.fn().mockResolvedValue(undefined)}
        pastCount={0}
        onClearPastData={vi.fn().mockResolvedValue(0)}
        onExportBackup={vi.fn().mockResolvedValue({
          version: 1,
          exportedAt: '2026-11-14T00:00:00Z',
          items: [],
        })}
        onImportBackup={vi.fn().mockResolvedValue({
          ok: true,
          data: { importedCount: 0, deadlinesCount: 0, schedulesCount: 0, items: [] },
        })}
        aiProviderType="demo"
        hasSavedApiKey={() => false}
        persistKeyInLocalStorage={false}
        onChangeAIProviderType={vi.fn()}
        onSaveApiKey={vi.fn()}
        onClearApiKey={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText('student@example.com'), {
      target: { value: 'student@example.com' },
    });
    fireEvent.change(screen.getByPlaceholderText('至少 6 位字元'), {
      target: { value: 'secret123' },
    });

    fireEvent.click(screen.getByRole('button', { name: '登入' }));
    await waitFor(() => {
      expect(screen.getByText('帳號或密碼錯誤，請確認後再試。')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: '登入' }));
    await waitFor(() => {
      expect(
        screen.getByText('此電子信箱尚未完成驗證，請先至信箱點擊驗證連結。'),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: '註冊帳號' }));
    await waitFor(() => {
      expect(
        screen.getByText('此電子信箱已經註冊過，請直接登入。'),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: '註冊帳號' }));
    await waitFor(() => {
      expect(screen.getByText('密碼長度至少需要 6 個字元。')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: '註冊帳號' }));
    await waitFor(() => {
      expect(
        screen.getByText('註冊成功！請至信箱點擊驗證連結後再登入'),
      ).toBeInTheDocument();
    });
  });

  it('keeps AI chat messages strictly in RAM, resets on remount, and clears via header button', async () => {
    const firstMount = render(
      <CalendarProvider
        timeZone="Asia/Taipei"
        initialDate="2026-11-13"
        referenceNow={new Date('2026-11-13T15:30:00+08:00')}
        initialViewMode="day"
        seedDemoData={false}
      >
        <TimelinePage />
      </CalendarProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('day-timeline')).toBeInTheDocument();
    });

    // DayTimeline renders current-time indicator on today's view
    expect(screen.getByTestId('current-time-indicator')).toBeInTheDocument();

    const chatInput = screen.getByLabelText('輸入學習規劃指令');
    fireEvent.change(chatInput, {
      target: { value: '安排今天下午英文閱讀' },
    });
    fireEvent.click(screen.getByRole('button', { name: '送出規劃指令' }));

    await waitFor(() => {
      expect(screen.getByText('安排今天下午英文閱讀')).toBeInTheDocument();
    });

    // Must NOT persist chat history to localStorage
    expect(window.localStorage.getItem('aurastudy.v1.chatMessages')).toBeNull();

    // Unmount and remount -> RAM chat resets cleanly
    firstMount.unmount();
    cleanup();

    render(
      <CalendarProvider
        timeZone="Asia/Taipei"
        initialDate="2026-11-13"
        referenceNow={new Date('2026-11-13T15:30:00+08:00')}
        initialViewMode="day"
        seedDemoData={false}
      >
        <TimelinePage />
      </CalendarProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('day-timeline')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: '展開對話' }));
    expect(screen.queryByText('安排今天下午英文閱讀')).not.toBeInTheDocument();

    // Send another message and test the "清空對話" button in expanded header
    fireEvent.change(screen.getByLabelText('輸入學習規劃指令'), {
      target: { value: '安排明天數學演練' },
    });
    fireEvent.click(screen.getByRole('button', { name: '送出規劃指令' }));

    await waitFor(() => {
      expect(screen.getByText('安排明天數學演練')).toBeInTheDocument();
    });

    const clearChatBtn = screen.getByRole('button', { name: '清空對話' });
    expect(clearChatBtn).not.toBeDisabled();
    fireEvent.click(clearChatBtn);

    await waitFor(() => {
      expect(screen.queryByText('安排明天數學演練')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: '清空對話' })).toBeDisabled();
    });
  });

  it('manages OpenAI custom key aliases, masked previews, switching, renaming, and GPT-6 model selection in SettingsModal', async () => {
    renderPhase4Page({ seedDemoData: false });

    await waitFor(() => {
      expect(screen.getByTestId('week-timeline')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: '開啟設定' }));
    fireEvent.click(screen.getByLabelText(/OpenAI/));

    // Verify GPT-6 Luna is the default selected OpenAI model
    const modelSelect = screen.getByTestId('openai-model-select') as HTMLSelectElement;
    expect(modelSelect.value).toBe('gpt-6-luna');

    // Switch to gpt-6.1-terra and verify persistence
    fireEvent.change(modelSelect, { target: { value: 'gpt-6.1-terra' } });
    expect(modelSelect.value).toBe('gpt-6.1-terra');
    expect(window.localStorage.getItem('aurastudy.ai.openaiModel')).toBe('gpt-6.1-terra');

    // Save first OpenAI key with custom alias
    fireEvent.change(screen.getByLabelText('金鑰自訂名稱'), {
      target: { value: '個人主力帳號' },
    });
    fireEvent.change(screen.getByLabelText('輸入 API Key'), {
      target: { value: 'sk-proj-personalKey1111' },
    });
    fireEvent.click(screen.getByRole('button', { name: '儲存 Key' }));

    expect(screen.getByText('個人主力帳號')).toBeInTheDocument();
    expect(screen.getByText('sk-...1111')).toBeInTheDocument();

    // Save second OpenAI key without alias -> defaults to OpenAI 預設金鑰
    fireEvent.change(screen.getByLabelText('輸入 API Key'), {
      target: { value: 'sk-proj-sharedKey2222' },
    });
    fireEvent.click(screen.getByRole('button', { name: '儲存 Key' }));

    expect(screen.getByText('OpenAI 預設金鑰')).toBeInTheDocument();
    expect(screen.getByText('sk-...2222')).toBeInTheDocument();

    // Rename second key to 社團共用額度
    fireEvent.click(screen.getByRole('button', { name: '重新命名 OpenAI 預設金鑰' }));
    fireEvent.change(screen.getByLabelText('重新命名金鑰：OpenAI 預設金鑰'), {
      target: { value: '社團共用額度' },
    });
    fireEvent.click(screen.getByRole('button', { name: '儲存名稱' }));

    expect(screen.getByText('社團共用額度')).toBeInTheDocument();

    // Switch active key back to 個人主力帳號
    const switchBtn = screen.getByRole('button', { name: '切換啟用' });
    fireEvent.click(switchBtn);
    expect(window.sessionStorage.getItem('aurastudy.ai.apiKey.openai')).toBe(
      'sk-proj-personalKey1111',
    );
  });
});
