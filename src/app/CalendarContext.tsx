import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { User } from '@supabase/supabase-js';
import {
  acceptProposalChange,
  clearPastCalendarItems,
  createDeadline as createDeadlineCmd,
  createSchedule as createScheduleCmd,
  createTag as createTagCmd,
  deleteCalendarItem as deleteCalendarItemCmd,
  deleteTag as deleteTagCmd,
  rejectProposalChange,
  requestAIProposal,
  syncStaleProposals,
  updateCalendarItem as updateCalendarItemCmd,
  updateTag as updateTagCmd,
  type AcceptProposalChangeOutput,
  type CreateDeadlineCommand,
  type CreateScheduleCommand,
  type DeleteCalendarItemResult,
  type RequestAIProposalOutput,
  type UpdateCalendarItemCommand,
} from '@/application/commands';
import {
  exportUserBackup,
  importUserBackup,
  listCalendarItems,
  proposalFail,
  type AIProvider,
  type ApplicationResult,
  type AuraStudyBackup,
  type BackupResult,
  type CalendarRepository,
  type ChatAttachmentMetadata,
  type ChatMessage,
  type DecisionLogRepository,
  type ImportBackupSummary,
  type ProposalRepository,
  type ProposalResult,
  type RemoteAIProviderType,
  type StoredApiKeyEntry,
  type TagRepository,
} from '@/application/services';
import {
  buildWidgetSnapshot,
  type DateRangeMode,
} from '@/domain/planning';
import type { ProposalChange } from '@/domain/proposals';
import {
  DEFAULT_TAG_SEEDS,
  isItemPast,
  type CalendarItem,
  type CalendarTag,
  type Deadline,
  type Schedule,
  type TagColorPreset,
  type UpdateTagPatch,
} from '@/domain/schedule';
import {
  DEFAULT_GEMINI_MODEL,
  DEFAULT_OPENAI_MODEL,
  GeminiAIProvider,
  MockAIProvider,
  OpenAIProvider,
  clearStoredApiKey,
  deleteStoredApiKeyEntry,
  getAIProviderDisplayName,
  getActiveStoredApiKeyId,
  getPersistKeyInLocalStorage,
  getStoredAIProviderType,
  getStoredApiKey,
  getStoredApiKeyEntries,
  getStoredGeminiModel,
  getStoredOpenAIModel,
  normalizeOpenAIModel,
  renameStoredApiKey,
  saveStoredApiKey,
  setActiveStoredApiKey,
  setStoredAIProviderType,
  setStoredGeminiModel,
  setStoredOpenAIModel,
  type AIProviderType,
} from '@/infrastructure/ai';
import { getSupabaseClient, isSupabaseConfigured } from '@/infrastructure/database';
import {
  InMemoryTagRepository,
  LocalStorageCalendarRepository,
  LocalStorageDecisionLogRepository,
  LocalStorageProposalRepository,
  LocalStorageTagRepository,
  SupabaseCalendarRepository,
  SupabaseDecisionLogRepository,
  SupabaseProposalRepository,
  SupabaseTagRepository,
  isLocalDemoSeedSuppressed,
  isTagSeedCompleted,
  setLocalDemoSeedSuppressed,
  setTagSeedCompleted,
} from '@/infrastructure/repositories';
import {
  ScheduleNotificationScheduler,
  getNotificationsEnabled,
  isNotificationSupported,
  requestNotificationPermission,
  setNotificationsEnabled as persistNotificationsEnabled,
} from '@/infrastructure/notifications';
import { syncWidgetSnapshot } from '@/infrastructure/widget';
import {
  buildIsoFromLocalDateTime,
  getBrowserTimeZone,
  getDateKeyFromInstant,
  getStoredTheme,
  setStoredTheme,
  shiftDateKey,
  type ThemeMode,
} from '@/shared/utils';

interface DeleteCalendarItemCommandInput {
  itemId: string;
  expectedRevision: number;
}

export interface AuthActionResult {
  ok: boolean;
  message?: string;
}

export interface NotificationToggleResult {
  ok: boolean;
  enabled: boolean;
  message?: string;
}

export type CloudSyncStatus = 'idle' | 'syncing' | 'synced' | 'error';

export interface CalendarContextValue {
  userId: string;
  timeZone: string;
  todayDateKey: string;
  referenceNow?: Date;
  selectedDate: string;
  setSelectedDate: (dateKey: string) => void;
  viewMode: DateRangeMode;
  setViewMode: (mode: DateRangeMode) => void;
  items: CalendarItem[];
  deadlines: Deadline[];
  schedules: Schedule[];
  pastItemsCount: number;
  tags: CalendarTag[];
  selectedTagFilter: string | null;
  setSelectedTagFilter: (tagName: string | null) => void;
  proposals: ProposalChange[];
  visibleProposals: ProposalChange[];
  chatMessages: ChatMessage[];
  clearChatMessages: () => void;
  lastRejectedProposal: ProposalChange | null;
  isGeneratingProposal: boolean;
  isLoading: boolean;
  // Phase 4: Auth & Dual-mode state
  isSupabaseMode: boolean;
  authUser: User | null;
  isAuthBusy: boolean;
  cloudSyncStatus: CloudSyncStatus;
  cloudSyncError: string | null;
  lastCloudSyncAt: string | null;
  syncToCloudNow: () => Promise<AuthActionResult>;
  signInWithEmail: (email: string, password: string) => Promise<AuthActionResult>;
  signUpWithEmail: (email: string, password: string) => Promise<AuthActionResult>;
  signOut: () => Promise<void>;
  clearPastData: () => Promise<number>;
  exportBackup: () => Promise<AuraStudyBackup>;
  importBackup: (rawJson: string) => Promise<BackupResult<ImportBackupSummary>>;
  // Phase 4: AI Provider & BYOK state
  aiProviderType: AIProviderType;
  aiProviderLabel: string;
  geminiModel: string;
  openaiModel: string;
  isAIProviderReady: boolean;
  persistKeyInLocalStorage: boolean;
  hasSavedApiKey: (provider: RemoteAIProviderType) => boolean;
  getApiKeyEntries: (provider: RemoteAIProviderType) => StoredApiKeyEntry[];
  getActiveApiKeyId: (provider: RemoteAIProviderType) => string | null;
  setAIProviderType: (provider: AIProviderType) => void;
  setGeminiModel: (model: string) => void;
  setOpenAIModel: (model: string) => void;
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  notificationsEnabled: boolean;
  toggleNotifications: (enabled: boolean) => Promise<NotificationToggleResult>;
  saveApiKey: (
    provider: RemoteAIProviderType,
    apiKey: string,
    persistInLocal: boolean,
    label?: string,
  ) => void;
  selectApiKey: (provider: RemoteAIProviderType, entryId: string) => void;
  renameApiKey: (
    provider: RemoteAIProviderType,
    entryId: string,
    label: string,
  ) => void;
  deleteApiKeyEntry: (provider: RemoteAIProviderType, entryId: string) => void;
  clearApiKey: (provider: RemoteAIProviderType) => void;
  refreshItems: () => Promise<void>;
  createDeadline: (
    input: Omit<CreateDeadlineCommand, 'userId'>,
  ) => Promise<ApplicationResult<Deadline>>;
  createSchedule: (
    input: Omit<CreateScheduleCommand, 'userId'>,
  ) => Promise<ApplicationResult<Schedule>>;
  updateItem: (
    input: Omit<UpdateCalendarItemCommand, 'userId'>,
  ) => Promise<ApplicationResult<CalendarItem>>;
  deleteItem: (
    input: Omit<DeleteCalendarItemCommandInput, 'userId'>,
  ) => Promise<ApplicationResult<DeleteCalendarItemResult>>;
  createTag: (input: {
    name: string;
    color: TagColorPreset;
  }) => Promise<ApplicationResult<CalendarTag>>;
  updateTag: (input: {
    tagId: string;
    patch: UpdateTagPatch;
  }) => Promise<ApplicationResult<CalendarTag>>;
  deleteTag: (
    tagId: string,
  ) => Promise<ApplicationResult<{ deletedId: string; detachedCount: number }>>;
  sendChatMessage: (
    userMessage: string,
    attachments?: readonly ChatAttachmentMetadata[],
  ) => Promise<ProposalResult<RequestAIProposalOutput>>;
  acceptProposal: (
    changeId: string,
    options?: { allowConflict?: boolean },
  ) => Promise<ProposalResult<AcceptProposalChangeOutput>>;
  rejectProposal: (changeId: string) => Promise<ProposalResult<ProposalChange>>;
}

const CalendarContext = createContext<CalendarContextValue | null>(null);

export interface CalendarProviderProps {
  children: ReactNode;
  repository?: CalendarRepository;
  tagRepository?: TagRepository;
  proposalRepository?: ProposalRepository;
  decisionLogRepository?: DecisionLogRepository;
  aiProvider?: AIProvider;
  userId?: string;
  timeZone?: string;
  initialDate?: string;
  referenceNow?: Date;
  initialViewMode?: DateRangeMode;
  seedDemoData?: boolean;
  initialAIProviderType?: AIProviderType;
}

export function CalendarProvider({
  children,
  repository: providedRepository,
  tagRepository: providedTagRepository,
  proposalRepository: providedProposalRepository,
  decisionLogRepository: providedDecisionLogRepository,
  aiProvider: providedAIProvider,
  userId: defaultUserId = 'demo-student',
  timeZone: providedTimeZone,
  initialDate,
  referenceNow: providedReferenceNow,
  initialViewMode = 'week',
  seedDemoData = true,
  initialAIProviderType,
}: CalendarProviderProps) {
  const supabaseClient = useMemo(() => getSupabaseClient(), []);
  const isSupabaseMode = isSupabaseConfigured() && supabaseClient !== null;

  const [authUser, setAuthUser] = useState<User | null>(null);
  const [isAuthBusy, setIsAuthBusy] = useState<boolean>(false);

  useEffect(() => {
    if (!supabaseClient) {
      return;
    }

    let active = true;
    void supabaseClient.auth.getSession().then(({ data }) => {
      if (active) {
        setAuthUser(data.session?.user ?? null);
      }
    });

    const { data: subscription } = supabaseClient.auth.onAuthStateChange(
      (_event, session) => {
        if (active) {
          setAuthUser(session?.user ?? null);
        }
      },
    );

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, [supabaseClient]);

  const effectiveUserId = authUser?.id ?? defaultUserId;
  const usingSupabaseRepositories = Boolean(
    isSupabaseMode && supabaseClient && authUser && !providedRepository,
  );
  const usingLocalStoragePersistence = Boolean(
    !usingSupabaseRepositories && !providedRepository,
  );

  const localFallbackCalendarRepo = useMemo(
    () => providedRepository ?? new LocalStorageCalendarRepository(),
    [providedRepository],
  );
  const localFallbackTagRepo = useMemo(
    () =>
      providedTagRepository ??
      (providedRepository ? new InMemoryTagRepository() : new LocalStorageTagRepository()),
    [providedRepository, providedTagRepository],
  );
  const localFallbackProposalRepo = useMemo(
    () => providedProposalRepository ?? new LocalStorageProposalRepository(),
    [providedProposalRepository],
  );
  const localFallbackDecisionLogRepo = useMemo(
    () =>
      providedDecisionLogRepository ?? new LocalStorageDecisionLogRepository(),
    [providedDecisionLogRepository],
  );

  const repository = useMemo<CalendarRepository>(() => {
    if (usingSupabaseRepositories && supabaseClient) {
      return new SupabaseCalendarRepository(supabaseClient);
    }
    return localFallbackCalendarRepo;
  }, [localFallbackCalendarRepo, supabaseClient, usingSupabaseRepositories]);

  const tagRepository = useMemo<TagRepository>(() => {
    if (usingSupabaseRepositories && supabaseClient) {
      return new SupabaseTagRepository(supabaseClient);
    }
    return localFallbackTagRepo;
  }, [localFallbackTagRepo, supabaseClient, usingSupabaseRepositories]);

  const proposalRepository = useMemo<ProposalRepository>(() => {
    if (usingSupabaseRepositories && supabaseClient && authUser) {
      return new SupabaseProposalRepository(supabaseClient, authUser.id);
    }
    return localFallbackProposalRepo;
  }, [authUser, localFallbackProposalRepo, supabaseClient, usingSupabaseRepositories]);

  const decisionLogRepository = useMemo<DecisionLogRepository>(() => {
    if (usingSupabaseRepositories && supabaseClient && authUser) {
      return new SupabaseDecisionLogRepository(supabaseClient, authUser.id);
    }
    return localFallbackDecisionLogRepo;
  }, [
    authUser,
    localFallbackDecisionLogRepo,
    supabaseClient,
    usingSupabaseRepositories,
  ]);

  const [aiProviderType, setAIProviderTypeState] = useState<AIProviderType>(() =>
    initialAIProviderType ?? getStoredAIProviderType(),
  );
  const [geminiModel, setGeminiModelState] = useState<string>(() =>
    getStoredGeminiModel(),
  );
  const [openaiModel, setOpenAIModelState] = useState<string>(() =>
    getStoredOpenAIModel(),
  );
  const [geminiKey, setGeminiKey] = useState<string>(() =>
    getStoredApiKey('gemini'),
  );
  const [openaiKey, setOpenaiKey] = useState<string>(() =>
    getStoredApiKey('openai'),
  );
  const [geminiKeyEntries, setGeminiKeyEntries] = useState<StoredApiKeyEntry[]>(
    () => getStoredApiKeyEntries('gemini'),
  );
  const [openaiKeyEntries, setOpenaiKeyEntries] = useState<StoredApiKeyEntry[]>(
    () => getStoredApiKeyEntries('openai'),
  );
  const [activeGeminiKeyId, setActiveGeminiKeyId] = useState<string | null>(
    () => getActiveStoredApiKeyId('gemini'),
  );
  const [activeOpenaiKeyId, setActiveOpenaiKeyId] = useState<string | null>(
    () => getActiveStoredApiKeyId('openai'),
  );
  const [persistKeyInLocalStorage, setPersistKeyInLocalStorage] = useState<boolean>(
    () => getPersistKeyInLocalStorage(),
  );

  const syncProviderKeyState = useCallback((provider: RemoteAIProviderType) => {
    const activeKey = getStoredApiKey(provider);
    const entries = getStoredApiKeyEntries(provider);
    const activeId = getActiveStoredApiKeyId(provider);
    if (provider === 'gemini') {
      setGeminiKey(activeKey);
      setGeminiKeyEntries(entries);
      setActiveGeminiKeyId(activeId);
    } else {
      setOpenaiKey(activeKey);
      setOpenaiKeyEntries(entries);
      setActiveOpenaiKeyId(activeId);
    }
  }, []);

  const setAIProviderType = useCallback((provider: AIProviderType) => {
    setAIProviderTypeState(provider);
    setStoredAIProviderType(provider);
  }, []);

  const setGeminiModel = useCallback((model: string) => {
    const normalized = model.trim() || DEFAULT_GEMINI_MODEL;
    setGeminiModelState(normalized);
    setStoredGeminiModel(normalized);
  }, []);

  const setOpenAIModel = useCallback((model: string) => {
    const normalized = normalizeOpenAIModel(model || DEFAULT_OPENAI_MODEL);
    setOpenAIModelState(normalized);
    setStoredOpenAIModel(normalized);
  }, []);

  const saveApiKey = useCallback(
    (
      provider: RemoteAIProviderType,
      apiKey: string,
      persistInLocal: boolean,
      label?: string,
    ) => {
      const trimmed = apiKey.trim();
      saveStoredApiKey(provider, trimmed, persistInLocal, label);
      setPersistKeyInLocalStorage(persistInLocal);
      syncProviderKeyState(provider);
    },
    [syncProviderKeyState],
  );

  const selectApiKey = useCallback(
    (provider: RemoteAIProviderType, entryId: string) => {
      setActiveStoredApiKey(provider, entryId, persistKeyInLocalStorage);
      syncProviderKeyState(provider);
    },
    [persistKeyInLocalStorage, syncProviderKeyState],
  );

  const renameApiKey = useCallback(
    (provider: RemoteAIProviderType, entryId: string, label: string) => {
      renameStoredApiKey(provider, entryId, label, persistKeyInLocalStorage);
      syncProviderKeyState(provider);
    },
    [persistKeyInLocalStorage, syncProviderKeyState],
  );

  const deleteApiKeyEntry = useCallback(
    (provider: RemoteAIProviderType, entryId: string) => {
      deleteStoredApiKeyEntry(provider, entryId, persistKeyInLocalStorage);
      syncProviderKeyState(provider);
    },
    [persistKeyInLocalStorage, syncProviderKeyState],
  );

  const clearApiKey = useCallback(
    (provider: RemoteAIProviderType) => {
      clearStoredApiKey(provider);
      syncProviderKeyState(provider);
    },
    [syncProviderKeyState],
  );

  const hasSavedApiKey = useCallback(
    (provider: RemoteAIProviderType) => {
      return provider === 'gemini' ? geminiKey.length > 0 : openaiKey.length > 0;
    },
    [geminiKey, openaiKey],
  );

  const getApiKeyEntries = useCallback(
    (provider: RemoteAIProviderType) => {
      return provider === 'gemini' ? geminiKeyEntries : openaiKeyEntries;
    },
    [geminiKeyEntries, openaiKeyEntries],
  );

  const getActiveApiKeyId = useCallback(
    (provider: RemoteAIProviderType) => {
      return provider === 'gemini' ? activeGeminiKeyId : activeOpenaiKeyId;
    },
    [activeGeminiKeyId, activeOpenaiKeyId],
  );

  const isAIProviderReady = useMemo(() => {
    if (providedAIProvider) {
      return true;
    }
    if (aiProviderType === 'demo') {
      return true;
    }
    if (aiProviderType === 'gemini') {
      return geminiKey.trim().length > 0;
    }
    return openaiKey.trim().length > 0;
  }, [aiProviderType, geminiKey, openaiKey, providedAIProvider]);

  const aiProvider = useMemo<AIProvider>(() => {
    if (providedAIProvider) {
      return providedAIProvider;
    }
    if (aiProviderType === 'gemini') {
      return new GeminiAIProvider({ apiKey: geminiKey, model: geminiModel });
    }
    if (aiProviderType === 'openai') {
      return new OpenAIProvider({ apiKey: openaiKey, model: openaiModel });
    }
    return new MockAIProvider();
  }, [
    aiProviderType,
    geminiKey,
    geminiModel,
    openaiKey,
    openaiModel,
    providedAIProvider,
  ]);

  const aiProviderLabel = useMemo(
    () => getAIProviderDisplayName(aiProviderType),
    [aiProviderType],
  );

  const timeZone = useMemo(
    () => providedTimeZone ?? getBrowserTimeZone(),
    [providedTimeZone],
  );
  const todayDateKey = useMemo(
    () => initialDate ?? getDateKeyFromInstant(new Date(), timeZone),
    [initialDate, timeZone],
  );

  const [theme, setThemeState] = useState<ThemeMode>(() => getStoredTheme());
  const [notificationsEnabled, setNotificationsEnabledState] = useState<boolean>(
    () => getNotificationsEnabled(),
  );
  const notificationSchedulerRef = useRef<ScheduleNotificationScheduler | null>(null);

  const setTheme = useCallback((nextTheme: ThemeMode) => {
    setThemeState(nextTheme);
    setStoredTheme(nextTheme);
  }, []);

  const toggleNotifications = useCallback(
    async (nextEnabled: boolean): Promise<NotificationToggleResult> => {
      if (!nextEnabled) {
        persistNotificationsEnabled(false);
        setNotificationsEnabledState(false);
        return {
          ok: true,
          enabled: false,
          message: '已關閉行程提醒通知。',
        };
      }

      if (!isNotificationSupported()) {
        persistNotificationsEnabled(false);
        setNotificationsEnabledState(false);
        return {
          ok: false,
          enabled: false,
          message: '此瀏覽器或裝置環境不支援系統通知功能，請改用支援 Web Notifications 的瀏覽器。',
        };
      }

      const permission = await requestNotificationPermission();
      if (permission === 'granted') {
        persistNotificationsEnabled(true);
        setNotificationsEnabledState(true);
        return {
          ok: true,
          enabled: true,
          message: '已開啟行程提醒通知。',
        };
      }

      persistNotificationsEnabled(false);
      setNotificationsEnabledState(false);
      return {
        ok: false,
        enabled: false,
        message: '請至瀏覽器或手機系統設定允許 AuraStudy 通知權限。',
      };
    },
    [],
  );

  const effectiveReferenceNow = useMemo<Date | undefined>(() => {
    if (providedReferenceNow) {
      return providedReferenceNow;
    }
    if (initialDate) {
      return new Date(buildIsoFromLocalDateTime(initialDate, '00:00', timeZone));
    }
    return undefined;
  }, [initialDate, providedReferenceNow, timeZone]);

  const [selectedDate, setSelectedDate] = useState<string>(todayDateKey);
  const [viewMode, setViewMode] = useState<DateRangeMode>(initialViewMode);
  const [items, setItems] = useState<CalendarItem[]>([]);
  const [deadlines, setDeadlines] = useState<Deadline[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [tags, setTags] = useState<CalendarTag[]>([]);
  const [selectedTagFilter, setSelectedTagFilter] = useState<string | null>(null);
  const [proposals, setProposals] = useState<ProposalChange[]>([]);
  // Pure RAM chat state: resets cleanly when page/app closes or restarts
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [lastRejectedProposal, setLastRejectedProposal] =
    useState<ProposalChange | null>(null);
  const [isGeneratingProposal, setIsGeneratingProposal] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [cloudSyncStatus, setCloudSyncStatus] = useState<CloudSyncStatus>('idle');
  const [cloudSyncError, setCloudSyncError] = useState<string | null>(null);
  const [lastCloudSyncAt, setLastCloudSyncAt] = useState<string | null>(null);
  const clearedByUserRef = useRef<boolean>(false);
  const cloudSyncQueueRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    if (!notificationSchedulerRef.current) {
      notificationSchedulerRef.current = new ScheduleNotificationScheduler();
    }
    const scheduler = notificationSchedulerRef.current;
    scheduler.sync(items, timeZone, notificationsEnabled);
  }, [items, notificationsEnabled, timeZone]);

  useEffect(() => {
    return () => {
      notificationSchedulerRef.current?.dispose();
      notificationSchedulerRef.current = null;
    };
  }, []);

  const clearChatMessages = useCallback(() => {
    setChatMessages([]);
    setLastRejectedProposal(null);
  }, []);

  const runCloudSnapshotOverwrite = useCallback(
    async (
      snapshotItems: readonly CalendarItem[],
      snapshotTags: readonly CalendarTag[],
    ): Promise<AuthActionResult> => {
      if (!usingSupabaseRepositories) {
        return { ok: true, message: '目前為本機模式。' };
      }

      const task = async (): Promise<AuthActionResult> => {
        setCloudSyncStatus('syncing');
        setCloudSyncError(null);
        try {
          if (repository.syncSnapshot) {
            await repository.syncSnapshot(effectiveUserId, snapshotItems);
          }
          if (tagRepository.syncSnapshot) {
            await tagRepository.syncSnapshot(effectiveUserId, snapshotTags);
          }
          setCloudSyncStatus('synced');
          setLastCloudSyncAt(new Date().toISOString());
          return {
            ok: true,
            message: `已覆蓋上傳至雲端（${snapshotItems.length} 筆行程、${snapshotTags.length} 個標籤）。`,
          };
        } catch (error) {
          const message =
            error instanceof Error ? error.message : '雲端覆蓋同步失敗，請稍後再試。';
          setCloudSyncStatus('error');
          setCloudSyncError(message);
          return { ok: false, message };
        }
      };

      const queued = cloudSyncQueueRef.current.then(task, task);
      cloudSyncQueueRef.current = queued.then(
        () => undefined,
        () => undefined,
      );
      return queued;
    },
    [effectiveUserId, repository, tagRepository, usingSupabaseRepositories],
  );

  const loadFromRepository = useCallback(
    async (options?: { syncCloudAfterLoad?: boolean }) => {
      const [calendarRes, allTags, allProposals] = await Promise.all([
        listCalendarItems(repository, { userId: effectiveUserId }),
        tagRepository.listByUser(effectiveUserId),
        proposalRepository.listAll(),
      ]);
      if (calendarRes.ok) {
        setItems(calendarRes.data.items);
        setDeadlines(calendarRes.data.deadlines);
        setSchedules(calendarRes.data.schedules);
        syncWidgetSnapshot(
          buildWidgetSnapshot(calendarRes.data.items, {
            now: initialDate ?? new Date(),
            timeZone,
          }),
        );
        if (options?.syncCloudAfterLoad && usingSupabaseRepositories) {
          await runCloudSnapshotOverwrite(calendarRes.data.items, allTags);
        }
      }
      setTags(allTags);
      setSelectedTagFilter((prev) =>
        prev && !allTags.some((t) => t.name === prev) ? null : prev,
      );
      setProposals(allProposals);
    },
    [
      effectiveUserId,
      initialDate,
      proposalRepository,
      repository,
      runCloudSnapshotOverwrite,
      tagRepository,
      timeZone,
      usingSupabaseRepositories,
    ],
  );

  useEffect(() => {
    let active = true;

    async function initialize() {
      setIsLoading(true);
      const [initial, existingTags] = await Promise.all([
        listCalendarItems(repository, {
          userId: effectiveUserId,
        }),
        tagRepository.listByUser(effectiveUserId),
      ]);

      const isSuppressed =
        clearedByUserRef.current ||
        (usingLocalStoragePersistence && isLocalDemoSeedSuppressed());

      const shouldSeedTags =
        existingTags.length === 0 &&
        !isSuppressed &&
        (!usingLocalStoragePersistence || !isTagSeedCompleted());

      if (shouldSeedTags) {
        for (const seed of DEFAULT_TAG_SEEDS) {
          await createTagCmd(tagRepository, {
            userId: effectiveUserId,
            name: seed.name,
            color: seed.color,
          });
        }
        if (usingLocalStoragePersistence) {
          setTagSeedCompleted(true);
        }
      }

      const shouldSeedDemo =
        initial.ok &&
        initial.data.items.length === 0 &&
        seedDemoData &&
        !usingSupabaseRepositories &&
        !isSuppressed;

      if (shouldSeedDemo) {
        const seedReferenceNow = new Date(
          buildIsoFromLocalDateTime(todayDateKey, '00:00', timeZone),
        );
        const deadlineDateKey = shiftDateKey(todayDateKey, 2);
        await createDeadlineCmd(repository, {
          userId: effectiveUserId,
          title: '演算法作業 3 繳交',
          dueDate: deadlineDateKey,
          tag: '課業',
          description: '完成動態規劃與貪心演算法證明並上傳 PDF。',
          status: 'pending',
          referenceNow: seedReferenceNow,
          timeZone,
        });

        await createScheduleCmd(repository, {
          userId: effectiveUserId,
          title: '線性代數重點複習',
          startAt: buildIsoFromLocalDateTime(todayDateKey, '09:00', timeZone),
          endAt: buildIsoFromLocalDateTime(todayDateKey, '10:30', timeZone),
          tag: '課業',
          description: '特徵值與對角化章節精讀。',
          status: 'scheduled',
          referenceNow: seedReferenceNow,
          timeZone,
        });

        await createScheduleCmd(repository, {
          userId: effectiveUserId,
          title: '計算機結構實作練習',
          startAt: buildIsoFromLocalDateTime(todayDateKey, '14:00', timeZone),
          endAt: buildIsoFromLocalDateTime(todayDateKey, '16:00', timeZone),
          tag: '專題',
          description: 'Pipeline Hazard 模擬題組演練。',
          status: 'scheduled',
          referenceNow: seedReferenceNow,
          timeZone,
        });
      }

      if (!active) return;
      await loadFromRepository();
      if (active) {
        setIsLoading(false);
      }
    }

    void initialize();

    return () => {
      active = false;
    };
  }, [
    effectiveUserId,
    loadFromRepository,
    repository,
    seedDemoData,
    tagRepository,
    timeZone,
    todayDateKey,
    usingLocalStoragePersistence,
    usingSupabaseRepositories,
  ]);

  const signInWithEmail = useCallback(
    async (email: string, password: string): Promise<AuthActionResult> => {
      if (!supabaseClient) {
        return { ok: false, message: '尚未設定 Supabase 連線環境。' };
      }
      setIsAuthBusy(true);
      try {
        const { error } = await supabaseClient.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) {
          return { ok: false, message: `登入失敗：${error.message}` };
        }
        return { ok: true, message: '已成功登入。' };
      } finally {
        setIsAuthBusy(false);
      }
    },
    [supabaseClient],
  );

  const signUpWithEmail = useCallback(
    async (email: string, password: string): Promise<AuthActionResult> => {
      if (!supabaseClient) {
        return { ok: false, message: '尚未設定 Supabase 連線環境。' };
      }
      setIsAuthBusy(true);
      try {
        const { data, error } = await supabaseClient.auth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo:
              typeof window !== 'undefined' ? window.location.origin : undefined,
          },
        });
        if (error) {
          return { ok: false, message: `註冊失敗：${error.message}` };
        }
        if (!data.session) {
          return {
            ok: true,
            message: '註冊成功！請至信箱點擊驗證連結後再登入',
          };
        }
        return { ok: true, message: '註冊並登入成功。' };
      } finally {
        setIsAuthBusy(false);
      }
    },
    [supabaseClient],
  );

  const signOut = useCallback(async () => {
    if (!supabaseClient) return;
    setIsAuthBusy(true);
    try {
      await supabaseClient.auth.signOut();
      setChatMessages([]);
      setLastRejectedProposal(null);
    } finally {
      setIsAuthBusy(false);
    }
  }, [supabaseClient]);

  const clearPastData = useCallback(async (): Promise<number> => {
    const result = await clearPastCalendarItems(repository, {
      userId: effectiveUserId,
      referenceNow: effectiveReferenceNow,
      timeZone,
    });
    if (!result.ok) {
      return 0;
    }

    if (usingLocalStoragePersistence) {
      setLocalDemoSeedSuppressed(true);
      setTagSeedCompleted(true);
    }
    if (result.data.remainingItems.length === 0) {
      clearedByUserRef.current = true;
    }

    await syncStaleProposals(
      { calendarRepository: repository, proposalRepository },
      { userId: effectiveUserId },
    );
    await loadFromRepository({ syncCloudAfterLoad: true });
    return result.data.deletedCount;
  }, [
    effectiveReferenceNow,
    effectiveUserId,
    loadFromRepository,
    proposalRepository,
    repository,
    timeZone,
    usingLocalStoragePersistence,
  ]);

  const syncToCloudNow = useCallback(async (): Promise<AuthActionResult> => {
    if (!usingSupabaseRepositories) {
      return { ok: false, message: '請先登入 Supabase 雲端帳號後再同步。' };
    }
    return runCloudSnapshotOverwrite(items, tags);
  }, [items, runCloudSnapshotOverwrite, tags, usingSupabaseRepositories]);

  const exportBackup = useCallback(async () => {
    return exportUserBackup(repository, effectiveUserId, undefined, tagRepository);
  }, [effectiveUserId, repository, tagRepository]);

  const importBackup = useCallback(
    async (rawJson: string) => {
      const result = await importUserBackup(
        repository,
        effectiveUserId,
        rawJson,
        undefined,
        tagRepository,
      );
      if (result.ok) {
        clearedByUserRef.current = false;
        if (usingLocalStoragePersistence) {
          setLocalDemoSeedSuppressed(false);
        }
        await syncStaleProposals(
          { calendarRepository: repository, proposalRepository },
          { userId: effectiveUserId },
        );
        await loadFromRepository({ syncCloudAfterLoad: true });
      }
      return result;
    },
    [
      effectiveUserId,
      loadFromRepository,
      proposalRepository,
      repository,
      tagRepository,
      usingLocalStoragePersistence,
    ],
  );

  const createDeadline = useCallback(
    async (input: Omit<CreateDeadlineCommand, 'userId'>) => {
      const result = await createDeadlineCmd(repository, {
        ...input,
        userId: effectiveUserId,
        referenceNow: input.referenceNow ?? effectiveReferenceNow,
        timeZone: input.timeZone ?? timeZone,
      });
      if (result.ok) {
        clearedByUserRef.current = false;
        if (usingLocalStoragePersistence) {
          setLocalDemoSeedSuppressed(false);
        }
        await loadFromRepository({ syncCloudAfterLoad: true });
      }
      return result;
    },
    [
      effectiveReferenceNow,
      effectiveUserId,
      loadFromRepository,
      repository,
      timeZone,
      usingLocalStoragePersistence,
    ],
  );

  const createSchedule = useCallback(
    async (input: Omit<CreateScheduleCommand, 'userId'>) => {
      const result = await createScheduleCmd(repository, {
        ...input,
        userId: effectiveUserId,
        referenceNow: input.referenceNow ?? effectiveReferenceNow,
        timeZone: input.timeZone ?? timeZone,
      });
      if (result.ok) {
        clearedByUserRef.current = false;
        if (usingLocalStoragePersistence) {
          setLocalDemoSeedSuppressed(false);
        }
        await loadFromRepository({ syncCloudAfterLoad: true });
      }
      return result;
    },
    [
      effectiveReferenceNow,
      effectiveUserId,
      loadFromRepository,
      repository,
      timeZone,
      usingLocalStoragePersistence,
    ],
  );

  const updateItem = useCallback(
    async (input: Omit<UpdateCalendarItemCommand, 'userId'>) => {
      const result = await updateCalendarItemCmd(repository, {
        ...input,
        userId: effectiveUserId,
        referenceNow: input.referenceNow ?? effectiveReferenceNow,
        timeZone: input.timeZone ?? timeZone,
      });
      if (result.ok) {
        await syncStaleProposals(
          { calendarRepository: repository, proposalRepository },
          { userId: effectiveUserId },
        );
        await loadFromRepository({ syncCloudAfterLoad: true });
      }
      return result;
    },
    [
      effectiveReferenceNow,
      effectiveUserId,
      loadFromRepository,
      proposalRepository,
      repository,
      timeZone,
    ],
  );

  const deleteItem = useCallback(
    async (input: Omit<DeleteCalendarItemCommandInput, 'userId'>) => {
      const result = await deleteCalendarItemCmd(repository, {
        ...input,
        userId: effectiveUserId,
      });
      if (result.ok) {
        await syncStaleProposals(
          { calendarRepository: repository, proposalRepository },
          { userId: effectiveUserId },
        );
        await loadFromRepository({ syncCloudAfterLoad: true });
      }
      return result;
    },
    [effectiveUserId, loadFromRepository, proposalRepository, repository],
  );

  const createTag = useCallback(
    async (input: { name: string; color: TagColorPreset }) => {
      const result = await createTagCmd(tagRepository, {
        userId: effectiveUserId,
        name: input.name,
        color: input.color,
      });
      if (result.ok) {
        if (usingLocalStoragePersistence) {
          setTagSeedCompleted(true);
        }
        await loadFromRepository({ syncCloudAfterLoad: true });
      }
      return result;
    },
    [effectiveUserId, loadFromRepository, tagRepository, usingLocalStoragePersistence],
  );

  const updateTag = useCallback(
    async (input: { tagId: string; patch: UpdateTagPatch }) => {
      const previous = tags.find((t) => t.id === input.tagId);
      const result = await updateTagCmd(tagRepository, repository, {
        userId: effectiveUserId,
        tagId: input.tagId,
        patch: input.patch,
      });
      if (result.ok) {
        if (previous && selectedTagFilter === previous.name && result.data.name !== previous.name) {
          setSelectedTagFilter(result.data.name);
        }
        await loadFromRepository({ syncCloudAfterLoad: true });
      }
      return result;
    },
    [effectiveUserId, loadFromRepository, repository, selectedTagFilter, tagRepository, tags],
  );

  const deleteTag = useCallback(
    async (tagId: string) => {
      const target = tags.find((t) => t.id === tagId);
      const result = await deleteTagCmd(tagRepository, repository, {
        userId: effectiveUserId,
        tagId,
      });
      if (result.ok) {
        if (target && selectedTagFilter === target.name) {
          setSelectedTagFilter(null);
        }
        await loadFromRepository({ syncCloudAfterLoad: true });
      }
      return result;
    },
    [effectiveUserId, loadFromRepository, repository, selectedTagFilter, tagRepository, tags],
  );

  const sendChatMessage = useCallback(
    async (
      userMessage: string,
      attachments?: readonly ChatAttachmentMetadata[],
    ) => {
      const now = new Date().toISOString();
      const userMsg: ChatMessage = {
        id: `msg-u-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        role: 'user',
        content: userMessage,
        ...(attachments && attachments.length > 0 ? { attachments } : {}),
        createdAt: now,
      };
      setChatMessages((prev) => [...prev, userMsg]);
      setIsGeneratingProposal(true);

      try {
        const result = await requestAIProposal(
          {
            calendarRepository: repository,
            proposalRepository,
            decisionLogRepository,
            aiProvider,
          },
          {
            userId: effectiveUserId,
            timeZone,
            selectedDate,
            userMessage,
            attachments,
            recentMessages: chatMessages,
            lastRejectedProposalId: lastRejectedProposal?.id,
          },
        );

        if (result.ok) {
          const assistantMsg: ChatMessage = {
            id: `msg-a-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            role: 'assistant',
            content: result.data.assistantMessage,
            proposalId: result.data.proposalId,
            createdAt: new Date().toISOString(),
          };
          setChatMessages((prev) => [...prev, assistantMsg]);
          setLastRejectedProposal(null);
          await loadFromRepository();
        } else {
          const errorMsg: ChatMessage = {
            id: `msg-e-${Date.now()}`,
            role: 'assistant',
            content: `提案產生失敗：${result.error.message}`,
            createdAt: new Date().toISOString(),
          };
          setChatMessages((prev) => [...prev, errorMsg]);
        }

        return result;
      } catch (error) {
        const message =
          error instanceof Error && error.message.trim()
            ? error.message
            : '提案產生或儲存時發生未預期錯誤，請稍後再試。';
        const errorMsg: ChatMessage = {
          id: `msg-e-${Date.now()}`,
          role: 'assistant',
          content: `提案產生失敗：${message}`,
          createdAt: new Date().toISOString(),
        };
        setChatMessages((prev) => [...prev, errorMsg]);
        return proposalFail({
          code: 'APPLICATION_ERROR',
          message,
        });
      } finally {
        setIsGeneratingProposal(false);
      }
    },
    [
      aiProvider,
      chatMessages,
      decisionLogRepository,
      effectiveUserId,
      lastRejectedProposal,
      loadFromRepository,
      proposalRepository,
      repository,
      selectedDate,
      timeZone,
    ],
  );

  const acceptProposal = useCallback(
    async (changeId: string, options?: { allowConflict?: boolean }) => {
      const result = await acceptProposalChange(
        {
          calendarRepository: repository,
          proposalRepository,
          decisionLogRepository,
        },
        {
          userId: effectiveUserId,
          changeId,
          allowConflict: options?.allowConflict,
          referenceNow: effectiveReferenceNow,
          timeZone,
        },
      );
      if (result.ok && result.data.appliedItem) {
        clearedByUserRef.current = false;
        if (usingLocalStoragePersistence) {
          setLocalDemoSeedSuppressed(false);
        }
      }
      await loadFromRepository({ syncCloudAfterLoad: true });
      return result;
    },
    [
      decisionLogRepository,
      effectiveReferenceNow,
      effectiveUserId,
      loadFromRepository,
      proposalRepository,
      repository,
      timeZone,
      usingLocalStoragePersistence,
    ],
  );

  const rejectProposal = useCallback(
    async (changeId: string) => {
      const result = await rejectProposalChange(
        {
          proposalRepository,
          decisionLogRepository,
        },
        {
          userId: effectiveUserId,
          changeId,
        },
      );
      if (result.ok) {
        setLastRejectedProposal(result.data);
      }
      await loadFromRepository();
      return result;
    },
    [decisionLogRepository, effectiveUserId, loadFromRepository, proposalRepository],
  );

  const visibleProposals = useMemo(
    () =>
      proposals.filter((p) => p.status === 'pending' || p.status === 'stale'),
    [proposals],
  );

  const pastItemsCount = useMemo(() => {
    const refDate = effectiveReferenceNow ?? new Date();
    return items.filter((item) => isItemPast(item, refDate, timeZone)).length;
  }, [effectiveReferenceNow, items, timeZone]);

  const value = useMemo<CalendarContextValue>(
    () => ({
      userId: effectiveUserId,
      timeZone,
      todayDateKey,
      referenceNow: effectiveReferenceNow,
      selectedDate,
      setSelectedDate,
      viewMode,
      setViewMode,
      items,
      deadlines,
      schedules,
      pastItemsCount,
      tags,
      selectedTagFilter,
      setSelectedTagFilter,
      proposals,
      visibleProposals,
      chatMessages,
      clearChatMessages,
      lastRejectedProposal,
      isGeneratingProposal,
      isLoading,
      isSupabaseMode,
      authUser,
      isAuthBusy,
      cloudSyncStatus,
      cloudSyncError,
      lastCloudSyncAt,
      syncToCloudNow,
      signInWithEmail,
      signUpWithEmail,
      signOut,
      clearPastData,
      exportBackup,
      importBackup,
      aiProviderType,
      aiProviderLabel,
      geminiModel,
      openaiModel,
      isAIProviderReady,
      persistKeyInLocalStorage,
      hasSavedApiKey,
      getApiKeyEntries,
      getActiveApiKeyId,
      setAIProviderType,
      setGeminiModel,
      setOpenAIModel,
      theme,
      setTheme,
      notificationsEnabled,
      toggleNotifications,
      saveApiKey,
      selectApiKey,
      renameApiKey,
      deleteApiKeyEntry,
      clearApiKey,
      refreshItems: () => loadFromRepository(),
      createDeadline,
      createSchedule,
      updateItem,
      deleteItem,
      createTag,
      updateTag,
      deleteTag,
      sendChatMessage,
      acceptProposal,
      rejectProposal,
    }),
    [
      acceptProposal,
      aiProviderLabel,
      aiProviderType,
      authUser,
      chatMessages,
      clearApiKey,
      clearChatMessages,
      clearPastData,
      cloudSyncError,
      cloudSyncStatus,
      createDeadline,
      createSchedule,
      createTag,
      deadlines,
      deleteApiKeyEntry,
      deleteItem,
      deleteTag,
      effectiveReferenceNow,
      effectiveUserId,
      exportBackup,
      geminiModel,
      getActiveApiKeyId,
      getApiKeyEntries,
      hasSavedApiKey,
      importBackup,
      isAIProviderReady,
      isAuthBusy,
      isGeneratingProposal,
      isLoading,
      isSupabaseMode,
      items,
      lastCloudSyncAt,
      lastRejectedProposal,
      loadFromRepository,
      notificationsEnabled,
      openaiModel,
      pastItemsCount,
      persistKeyInLocalStorage,
      proposals,
      rejectProposal,
      renameApiKey,
      saveApiKey,
      schedules,
      selectApiKey,
      selectedDate,
      selectedTagFilter,
      sendChatMessage,
      setAIProviderType,
      setGeminiModel,
      setOpenAIModel,
      setTheme,
      signInWithEmail,
      signOut,
      signUpWithEmail,
      syncToCloudNow,
      tags,
      theme,
      timeZone,
      todayDateKey,
      toggleNotifications,
      updateItem,
      updateTag,
      viewMode,
      visibleProposals,
    ],
  );

  return <CalendarContext.Provider value={value}>{children}</CalendarContext.Provider>;
}

export function useCalendar(): CalendarContextValue {
  const context = useContext(CalendarContext);
  if (!context) {
    throw new Error('useCalendar must be used within a CalendarProvider');
  }
  return context;
}
