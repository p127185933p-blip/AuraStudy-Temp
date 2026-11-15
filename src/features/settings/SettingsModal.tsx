import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  AlertTriangle,
  Bell,
  Check,
  CloudUpload,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  LogOut,
  Moon,
  Pencil,
  ShieldAlert,
  Smartphone,
  Sun,
  Trash2,
  Upload,
  UserCheck,
  X,
} from 'lucide-react';
import {
  LiquidButton,
  SpatialMorphModal,
  type LaunchOrigin,
} from '@/components/ui/LiquidGlass';
import type {
  AIProviderType,
  AuraStudyBackup,
  BackupResult,
  ImportBackupSummary,
  RemoteAIProviderType,
  StoredApiKeyEntry,
} from '@/application/services';
import type { ThemeMode } from '@/shared/utils';

export interface SettingsModalProps {
  isOpen: boolean;
  launchOrigin?: LaunchOrigin | null;
  onClose: () => void;
  isSupabaseMode: boolean;
  authUserEmail: string | null;
  isAuthBusy: boolean;
  onSignIn: (
    email: string,
    password: string,
  ) => Promise<{ ok: boolean; message?: string }>;
  onSignUp: (
    email: string,
    password: string,
  ) => Promise<{ ok: boolean; message?: string }>;
  onSignOut: () => Promise<void>;
  pastCount?: number;
  onClearPastData?: () => Promise<number | void>;
  cloudSyncStatus?: 'idle' | 'syncing' | 'synced' | 'error';
  cloudSyncError?: string | null;
  lastCloudSyncAt?: string | null;
  onSyncToCloudNow?: () => Promise<{ ok: boolean; message?: string }>;
  onExportBackup: () => Promise<AuraStudyBackup>;
  onImportBackup: (rawJson: string) => Promise<BackupResult<ImportBackupSummary>>;
  aiProviderType: AIProviderType;
  geminiModel?: string;
  openaiModel?: string;
  hasSavedApiKey: (provider: RemoteAIProviderType) => boolean;
  apiKeyEntries?: readonly StoredApiKeyEntry[];
  activeApiKeyId?: string | null;
  persistKeyInLocalStorage: boolean;
  onChangeAIProviderType: (provider: AIProviderType) => void;
  onChangeGeminiModel?: (model: string) => void;
  onChangeOpenAIModel?: (model: string) => void;
  onSaveApiKey: (
    provider: RemoteAIProviderType,
    apiKey: string,
    persistInLocal: boolean,
    label?: string,
  ) => void;
  onSelectApiKey?: (provider: RemoteAIProviderType, entryId: string) => void;
  onRenameApiKey?: (
    provider: RemoteAIProviderType,
    entryId: string,
    label: string,
  ) => void;
  onDeleteApiKeyEntry?: (provider: RemoteAIProviderType, entryId: string) => void;
  onClearApiKey: (provider: RemoteAIProviderType) => void;
  theme?: ThemeMode;
  onChangeTheme?: (theme: ThemeMode) => void;
  notificationsEnabled?: boolean;
  onToggleNotifications?: (
    enabled: boolean,
  ) => Promise<{ ok: boolean; enabled: boolean; message?: string }>;
  pwaInstall?: {
    isInstallable: boolean;
    isInstalled: boolean;
    isIOS: boolean;
    onInstall: () => Promise<boolean>;
  };
}

const GEMINI_MODEL_PRESETS = [
  {
    value: 'gemini-4-hydrogen',
    label: 'gemini-4-hydrogen（預設，最新 Gemini 4 Hydrogen）',
  },
  {
    value: 'gemini-3.8-flash',
    label: 'gemini-3.8-flash（Gemini 3.8 Flash）',
  },
  {
    value: 'gemini-3.5-flash-lite',
    label: 'gemini-3.5-flash-lite（Gemini 3.5 Flash-Lite 輕量版）',
  },
] as const;

const OPENAI_MODEL_PRESETS = [
  {
    value: 'gpt-6-luna',
    label: 'gpt-6-luna — GPT-6 Luna（預設推薦）',
    description: '最新極速高效率模型，適合日常行程解析、課表截圖辨識與高頻率對話（成本最低、反應最快）。',
  },
  {
    value: 'gpt-6.1-terra',
    label: 'gpt-6.1-terra — GPT-6.1 Terra',
    description: '適合複雜圖片／多模態視覺推理與精緻文字整理。',
  },
  {
    value: 'gpt-6.1-sol',
    label: 'gpt-6.1-sol — GPT-6.1 Sol',
    description: '全能進階推理模型，適合複雜學習計畫拆解。',
  },
  {
    value: 'gpt-6-astra',
    label: 'gpt-6-astra — GPT-6 Astra',
    description: 'OpenAI 旗艦級最高推理能力模型。',
  },
] as const;

const CUSTOM_MODEL_OPTION = '__custom__';

function maskSecretForDisplay(apiKey: string): string {
  const trimmed = apiKey.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('sk-') && trimmed.length > 7) {
    return `sk-...${trimmed.slice(-4)}`;
  }
  if (trimmed.length > 8) {
    return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
  }
  if (trimmed.length > 4) {
    return `${trimmed.slice(0, 2)}...${trimmed.slice(-2)}`;
  }
  return '****';
}

const PROVIDER_OPTIONS: readonly {
  value: AIProviderType;
  label: string;
  description: string;
}[] = [
  {
    value: 'demo',
    label: 'Demo 模式（內建模擬 AI）',
    description: '免 API Key，於本地模擬提案互動與確認流程。',
  },
  {
    value: 'gemini',
    label: 'Google Gemini',
    description: '使用您自備的 Google AI Studio API Key（預設 gemini-4-hydrogen）。',
  },
  {
    value: 'openai',
    label: 'OpenAI',
    description: '使用您自備的 OpenAI API Key（預設 gpt-6-luna）。',
  },
];

async function readTextFromFile(file: File): Promise<string> {
  if (typeof file.text === 'function') {
    return file.text();
  }
  if (typeof FileReader !== 'undefined') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () =>
        resolve(typeof reader.result === 'string' ? reader.result : '');
      reader.onerror = () => reject(new Error('讀取檔案失敗'));
      reader.readAsText(file);
    });
  }
  return '';
}

function formatSupabaseAuthError(
  rawMessage: string | undefined,
  mode: 'signin' | 'signup',
): string {
  const message = rawMessage?.trim() ?? '';
  if (!message) {
    return mode === 'signin'
      ? '登入失敗，請稍後再試。'
      : '註冊失敗，請稍後再試。';
  }

  const normalized = message.toLowerCase();
  if (normalized.includes('invalid login credentials')) {
    return '帳號或密碼錯誤，請確認後再試。';
  }
  if (normalized.includes('email not confirmed')) {
    return '此電子信箱尚未完成驗證，請先至信箱點擊驗證連結。';
  }
  if (
    normalized.includes('user already registered') ||
    normalized.includes('already been registered')
  ) {
    return '此電子信箱已經註冊過，請直接登入。';
  }
  if (
    normalized.includes('password should be at least 6 characters') ||
    normalized.includes('weak_password')
  ) {
    return '密碼長度至少需要 6 個字元。';
  }
  if (
    normalized.includes('unable to validate email address') ||
    normalized.includes('invalid format') ||
    normalized.includes('invalid email')
  ) {
    return '請輸入有效的 Email 格式。';
  }
  if (
    normalized.includes('email rate limit exceeded') ||
    normalized.includes('over_email_send_rate_limit') ||
    normalized.includes('too many requests') ||
    normalized.includes('for security purposes')
  ) {
    return '操作過於頻繁，請稍候片刻再試。';
  }
  if (normalized.includes('signup is disabled')) {
    return '目前已關閉新帳號註冊，請聯繫管理員。';
  }

  return message;
}

export function SettingsModal({
  isOpen,
  launchOrigin,
  onClose,
  isSupabaseMode,
  authUserEmail,
  isAuthBusy,
  onSignIn,
  onSignUp,
  onSignOut,
  pastCount = 0,
  onClearPastData,
  cloudSyncStatus = 'idle',
  cloudSyncError = null,
  lastCloudSyncAt = null,
  onSyncToCloudNow,
  onExportBackup,
  onImportBackup,
  aiProviderType,
  geminiModel = 'gemini-4-hydrogen',
  openaiModel = 'gpt-6-luna',
  hasSavedApiKey,
  apiKeyEntries = [],
  activeApiKeyId = null,
  persistKeyInLocalStorage,
  onChangeAIProviderType,
  onChangeGeminiModel,
  onChangeOpenAIModel,
  onSaveApiKey,
  onSelectApiKey,
  onRenameApiKey,
  onDeleteApiKeyEntry,
  onClearApiKey,
  theme = 'light',
  onChangeTheme,
  notificationsEnabled = false,
  onToggleNotifications,
  pwaInstall,
}: SettingsModalProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authFeedback, setAuthFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const [apiKeyLabelInput, setApiKeyLabelInput] = useState('');
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [persistLocalChecked, setPersistLocalChecked] = useState(
    persistKeyInLocalStorage,
  );
  const [keyFeedback, setKeyFeedback] = useState<string | null>(null);
  const [renamingKeyId, setRenamingKeyId] = useState<string | null>(null);
  const [renameKeyDraft, setRenameKeyDraft] = useState('');

  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [clearFeedback, setClearFeedback] = useState<string | null>(null);

  const [isBackupBusy, setIsBackupBusy] = useState(false);
  const [backupFeedback, setBackupFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const backupInputRef = useRef<HTMLInputElement>(null);

  const [isNotificationBusy, setIsNotificationBusy] = useState(false);
  const [notificationFeedback, setNotificationFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [manualSyncFeedback, setManualSyncFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const isPresetGeminiModel = GEMINI_MODEL_PRESETS.some(
    (preset) => preset.value === geminiModel,
  );
  const [isCustomGeminiModel, setIsCustomGeminiModel] = useState<boolean>(
    () => !isPresetGeminiModel,
  );
  const [customGeminiModelInput, setCustomGeminiModelInput] =
    useState<string>(geminiModel);

  const isPresetOpenAIModel = OPENAI_MODEL_PRESETS.some(
    (preset) => preset.value === openaiModel,
  );
  const [isCustomOpenAIModel, setIsCustomOpenAIModel] = useState<boolean>(
    () => !isPresetOpenAIModel,
  );
  const [customOpenAIModelInput, setCustomOpenAIModelInput] =
    useState<string>(openaiModel);

  useEffect(() => {
    setPersistLocalChecked(persistKeyInLocalStorage);
  }, [persistKeyInLocalStorage]);

  useEffect(() => {
    const matchesPreset = GEMINI_MODEL_PRESETS.some(
      (preset) => preset.value === geminiModel,
    );
    if (!matchesPreset) {
      setIsCustomGeminiModel(true);
    }
    setCustomGeminiModelInput(geminiModel);
  }, [geminiModel]);

  useEffect(() => {
    const matchesPreset = OPENAI_MODEL_PRESETS.some(
      (preset) => preset.value === openaiModel,
    );
    if (!matchesPreset) {
      setIsCustomOpenAIModel(true);
    }
    setCustomOpenAIModelInput(openaiModel);
  }, [openaiModel]);

  useEffect(() => {
    setApiKeyLabelInput('');
    setApiKeyInput('');
    setShowApiKey(false);
    setKeyFeedback(null);
    setRenamingKeyId(null);
    setRenameKeyDraft('');
  }, [aiProviderType, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const isRemoteProvider =
    aiProviderType === 'gemini' || aiProviderType === 'openai';
  const currentRemoteProvider: RemoteAIProviderType | null = isRemoteProvider
    ? aiProviderType
    : null;
  const currentHasKey = currentRemoteProvider
    ? hasSavedApiKey(currentRemoteProvider)
    : false;

  async function handleAuthSubmit(mode: 'signin' | 'signup') {
    setAuthFeedback(null);
    if (!email.trim() || !password) {
      setAuthFeedback({
        type: 'error',
        text: '請輸入 Email 與密碼。',
      });
      return;
    }

    const res =
      mode === 'signin'
        ? await onSignIn(email, password)
        : await onSignUp(email, password);

    setAuthFeedback({
      type: res.ok ? 'success' : 'error',
      text: res.ok
        ? (res.message ?? '操作成功。')
        : formatSupabaseAuthError(res.message, mode),
    });

    if (res.ok && mode === 'signin') {
      setPassword('');
    }
  }

  function handleSaveKeySubmit(event: FormEvent) {
    event.preventDefault();
    if (!currentRemoteProvider) return;
    const trimmed = apiKeyInput.trim();
    if (!trimmed) {
      setKeyFeedback('請先輸入有效的 API Key。');
      return;
    }
    const trimmedLabel = apiKeyLabelInput.trim();
    onSaveApiKey(
      currentRemoteProvider,
      trimmed,
      persistLocalChecked,
      trimmedLabel || undefined,
    );
    setApiKeyInput('');
    setApiKeyLabelInput('');
    setKeyFeedback(
      persistLocalChecked
        ? 'API Key 已儲存於此裝置瀏覽器（localStorage）。'
        : 'API Key 已儲存於本次分頁工作階段（sessionStorage）。',
    );
  }

  function handleClearKeyClick() {
    if (!currentRemoteProvider) return;
    onClearApiKey(currentRemoteProvider);
    setApiKeyInput('');
    setApiKeyLabelInput('');
    setRenamingKeyId(null);
    setKeyFeedback('已清除保存的 API Key。');
  }

  async function handleConfirmClearPast() {
    if (!onClearPastData || pastCount === 0) return;
    setIsClearing(true);
    try {
      const deletedCount = await onClearPastData();
      setConfirmClearOpen(false);
      const countText =
        typeof deletedCount === 'number' ? deletedCount : pastCount;
      setClearFeedback(
        `已清除 ${countText} 筆已過期行程與截止日期，進行中與未來的排程已完整保留。`,
      );
    } finally {
      setIsClearing(false);
    }
  }

  async function handleManualCloudSync() {
    if (!onSyncToCloudNow) return;
    setManualSyncFeedback(null);
    const res = await onSyncToCloudNow();
    setManualSyncFeedback({
      type: res.ok ? 'success' : 'error',
      text:
        res.message ??
        (res.ok ? '已成功覆蓋上傳至雲端。' : '雲端同步失敗，請稍後再試。'),
    });
  }

  async function handleExportBackupClick() {
    setIsBackupBusy(true);
    setBackupFeedback(null);
    try {
      const backup = await onExportBackup();
      const jsonString = JSON.stringify(backup, null, 2);
      const dateStamp = backup.exportedAt.slice(0, 10);

      if (
        typeof Blob !== 'undefined' &&
        typeof URL !== 'undefined' &&
        typeof URL.createObjectURL === 'function'
      ) {
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `aurastudy-backup-${dateStamp}.json`;
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        URL.revokeObjectURL(url);
      }

      setBackupFeedback({
        type: 'success',
        text: `已匯出 ${backup.items.length} 筆正式行程備份（.json）。`,
      });
    } catch {
      setBackupFeedback({
        type: 'error',
        text: '匯出備份失敗，請稍後再試。',
      });
    } finally {
      setIsBackupBusy(false);
    }
  }

  async function handleImportFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setIsBackupBusy(true);
    setBackupFeedback(null);
    try {
      const rawText = await readTextFromFile(file);
      const result = await onImportBackup(rawText);
      if (result.ok) {
        setBackupFeedback({
          type: 'success',
          text: `已成功還原 ${result.data.importedCount} 筆行程（${result.data.deadlinesCount} 筆截止事項、${result.data.schedulesCount} 筆排程時段）。`,
        });
      } else {
        setBackupFeedback({
          type: 'error',
          text: result.error.message,
        });
      }
    } catch {
      setBackupFeedback({
        type: 'error',
        text: '讀取備份檔案失敗，請確認檔案未損毀。',
      });
    } finally {
      setIsBackupBusy(false);
    }
  }

  async function handleNotificationToggleClick() {
    if (!onToggleNotifications || isNotificationBusy) {
      return;
    }
    setIsNotificationBusy(true);
    setNotificationFeedback(null);
    try {
      const next = !notificationsEnabled;
      const res = await onToggleNotifications(next);
      if (res.message) {
        setNotificationFeedback({
          type: res.ok ? 'success' : 'error',
          text: res.message,
        });
      }
    } finally {
      setIsNotificationBusy(false);
    }
  }

  return (
    <SpatialMorphModal
      isOpen={isOpen}
      onClose={onClose}
      origin={launchOrigin}
      ariaLabelledBy="settings-modal-title"
      dataTestId="settings-modal"
      panelClassName="sm:max-w-xl"
    >
            {/* Header */}
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--color-border-subtle)] px-4 py-3.5 sm:px-6 sm:pt-5">
              <div className="min-w-0">
                <h2
                  id="settings-modal-title"
                  className="text-[length:var(--text-xl)] font-bold text-[var(--color-text-primary)]"
                >
                  系統設定與隱私權
                </h2>
                <p className="mt-0.5 text-[length:var(--text-xs)] text-[var(--color-text-secondary)]">
                  管理外觀主題、提醒通知、帳號同步、JSON 備份與自備 AI 金鑰（BYOK）
                </p>
              </div>
              <LiquidButton
                glassLayer={1}
                onClick={onClose}
                aria-label="關閉設定視窗"
                className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-[var(--radius-md)] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)]"
              >
                <X className="relative z-10 h-5 w-5" aria-hidden="true" />
              </LiquidButton>
            </div>

        <div className="flex-1 space-y-6 overflow-y-auto px-4 pb-5 pt-4 sm:px-6 sm:pb-6">
          {/* Section 0: Appearance Theme */}
          <section aria-labelledby="settings-theme-heading" className="space-y-2.5">
            <h3
              id="settings-theme-heading"
              className="text-[length:var(--text-base)] font-bold text-[var(--color-text-primary)]"
            >
              外觀主題
            </h3>
            <div
              role="group"
              aria-label="外觀主題切換"
              className="grid grid-cols-2 gap-2"
            >
              <LiquidButton
                aria-pressed={theme === 'light'}
                onClick={() => onChangeTheme?.('light')}
                className={`inline-flex min-h-[44px] items-center justify-center gap-2 rounded-[var(--radius-md)] border px-3 text-[length:var(--text-sm)] font-bold transition-colors ${
                  theme === 'light'
                    ? 'border-[var(--color-accent-primary)] bg-[var(--color-accent-primary-soft)] text-[var(--color-accent-primary)]'
                    : 'glass-layer-1 text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]'
                }`}
              >
                <Sun className="relative z-10 h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="relative z-10">白色模式（淺色）</span>
              </LiquidButton>
              <LiquidButton
                aria-pressed={theme === 'dark'}
                onClick={() => onChangeTheme?.('dark')}
                className={`inline-flex min-h-[44px] items-center justify-center gap-2 rounded-[var(--radius-md)] border px-3 text-[length:var(--text-sm)] font-bold transition-colors ${
                  theme === 'dark'
                    ? 'border-[var(--color-accent-primary)] bg-[var(--color-accent-primary-soft)] text-[var(--color-accent-primary)]'
                    : 'glass-layer-1 text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]'
                }`}
              >
                <Moon className="relative z-10 h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="relative z-10">黑色模式（深色）</span>
              </LiquidButton>
            </div>
          </section>

          {/* Section 0.5: Schedule Smart Notifications */}
          <section aria-labelledby="settings-notifications-heading" className="space-y-2.5">
            <div className="glass-layer-1 rounded-[var(--radius-md)] p-3.5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-start gap-2.5">
                  <Bell
                    className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-accent-primary)]"
                    aria-hidden="true"
                  />
                  <div>
                    <h3
                      id="settings-notifications-heading"
                      className="text-[length:var(--text-sm)] font-bold text-[var(--color-text-primary)]"
                    >
                      行程提醒通知
                    </h3>
                    <p className="mt-0.5 text-[length:var(--text-xs)] text-[var(--color-text-secondary)]">
                      行程開始前 20 分鐘提醒時段，結束時提醒下一個行程
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  role="switch"
                  aria-checked={notificationsEnabled}
                  aria-label="行程提醒通知"
                  disabled={isNotificationBusy}
                  onClick={() => void handleNotificationToggleClick()}
                  className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full border-2 transition-colors disabled:opacity-50 ${
                    notificationsEnabled
                      ? 'border-[var(--color-accent-primary)] bg-[var(--color-accent-primary)]'
                      : 'border-[var(--color-border-strong)] bg-[var(--color-bg-subtle)]'
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                      notificationsEnabled ? 'translate-x-5' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </div>

              {notificationFeedback && (
                <p
                  data-testid="notification-feedback"
                  className={`mt-2.5 text-[length:var(--text-xs)] font-semibold ${
                    notificationFeedback.type === 'error'
                      ? 'text-[var(--color-proposal-delete-text)]'
                      : 'text-[var(--color-accent-primary)]'
                  }`}
                >
                  {notificationFeedback.text}
                </p>
              )}
            </div>
          </section>

          {/* Section 1: Account & Data Management */}
          <section aria-labelledby="settings-account-heading" className="space-y-3">
            <h3
              id="settings-account-heading"
              className="text-[length:var(--text-base)] font-bold text-[var(--color-text-primary)]"
            >
              帳號與資料管理
            </h3>

            {isSupabaseMode ? (
              <div className="rounded-[var(--radius-md)] border-[length:var(--border-width-card)] border-[var(--color-border-strong)] bg-[var(--color-bg-canvas)]/60 p-4">
                {authUserEmail ? (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2 text-[length:var(--text-sm)] font-semibold text-[var(--color-text-primary)] break-all">
                        <UserCheck
                          className="h-4 w-4 shrink-0 text-[var(--color-accent-primary)]"
                          aria-hidden="true"
                        />
                        <span>已登入帳號：{authUserEmail}</span>
                      </div>
                      <button
                        type="button"
                        disabled={isAuthBusy}
                        onClick={() => void onSignOut()}
                        className="inline-flex min-h-[40px] items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-border-strong)] bg-[var(--color-bg-surface)] px-3 text-[length:var(--text-xs)] font-bold text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)]"
                      >
                        <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>登出</span>
                      </button>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-border-subtle)] pt-3">
                      <div className="min-w-0 text-[length:var(--text-xs)]">
                        <p
                          data-testid="cloud-sync-status"
                          className={`font-semibold ${
                            cloudSyncStatus === 'error'
                              ? 'text-[var(--color-proposal-delete-text)]'
                              : 'text-[var(--color-text-secondary)]'
                          }`}
                        >
                          {cloudSyncStatus === 'syncing'
                            ? '雲端快照同步中...'
                            : cloudSyncStatus === 'error'
                              ? `雲端同步失敗：${cloudSyncError ?? '請稍後再試'}`
                              : cloudSyncStatus === 'synced' && lastCloudSyncAt
                                ? `已覆蓋同步至雲端（${lastCloudSyncAt.slice(11, 19)} UTC）`
                                : '單一快照覆蓋模式：每次異動將以目前裝置資料為準同步雲端'}
                        </p>
                      </div>
                      {onSyncToCloudNow && (
                        <button
                          type="button"
                          disabled={cloudSyncStatus === 'syncing' || isAuthBusy}
                          onClick={() => void handleManualCloudSync()}
                          className="inline-flex min-h-[38px] items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-accent-primary-border)] bg-[var(--color-accent-primary-soft)] px-3 text-[length:var(--text-xs)] font-bold text-[var(--color-accent-primary)] hover:bg-[var(--color-bg-hover)] disabled:opacity-50 whitespace-nowrap"
                        >
                          <CloudUpload className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>立即覆蓋上傳至雲端</span>
                        </button>
                      )}
                    </div>

                    {manualSyncFeedback && (
                      <p
                        data-testid="cloud-sync-feedback"
                        className={`text-[length:var(--text-xs)] font-semibold ${
                          manualSyncFeedback.type === 'error'
                            ? 'text-[var(--color-proposal-delete-text)]'
                            : 'text-[var(--color-proposal-create-text)]'
                        }`}
                      >
                        {manualSyncFeedback.text}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-[length:var(--text-xs)] text-[var(--color-text-secondary)]">
                      登入後您的行程、AI 提案與決策紀錄將透過 Supabase RLS 加密隔離並雲端同步。
                    </p>
                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                      <label className="block space-y-1">
                        <span className="text-[length:var(--text-xs)] font-bold text-[var(--color-text-secondary)]">
                          Email
                        </span>
                        <input
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="student@example.com"
                          className="min-h-[42px] w-full rounded-[var(--radius-sm)] border border-[var(--color-border-strong)] bg-[var(--color-bg-surface)] px-3 text-[length:var(--text-sm)] text-[var(--color-text-primary)]"
                        />
                      </label>
                      <label className="block space-y-1">
                        <span className="text-[length:var(--text-xs)] font-bold text-[var(--color-text-secondary)]">
                          密碼
                        </span>
                        <input
                          type="password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder="至少 6 位字元"
                          className="min-h-[42px] w-full rounded-[var(--radius-sm)] border border-[var(--color-border-strong)] bg-[var(--color-bg-surface)] px-3 text-[length:var(--text-sm)] text-[var(--color-text-primary)]"
                        />
                      </label>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={isAuthBusy}
                        onClick={() => void handleAuthSubmit('signin')}
                        className="min-h-[42px] rounded-[var(--radius-sm)] bg-[var(--color-accent-primary)] px-4 text-[length:var(--text-sm)] font-bold text-[var(--color-text-inverse)] hover:bg-[var(--color-accent-primary-hover)] disabled:opacity-50"
                      >
                        登入
                      </button>
                      <button
                        type="button"
                        disabled={isAuthBusy}
                        onClick={() => void handleAuthSubmit('signup')}
                        className="min-h-[42px] rounded-[var(--radius-sm)] border border-[var(--color-border-strong)] bg-[var(--color-bg-surface)] px-4 text-[length:var(--text-sm)] font-bold text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] disabled:opacity-50"
                      >
                        註冊帳號
                      </button>
                    </div>
                    {authFeedback && (
                      <p
                        className={`text-[length:var(--text-xs)] font-semibold ${
                          authFeedback.type === 'error'
                            ? 'text-[var(--color-proposal-delete-text)]'
                            : 'text-[var(--color-accent-primary)]'
                        }`}
                      >
                        {authFeedback.text}
                      </p>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div
                data-testid="local-preview-mode-banner"
                className="rounded-[var(--radius-md)] border-[length:var(--border-width-card)] border-[var(--color-border-strong)] bg-[var(--color-bg-subtle)] p-3.5"
              >
                <p className="text-[length:var(--text-sm)] font-bold text-[var(--color-text-primary)]">
                  本地預覽模式（未連接雲端資料庫）
                </p>
                <p className="mt-1 text-[length:var(--text-xs)] text-[var(--color-text-secondary)]">
                  目前未設定 Supabase 環境變數，所有行程與提案僅保存在本機記憶體中，不會上傳至遠端資料庫。
                </p>
              </div>
            )}

            {/* JSON Backup & Restore */}
            <div className="rounded-[var(--radius-md)] border border-[var(--color-border-strong)] bg-[var(--color-bg-surface)] p-3.5 space-y-3">
              <div>
                <p className="text-[length:var(--text-sm)] font-bold text-[var(--color-text-primary)]">
                  備份與還原（JSON）
                </p>
                <p className="text-[length:var(--text-xs)] text-[var(--color-text-secondary)]">
                  隨時將正式行程匯出為結構化 JSON 備份檔，或從備份檔驗證還原。
                </p>
              </div>

              <input
                ref={backupInputRef}
                type="file"
                accept=".json,application/json"
                onChange={(e) => void handleImportFileChange(e)}
                aria-label="選擇備份 JSON 檔案"
                className="hidden"
              />

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={isBackupBusy}
                  onClick={() => void handleExportBackupClick()}
                  className="inline-flex min-h-[42px] items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-border-strong)] bg-[var(--color-bg-surface)] px-3.5 text-[length:var(--text-xs)] font-bold text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] disabled:opacity-50"
                >
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>匯出備份（.json）</span>
                </button>

                <button
                  type="button"
                  disabled={isBackupBusy}
                  onClick={() => backupInputRef.current?.click()}
                  className="inline-flex min-h-[42px] items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-accent-primary-border)] bg-[var(--color-accent-primary-soft)] px-3.5 text-[length:var(--text-xs)] font-bold text-[var(--color-accent-primary)] hover:bg-[var(--color-bg-hover)] disabled:opacity-50"
                >
                  <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>匯入還原（.json）</span>
                </button>
              </div>

              {backupFeedback && (
                <p
                  data-testid="backup-feedback"
                  className={`text-[length:var(--text-xs)] font-semibold break-words ${
                    backupFeedback.type === 'error'
                      ? 'text-[var(--color-proposal-delete-text)]'
                      : 'text-[var(--color-proposal-create-text)]'
                  }`}
                >
                  {backupFeedback.text}
                </p>
              )}
            </div>

            {/* Clear Past Items Only */}
            <div className="rounded-[var(--radius-md)] border border-[var(--color-border-strong)] bg-[var(--color-bg-surface)] p-3.5">
              {!confirmClearOpen ? (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-[length:var(--text-sm)] font-bold text-[var(--color-text-primary)]">
                      清除已過期行程
                    </p>
                    <p className="text-[length:var(--text-xs)] text-[var(--color-text-secondary)]">
                      僅清除已結束的過去行程與截止日期，完整保留進行中與未來排程及自訂標籤。
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={pastCount === 0 || isClearing}
                    onClick={() => {
                      setClearFeedback(null);
                      setConfirmClearOpen(true);
                    }}
                    className="inline-flex min-h-[42px] items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-proposal-delete-border)] bg-[var(--color-proposal-delete-bg)] px-3.5 text-[length:var(--text-xs)] font-bold text-[var(--color-proposal-delete-text)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>清除已過期行程（共 {pastCount} 筆）</span>
                  </button>
                </div>
              ) : (
                <div className="space-y-2.5">
                  <div className="flex items-start gap-2 text-[length:var(--text-sm)] font-bold text-[var(--color-proposal-delete-text)]">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>
                      將刪除 {pastCount} 筆已結束的過去行程與截止日期，進行中與未來的排程將完整保留。
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={isClearing || pastCount === 0}
                      onClick={() => void handleConfirmClearPast()}
                      className="min-h-[40px] rounded-[var(--radius-sm)] bg-[var(--color-proposal-delete-accent)] px-3.5 text-[length:var(--text-xs)] font-bold text-[var(--color-text-inverse)] disabled:opacity-50"
                    >
                      確認清除已過期行程
                    </button>
                    <button
                      type="button"
                      disabled={isClearing}
                      onClick={() => setConfirmClearOpen(false)}
                      className="min-h-[40px] rounded-[var(--radius-sm)] border border-[var(--color-border-strong)] bg-[var(--color-bg-surface)] px-3.5 text-[length:var(--text-xs)] font-bold text-[var(--color-text-primary)]"
                    >
                      取消
                    </button>
                  </div>
                </div>
              )}
              {clearFeedback && (
                <p
                  data-testid="clear-past-feedback"
                  className="mt-2 text-[length:var(--text-xs)] font-semibold text-[var(--color-accent-primary)]"
                >
                  {clearFeedback}
                </p>
              )}
            </div>
          </section>

          {/* Section 2: AI Provider & BYOK */}
          <section aria-labelledby="settings-ai-heading" className="space-y-3">
            <div className="flex items-center gap-2">
              <KeyRound
                className="h-4 w-4 text-[var(--color-accent-primary)]"
                aria-hidden="true"
              />
              <h3
                id="settings-ai-heading"
                className="text-[length:var(--text-base)] font-bold text-[var(--color-text-primary)]"
              >
                AI 服務與 API Key 設定（BYOK）
              </h3>
            </div>

            <div className="grid grid-cols-1 gap-2">
              {PROVIDER_OPTIONS.map((option) => {
                const selected = aiProviderType === option.value;
                return (
                  <label
                    key={option.value}
                    className={`flex cursor-pointer items-start gap-3 rounded-[var(--radius-md)] border-[length:var(--border-width-card)] p-3 transition-colors ${
                      selected
                        ? 'border-[var(--color-accent-primary)] bg-[var(--color-bg-subtle)]'
                        : 'border-[var(--color-border-strong)] bg-[var(--color-bg-surface)] hover:bg-[var(--color-bg-hover)]'
                    }`}
                  >
                    <input
                      type="radio"
                      name="ai-provider"
                      value={option.value}
                      checked={selected}
                      onChange={() => onChangeAIProviderType(option.value)}
                      className="mt-1 h-4 w-4 accent-[var(--color-accent-primary)]"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-[length:var(--text-sm)] font-bold text-[var(--color-text-primary)]">
                        {option.label}
                      </p>
                      <p className="text-[length:var(--text-xs)] text-[var(--color-text-secondary)]">
                        {option.description}
                      </p>
                    </div>
                  </label>
                );
              })}
            </div>

            {currentRemoteProvider && (
              <form
                onSubmit={handleSaveKeySubmit}
                className="space-y-3 rounded-[var(--radius-md)] border-[length:var(--border-width-card)] border-[var(--color-border-strong)] bg-[var(--color-bg-canvas)]/70 p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[length:var(--text-sm)] font-bold text-[var(--color-text-primary)]">
                    {currentRemoteProvider === 'gemini'
                      ? 'Google Gemini API Key'
                      : 'OpenAI API Key'}
                  </span>
                  <span
                    className={`rounded-[var(--radius-sm)] px-2 py-0.5 text-[length:var(--text-xs)] font-bold ${
                      currentHasKey
                        ? 'bg-[var(--color-proposal-create-bg)] text-[var(--color-proposal-create-text)]'
                        : 'bg-[var(--color-proposal-delete-bg)] text-[var(--color-proposal-delete-text)]'
                    }`}
                  >
                    {currentHasKey ? '已設定金鑰' : '尚未設定金鑰'}
                  </span>
                </div>

                <div className="space-y-2">
                  <input
                    type="text"
                    value={apiKeyLabelInput}
                    onChange={(e) => setApiKeyLabelInput(e.target.value)}
                    aria-label="金鑰自訂名稱"
                    placeholder={
                      currentRemoteProvider === 'openai'
                        ? '金鑰名稱（例如：個人主力帳號，未填將使用「OpenAI 預設金鑰」）'
                        : '金鑰名稱（例如：個人主力帳號，未填將使用「Gemini 預設金鑰」）'
                    }
                    className="min-h-[42px] w-full rounded-[var(--radius-sm)] border border-[var(--color-border-strong)] bg-[var(--color-bg-surface)] px-3 text-[length:var(--text-sm)] text-[var(--color-text-primary)]"
                  />
                  <div className="flex items-center gap-2">
                    <input
                      type={showApiKey ? 'text' : 'password'}
                      value={apiKeyInput}
                      onChange={(e) => setApiKeyInput(e.target.value)}
                      aria-label="輸入 API Key"
                      placeholder={
                        currentHasKey
                          ? '已保存金鑰（輸入新金鑰可新增或更新）'
                          : '請貼上您的 API Key'
                      }
                      autoComplete="off"
                      className="min-h-[44px] min-w-0 flex-1 rounded-[var(--radius-sm)] border border-[var(--color-border-strong)] bg-[var(--color-bg-surface)] px-3 text-[length:var(--text-sm)] text-[var(--color-text-primary)]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowApiKey((prev) => !prev)}
                      aria-label={showApiKey ? '隱藏金鑰' : '顯示金鑰'}
                      className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border-strong)] bg-[var(--color-bg-surface)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]"
                    >
                      {showApiKey ? (
                        <EyeOff className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <Eye className="h-4 w-4" aria-hidden="true" />
                      )}
                    </button>
                  </div>
                </div>

                <label className="flex cursor-pointer items-center gap-2 text-[length:var(--text-xs)] text-[var(--color-text-secondary)]">
                  <input
                    type="checkbox"
                    checked={persistLocalChecked}
                    onChange={(e) => setPersistLocalChecked(e.target.checked)}
                    className="h-4 w-4 shrink-0 accent-[var(--color-accent-primary)]"
                  />
                  <span>
                    記住於此瀏覽器（localStorage）；未勾選則預設僅存於目前分頁（sessionStorage）。
                  </span>
                </label>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="submit"
                    className="min-h-[42px] rounded-[var(--radius-sm)] bg-[var(--color-accent-primary)] px-4 text-[length:var(--text-sm)] font-bold text-[var(--color-text-inverse)] hover:bg-[var(--color-accent-primary-hover)]"
                  >
                    儲存 Key
                  </button>
                  <button
                    type="button"
                    onClick={handleClearKeyClick}
                    className="min-h-[42px] rounded-[var(--radius-sm)] border border-[var(--color-border-strong)] bg-[var(--color-bg-surface)] px-4 text-[length:var(--text-sm)] font-bold text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)]"
                  >
                    清除 Key
                  </button>
                </div>

                {keyFeedback && (
                  <p className="text-[length:var(--text-xs)] font-semibold text-[var(--color-accent-primary)]">
                    {keyFeedback}
                  </p>
                )}

                {apiKeyEntries.length > 0 && (
                  <div
                    data-testid="saved-api-keys-list"
                    className="space-y-2 border-t border-[var(--color-border-subtle)] pt-3"
                  >
                    <p className="text-[length:var(--text-xs)] font-bold text-[var(--color-text-primary)]">
                      已儲存的金鑰清單（{apiKeyEntries.length} 組）
                    </p>
                    <div className="space-y-1.5">
                      {apiKeyEntries.map((entry) => {
                        const isActive =
                          activeApiKeyId !== null
                            ? entry.id === activeApiKeyId
                            : entry.id === apiKeyEntries[0]?.id;
                        const isRenaming = renamingKeyId === entry.id;
                        return (
                          <div
                            key={entry.id}
                            data-testid={`saved-key-entry-${entry.id}`}
                            className={`rounded-[var(--radius-sm)] border px-3 py-2 ${
                              isActive
                                ? 'border-[var(--color-accent-primary)] bg-[var(--color-bg-subtle)]'
                                : 'border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]'
                            }`}
                          >
                            {isRenaming ? (
                              <div className="flex flex-wrap items-center gap-2">
                                <input
                                  type="text"
                                  value={renameKeyDraft}
                                  onChange={(e) => setRenameKeyDraft(e.target.value)}
                                  aria-label={`重新命名金鑰：${entry.label}`}
                                  className="min-h-[36px] min-w-0 flex-1 rounded-[var(--radius-sm)] border border-[var(--color-border-strong)] bg-[var(--color-bg-surface)] px-2.5 text-[length:var(--text-xs)] text-[var(--color-text-primary)]"
                                />
                                <button
                                  type="button"
                                  onClick={() => {
                                    onRenameApiKey?.(
                                      currentRemoteProvider,
                                      entry.id,
                                      renameKeyDraft,
                                    );
                                    setRenamingKeyId(null);
                                    setRenameKeyDraft('');
                                  }}
                                  className="inline-flex min-h-[36px] items-center gap-1 rounded-[var(--radius-sm)] bg-[var(--color-accent-primary)] px-2.5 text-[length:var(--text-xs)] font-bold text-[var(--color-text-inverse)]"
                                >
                                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                                  <span>儲存名稱</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setRenamingKeyId(null);
                                    setRenameKeyDraft('');
                                  }}
                                  className="min-h-[36px] rounded-[var(--radius-sm)] border border-[var(--color-border-strong)] bg-[var(--color-bg-surface)] px-2.5 text-[length:var(--text-xs)] font-semibold text-[var(--color-text-secondary)]"
                                >
                                  取消
                                </button>
                              </div>
                            ) : (
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <span className="truncate text-[length:var(--text-xs)] font-bold text-[var(--color-text-primary)]">
                                      {entry.label}
                                    </span>
                                    {isActive && (
                                      <span className="rounded-[var(--radius-sm)] bg-[var(--color-accent-primary-soft)] px-1.5 py-0.5 text-[11px] font-bold text-[var(--color-accent-primary)]">
                                        目前啟用
                                      </span>
                                    )}
                                  </div>
                                  <p className="font-[family-name:var(--font-mono)] text-[length:var(--text-xs)] text-[var(--color-text-secondary)]">
                                    {maskSecretForDisplay(entry.apiKey)}
                                  </p>
                                </div>
                                <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                                  {!isActive && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        onSelectApiKey?.(currentRemoteProvider, entry.id)
                                      }
                                      className="min-h-[32px] rounded-[var(--radius-sm)] border border-[var(--color-accent-primary-border)] bg-[var(--color-accent-primary-soft)] px-2.5 text-[length:var(--text-xs)] font-bold text-[var(--color-accent-primary)] hover:bg-[var(--color-bg-hover)]"
                                    >
                                      切換啟用
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setRenamingKeyId(entry.id);
                                      setRenameKeyDraft(entry.label);
                                    }}
                                    aria-label={`重新命名 ${entry.label}`}
                                    className="inline-flex min-h-[32px] items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-border-strong)] bg-[var(--color-bg-surface)] px-2 text-[length:var(--text-xs)] font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
                                  >
                                    <Pencil className="h-3 w-3" aria-hidden="true" />
                                    <span>重新命名</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      onDeleteApiKeyEntry?.(currentRemoteProvider, entry.id)
                                    }
                                    aria-label={`刪除金鑰 ${entry.label}`}
                                    className="inline-flex min-h-[32px] items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-proposal-delete-border)] bg-[var(--color-proposal-delete-bg)] px-2 text-[length:var(--text-xs)] font-semibold text-[var(--color-proposal-delete-text)] hover:opacity-90"
                                  >
                                    <Trash2 className="h-3 w-3" aria-hidden="true" />
                                    <span>刪除</span>
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {currentRemoteProvider === 'gemini' && (
                  <div className="space-y-2 border-t border-[var(--color-border-subtle)] pt-3">
                    <label
                      htmlFor="gemini-model-select"
                      className="block text-[length:var(--text-xs)] font-bold text-[var(--color-text-primary)]"
                    >
                      Gemini 模型
                    </label>
                    <select
                      id="gemini-model-select"
                      aria-label="Gemini 模型"
                      data-testid="gemini-model-select"
                      value={
                        isCustomGeminiModel
                          ? CUSTOM_MODEL_OPTION
                          : geminiModel
                      }
                      onChange={(e) => {
                        const selected = e.target.value;
                        if (selected === CUSTOM_MODEL_OPTION) {
                          setIsCustomGeminiModel(true);
                          setCustomGeminiModelInput(geminiModel);
                        } else {
                          setIsCustomGeminiModel(false);
                          setCustomGeminiModelInput(selected);
                          onChangeGeminiModel?.(selected);
                        }
                      }}
                      className="min-h-[44px] w-full rounded-[var(--radius-sm)] border border-[var(--color-border-strong)] bg-[var(--color-bg-surface)] px-3 text-[length:var(--text-sm)] font-medium text-[var(--color-text-primary)]"
                    >
                      {GEMINI_MODEL_PRESETS.map((preset) => (
                        <option key={preset.value} value={preset.value}>
                          {preset.label}
                        </option>
                      ))}
                      <option value={CUSTOM_MODEL_OPTION}>
                        自訂模型代號...
                      </option>
                    </select>

                    {isCustomGeminiModel && (
                      <input
                        type="text"
                        value={customGeminiModelInput}
                        onChange={(e) => {
                          const next = e.target.value;
                          setCustomGeminiModelInput(next);
                          const trimmed = next.trim();
                          if (trimmed) {
                            onChangeGeminiModel?.(trimmed);
                          }
                        }}
                        aria-label="自訂 Gemini 模型代號"
                        placeholder="輸入模型 ID（例如：gemini-4-hydrogen）"
                        className="min-h-[42px] w-full rounded-[var(--radius-sm)] border border-[var(--color-border-strong)] bg-[var(--color-bg-surface)] px-3 font-[family-name:var(--font-mono)] text-[length:var(--text-xs)] text-[var(--color-text-primary)]"
                      />
                    )}
                  </div>
                )}

                {currentRemoteProvider === 'openai' && (
                  <div className="space-y-2 border-t border-[var(--color-border-subtle)] pt-3">
                    <label
                      htmlFor="openai-model-select"
                      className="block text-[length:var(--text-xs)] font-bold text-[var(--color-text-primary)]"
                    >
                      OpenAI 模型
                    </label>
                    <select
                      id="openai-model-select"
                      aria-label="OpenAI 模型"
                      data-testid="openai-model-select"
                      value={
                        isCustomOpenAIModel
                          ? CUSTOM_MODEL_OPTION
                          : openaiModel
                      }
                      onChange={(e) => {
                        const selected = e.target.value;
                        if (selected === CUSTOM_MODEL_OPTION) {
                          setIsCustomOpenAIModel(true);
                          setCustomOpenAIModelInput(openaiModel);
                        } else {
                          setIsCustomOpenAIModel(false);
                          setCustomOpenAIModelInput(selected);
                          onChangeOpenAIModel?.(selected);
                        }
                      }}
                      className="min-h-[44px] w-full rounded-[var(--radius-sm)] border border-[var(--color-border-strong)] bg-[var(--color-bg-surface)] px-3 text-[length:var(--text-sm)] font-medium text-[var(--color-text-primary)]"
                    >
                      {OPENAI_MODEL_PRESETS.map((preset) => (
                        <option key={preset.value} value={preset.value}>
                          {preset.label}
                        </option>
                      ))}
                      <option value={CUSTOM_MODEL_OPTION}>
                        自訂模型代號...
                      </option>
                    </select>

                    {!isCustomOpenAIModel && (
                      <p className="text-[length:var(--text-xs)] text-[var(--color-text-secondary)]">
                        {OPENAI_MODEL_PRESETS.find((p) => p.value === openaiModel)?.description}
                      </p>
                    )}

                    {isCustomOpenAIModel && (
                      <input
                        type="text"
                        value={customOpenAIModelInput}
                        onChange={(e) => {
                          const next = e.target.value;
                          setCustomOpenAIModelInput(next);
                          const trimmed = next.trim();
                          if (trimmed) {
                            onChangeOpenAIModel?.(trimmed);
                          }
                        }}
                        aria-label="自訂 OpenAI 模型代號"
                        placeholder="輸入模型 ID（例如：gpt-6-luna）"
                        className="min-h-[42px] w-full rounded-[var(--radius-sm)] border border-[var(--color-border-strong)] bg-[var(--color-bg-surface)] px-3 font-[family-name:var(--font-mono)] text-[length:var(--text-xs)] text-[var(--color-text-primary)]"
                      />
                    )}
                  </div>
                )}

                <div className="border-t border-[var(--color-border-subtle)] pt-2.5 text-[length:var(--text-xs)] text-[var(--color-text-secondary)]">
                  <p className="font-semibold text-[var(--color-text-primary)]">
                    如何取得 API Key：
                  </p>
                  <div className="mt-1 flex flex-wrap gap-3">
                    <a
                      href="https://aistudio.google.com/apikey"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-semibold text-[var(--color-accent-primary)] underline"
                    >
                      <span>前往 Google AI Studio</span>
                      <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </a>
                    <a
                      href="https://platform.openai.com/api-keys"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-semibold text-[var(--color-accent-primary)] underline"
                    >
                      <span>前往 OpenAI Platform</span>
                      <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </a>
                  </div>
                </div>
              </form>
            )}
          </section>

          {/* Optional PWA Install Section */}
          {pwaInstall && !pwaInstall.isInstalled && (pwaInstall.isInstallable || pwaInstall.isIOS) && (
            <section
              aria-labelledby="settings-pwa-heading"
              className="rounded-[var(--radius-md)] border border-[var(--color-accent-primary-border)] bg-[var(--color-accent-primary-soft)] p-3.5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2.5">
                <div className="flex items-start gap-2.5">
                  <Smartphone
                    className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-accent-primary)]"
                    aria-hidden="true"
                  />
                  <div>
                    <h3
                      id="settings-pwa-heading"
                      className="text-[length:var(--text-sm)] font-bold text-[var(--color-text-primary)]"
                    >
                      安裝 AuraStudy 應用程式（PWA）
                    </h3>
                    <p className="text-[length:var(--text-xs)] text-[var(--color-text-secondary)]">
                      {pwaInstall.isIOS
                        ? '請點擊 Safari 分享按鈕並選擇「加入主畫面」，即可以獨立視窗開啟。'
                        : '加入手機或桌面主畫面，以獨立全螢幕視窗快速啟動時間軸。'}
                    </p>
                  </div>
                </div>

                {pwaInstall.isInstallable && (
                  <button
                    type="button"
                    onClick={() => void pwaInstall.onInstall()}
                    className="min-h-[40px] rounded-[var(--radius-sm)] bg-[var(--color-accent-primary)] px-3.5 text-[length:var(--text-xs)] font-bold text-[var(--color-text-inverse)] hover:bg-[var(--color-accent-primary-hover)] whitespace-nowrap"
                  >
                    立即安裝應用程式
                  </button>
                )}
              </div>
            </section>
          )}

          {/* Section 3: Privacy Notice */}
          <section
            aria-labelledby="settings-privacy-heading"
            className="rounded-[var(--radius-md)] border border-[var(--color-border-strong)] bg-[var(--color-bg-subtle)] p-3.5"
          >
            <div className="flex items-start gap-2.5">
              <ShieldAlert
                className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-text-primary)]"
                aria-hidden="true"
              />
              <div className="space-y-1">
                <h3
                  id="settings-privacy-heading"
                  className="text-[length:var(--text-sm)] font-bold text-[var(--color-text-primary)]"
                >
                  隱私權與第三方資料傳輸告知
                </h3>
                <p className="text-[length:var(--text-xs)] leading-relaxed text-[var(--color-text-secondary)]">
                  當您選擇 Google Gemini 或 OpenAI 時，您的對話內容、目前排程上下文與上傳之附件檔案將直接由瀏覽器傳送至所選的 AI 服務供應商進行解析；API Key 僅保存在您的瀏覽器端且絕不寫入系統日誌。請勿於對話或附件中上傳高度機密的個人隱私、證件或密碼。
                </p>
              </div>
            </div>
          </section>
        </div>
    </SpatialMorphModal>
  );
}
