import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  animate,
  motion,
  useMotionValue,
} from 'framer-motion';
import { useCalendar, usePWAInstall } from '@/app';
import type { LaunchOrigin } from '@/components/ui/LiquidGlass';
import type { DateRangeMode } from '@/domain/planning';
import type { CalendarItem, Schedule, TagColorPreset } from '@/domain/schedule';
import { FloatingAIChat } from '@/features/ai-chat';
import { ProposalOverlayCard } from '@/features/proposals';
import {
  CalendarItemCard,
  ItemEditorModal,
  type ItemEditorModalState,
} from '@/features/schedule-cards';
import { SettingsModal } from '@/features/settings';
import { TagManagerModal } from '@/features/tags';
import {
  DayTimeline,
  MonthTimeline,
  TimelineHeader,
  WeekTimeline,
} from '@/features/timeline';
import {
  getWeekDateKeys,
  shiftDateKey,
  shiftMonthDateKey,
} from '@/shared/utils';
import { LIQUID_SPRING_BOUNCY, TIMELINE_SLIDE_VARIANTS } from '@/styles/motion';

const isTestEnv = import.meta.env.MODE === 'test';

interface SwipeGestureState {
  pointerId: number;
  startX: number;
  startY: number;
  lockedAxis: 'none' | 'horizontal' | 'vertical';
}

export function TimelinePage() {
  const {
    timeZone,
    todayDateKey,
    referenceNow,
    selectedDate,
    setSelectedDate,
    viewMode,
    setViewMode,
    items,
    pastItemsCount,
    tags,
    selectedTagFilter,
    setSelectedTagFilter,
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
    refreshItems,
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
  } = useCalendar();

  const pwaInstall = usePWAInstall();

  const [editorState, setEditorState] = useState<ItemEditorModalState | null>(null);
  const [editorOrigin, setEditorOrigin] = useState<LaunchOrigin | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsOrigin, setSettingsOrigin] = useState<LaunchOrigin | null>(null);
  const [isTagManagerOpen, setIsTagManagerOpen] = useState(false);
  const [tagManagerOrigin, setTagManagerOrigin] = useState<LaunchOrigin | null>(null);
  const [navDirection, setNavDirection] = useState(0);

  const swipeX = useMotionValue(0);
  const swipeGestureRef = useRef<SwipeGestureState | null>(null);

  const tagColorMap = useMemo(() => {
    const map = new Map<string, TagColorPreset>();
    for (const tag of tags) {
      map.set(tag.name, tag.color);
    }
    return map;
  }, [tags]);

  const filteredItems = useMemo(() => {
    if (!selectedTagFilter) return items;
    return items.filter((item) => item.tag === selectedTagFilter);
  }, [items, selectedTagFilter]);

  const viewTransitionKey = useMemo(() => {
    if (viewMode === 'day') return `day-${selectedDate}`;
    if (viewMode === 'week') return `week-${getWeekDateKeys(selectedDate, 1)[0]}`;
    return `month-${selectedDate.slice(0, 7)}`;
  }, [selectedDate, viewMode]);

  function handleNavigatePrev() {
    setNavDirection(-1);
    if (viewMode === 'month') {
      setSelectedDate(shiftMonthDateKey(selectedDate, -1));
      return;
    }
    if (viewMode === 'week') {
      setSelectedDate(shiftDateKey(selectedDate, -7));
      return;
    }
    setSelectedDate(shiftDateKey(selectedDate, -1));
  }

  function handleNavigateNext() {
    setNavDirection(1);
    if (viewMode === 'month') {
      setSelectedDate(shiftMonthDateKey(selectedDate, 1));
      return;
    }
    if (viewMode === 'week') {
      setSelectedDate(shiftDateKey(selectedDate, 7));
      return;
    }
    setSelectedDate(shiftDateKey(selectedDate, 1));
  }

  function handleNavigateToday() {
    if (todayDateKey > selectedDate) setNavDirection(1);
    else if (todayDateKey < selectedDate) setNavDirection(-1);
    else setNavDirection(0);
    setSelectedDate(todayDateKey);
  }

  function handleChangeViewMode(nextMode: DateRangeMode) {
    setNavDirection(0);
    setViewMode(nextMode);
  }

  function handleOpenDayView(dateKey: string) {
    setNavDirection(0);
    setSelectedDate(dateKey);
    setViewMode('day');
  }

  function handleSelectItem(item: CalendarItem, origin?: LaunchOrigin) {
    setEditorOrigin(origin ?? null);
    setEditorState({ mode: 'edit', item });
  }

  async function handleRescheduleSchedule(
    schedule: Schedule,
    newStartAt: string,
    newEndAt: string,
  ) {
    const result = await updateItem({
      itemId: schedule.id,
      expectedRevision: schedule.revision,
      patch: {
        startAt: newStartAt,
        endAt: newEndAt,
      },
    });

    if (!result.ok) {
      if (result.error.code === 'TIME_CONFLICT') {
        setEditorOrigin(null);
        setEditorState({
          mode: 'edit',
          item: schedule,
          proposedStartAt: newStartAt,
          proposedEndAt: newEndAt,
          initialConflictError: result.error,
        });
      } else if (result.error.code === 'PAST_TIME_NOT_ALLOWED') {
        setEditorOrigin(null);
        setEditorState({
          mode: 'edit',
          item: schedule,
          initialErrorMessage: result.error.message,
        });
      } else if (result.error.code === 'REVISION_CONFLICT') {
        await refreshItems();
      }
    }
  }

  function shouldIgnoreSwipeTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    if (target.closest('[data-testid^="drag-handle-"], button, input, textarea, select, a')) {
      return true;
    }
    const horizontalScroller = target.closest<HTMLElement>('[data-horizontal-scrollable="true"]');
    if (
      horizontalScroller &&
      horizontalScroller.scrollWidth > horizontalScroller.clientWidth + 4
    ) {
      return true;
    }
    return false;
  }

  function handleTimelinePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (shouldIgnoreSwipeTarget(event.target)) return;

    swipeGestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lockedAxis: 'none',
    };
  }

  function handleTimelinePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const gesture = swipeGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;

    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;

    if (gesture.lockedAxis === 'none') {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      if (Math.abs(dx) > Math.abs(dy) * 1.35) {
        gesture.lockedAxis = 'horizontal';
      } else {
        gesture.lockedAxis = 'vertical';
        return;
      }
    }

    if (gesture.lockedAxis === 'horizontal') {
      const clampedOffset = Math.max(-72, Math.min(72, dx * 0.35));
      swipeX.set(clampedOffset);
    }
  }

  function finishTimelineSwipe(event: ReactPointerEvent<HTMLDivElement>) {
    const gesture = swipeGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    swipeGestureRef.current = null;

    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;

    if (
      gesture.lockedAxis === 'horizontal' &&
      Math.abs(dx) >= 56 &&
      Math.abs(dx) > Math.abs(dy) * 1.4
    ) {
      if (dx < 0) {
        handleNavigateNext();
      } else {
        handleNavigatePrev();
      }
    }

    animate(swipeX, 0, LIQUID_SPRING_BOUNCY);
  }

  return (
    <div className="flex flex-col gap-[var(--space-section-gap)] pb-28">
      <TimelineHeader
        selectedDate={selectedDate}
        viewMode={viewMode}
        onChangeViewMode={handleChangeViewMode}
        onNavigatePrev={handleNavigatePrev}
        onNavigateNext={handleNavigateNext}
        onNavigateToday={handleNavigateToday}
        onRequestCreate={(origin) => {
          setEditorOrigin(origin ?? null);
          setEditorState({
            mode: 'create',
            initialType: 'schedule',
            dateKey: selectedDate,
          });
        }}
        onOpenTagManager={(origin) => {
          setTagManagerOrigin(origin ?? null);
          setIsTagManagerOpen(true);
        }}
        onOpenSettings={(origin) => {
          setSettingsOrigin(origin ?? null);
          setIsSettingsOpen(true);
        }}
        tags={tags}
        selectedTagFilter={selectedTagFilter}
        onSelectTagFilter={setSelectedTagFilter}
      />

      {isLoading ? (
        <div
          aria-busy="true"
          className="glass-layer-1 h-64 animate-pulse rounded-[var(--radius-lg)]"
        />
      ) : (
        <motion.div
          style={{ x: swipeX }}
          onPointerDown={handleTimelinePointerDown}
          onPointerMove={handleTimelinePointerMove}
          onPointerUp={finishTimelineSwipe}
          onPointerCancel={finishTimelineSwipe}
          className="relative touch-pan-y"
        >
          <motion.div
            key={viewTransitionKey}
            custom={navDirection}
            variants={TIMELINE_SLIDE_VARIANTS}
            initial={isTestEnv ? false : 'enter'}
            animate="center"
            className="will-change-transform"
          >
              {viewMode === 'month' && (
                <MonthTimeline
                  selectedDate={selectedDate}
                  todayDateKey={todayDateKey}
                  referenceNow={referenceNow}
                  timeZone={timeZone}
                  items={filteredItems}
                  proposals={visibleProposals}
                  onSelectDate={setSelectedDate}
                  onOpenDayView={handleOpenDayView}
                  onSelectItem={handleSelectItem}
                  renderItemCard={(item) => (
                    <CalendarItemCard
                      item={item}
                      timeZone={timeZone}
                      referenceNow={referenceNow}
                      tagColor={item.tag ? tagColorMap.get(item.tag) : undefined}
                      onSelect={handleSelectItem}
                    />
                  )}
                  renderProposalCard={(change) => (
                    <ProposalOverlayCard
                      change={change}
                      timeZone={timeZone}
                      onAccept={acceptProposal}
                      onReject={rejectProposal}
                    />
                  )}
                />
              )}

              {viewMode === 'week' && (
                <WeekTimeline
                  selectedDate={selectedDate}
                  todayDateKey={todayDateKey}
                  referenceNow={referenceNow}
                  timeZone={timeZone}
                  items={filteredItems}
                  proposals={visibleProposals}
                  onSelectDate={setSelectedDate}
                  onOpenDayView={handleOpenDayView}
                  onRequestCreateForDate={(dateKey, origin) => {
                    setEditorOrigin(origin ?? null);
                    setEditorState({
                      mode: 'create',
                      initialType: 'schedule',
                      dateKey,
                    });
                  }}
                  renderItemCard={(item) => (
                    <CalendarItemCard
                      item={item}
                      timeZone={timeZone}
                      referenceNow={referenceNow}
                      variant="compact"
                      tagColor={item.tag ? tagColorMap.get(item.tag) : undefined}
                      onSelect={handleSelectItem}
                    />
                  )}
                  renderProposalCard={(change) => (
                    <ProposalOverlayCard
                      change={change}
                      timeZone={timeZone}
                      compact
                      onAccept={acceptProposal}
                      onReject={rejectProposal}
                    />
                  )}
                />
              )}

              {viewMode === 'day' && (
                <DayTimeline
                  selectedDate={selectedDate}
                  todayDateKey={todayDateKey}
                  referenceNow={referenceNow}
                  timeZone={timeZone}
                  items={filteredItems}
                  proposals={visibleProposals}
                  onRequestCreateAt={(dateKey, startTime, endTime, origin) => {
                    setEditorOrigin(origin ?? null);
                    setEditorState({
                      mode: 'create',
                      initialType: 'schedule',
                      dateKey,
                      startTime,
                      endTime,
                    });
                  }}
                  onRescheduleSchedule={handleRescheduleSchedule}
                  renderDeadlineCard={(item) => (
                    <CalendarItemCard
                      item={item}
                      timeZone={timeZone}
                      referenceNow={referenceNow}
                      tagColor={item.tag ? tagColorMap.get(item.tag) : undefined}
                      onSelect={handleSelectItem}
                    />
                  )}
                  renderScheduleCard={(schedule, options) => (
                    <CalendarItemCard
                      item={schedule}
                      timeZone={timeZone}
                      referenceNow={referenceNow}
                      isDragging={options.isDragging}
                      overrideTimeLabel={options.overrideTimeLabel}
                      dragHandle={options.dragHandle}
                      tagColor={schedule.tag ? tagColorMap.get(schedule.tag) : undefined}
                      onSelect={handleSelectItem}
                    />
                  )}
                  renderProposalCard={(change) => (
                    <ProposalOverlayCard
                      change={change}
                      timeZone={timeZone}
                      onAccept={acceptProposal}
                      onReject={rejectProposal}
                    />
                  )}
                />
              )}
          </motion.div>
        </motion.div>
      )}

      <ItemEditorModal
        state={editorState}
        launchOrigin={editorOrigin}
        timeZone={timeZone}
        referenceNow={referenceNow}
        tags={tags}
        onQuickCreateTag={createTag}
        onClose={() => setEditorState(null)}
        onCreateDeadline={createDeadline}
        onCreateSchedule={createSchedule}
        onUpdateItem={updateItem}
        onDeleteItem={deleteItem}
        onRefresh={refreshItems}
      />

      <TagManagerModal
        isOpen={isTagManagerOpen}
        launchOrigin={tagManagerOrigin}
        onClose={() => setIsTagManagerOpen(false)}
        tags={tags}
        onCreateTag={createTag}
        onUpdateTag={updateTag}
        onDeleteTag={deleteTag}
      />

      <SettingsModal
        isOpen={isSettingsOpen}
        launchOrigin={settingsOrigin}
        onClose={() => setIsSettingsOpen(false)}
        isSupabaseMode={isSupabaseMode}
        authUserEmail={authUser?.email ?? null}
        isAuthBusy={isAuthBusy}
        cloudSyncStatus={cloudSyncStatus}
        cloudSyncError={cloudSyncError}
        lastCloudSyncAt={lastCloudSyncAt}
        onSyncToCloudNow={syncToCloudNow}
        onSignIn={signInWithEmail}
        onSignUp={signUpWithEmail}
        onSignOut={signOut}
        pastCount={pastItemsCount}
        onClearPastData={clearPastData}
        onExportBackup={exportBackup}
        onImportBackup={importBackup}
        aiProviderType={aiProviderType}
        geminiModel={geminiModel}
        openaiModel={openaiModel}
        hasSavedApiKey={hasSavedApiKey}
        apiKeyEntries={
          aiProviderType === 'gemini' || aiProviderType === 'openai'
            ? getApiKeyEntries(aiProviderType)
            : []
        }
        activeApiKeyId={
          aiProviderType === 'gemini' || aiProviderType === 'openai'
            ? getActiveApiKeyId(aiProviderType)
            : null
        }
        persistKeyInLocalStorage={persistKeyInLocalStorage}
        onChangeAIProviderType={setAIProviderType}
        onChangeGeminiModel={setGeminiModel}
        onChangeOpenAIModel={setOpenAIModel}
        theme={theme}
        onChangeTheme={setTheme}
        notificationsEnabled={notificationsEnabled}
        onToggleNotifications={toggleNotifications}
        onSaveApiKey={saveApiKey}
        onSelectApiKey={selectApiKey}
        onRenameApiKey={renameApiKey}
        onDeleteApiKeyEntry={deleteApiKeyEntry}
        onClearApiKey={clearApiKey}
        pwaInstall={{
          isInstallable: pwaInstall.isInstallable,
          isInstalled: pwaInstall.isInstalled,
          isIOS: pwaInstall.isIOS,
          onInstall: pwaInstall.promptInstall,
        }}
      />

      <FloatingAIChat
        messages={chatMessages}
        lastRejectedProposal={lastRejectedProposal}
        isGenerating={isGeneratingProposal}
        isProviderConfigured={isAIProviderReady}
        providerLabel={aiProviderLabel}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onClearChat={clearChatMessages}
        onSendMessage={sendChatMessage}
      />
    </div>
  );
}
