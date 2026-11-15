import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  Check,
  Download,
  FileText,
  Paperclip,
  Plus,
  Trash2,
  X,
  ZoomIn,
} from 'lucide-react';
import {
  LiquidButton,
  SpatialMorphModal,
  type LaunchOrigin,
} from '@/components/ui/LiquidGlass';
import { MODAL_BACKDROP_VARIANTS, MODAL_PANEL_VARIANTS } from '@/styles/motion';
import type {
  CreateDeadlineCommand,
  CreateScheduleCommand,
  DeleteCalendarItemResult,
  UpdateCalendarItemCommand,
} from '@/application/commands';
import type {
  ApplicationResult,
  CalendarApplicationError,
} from '@/application/services';
import {
  isDeadline,
  type CalendarItem,
  type CalendarTag,
  type Deadline,
  type DeadlineStatus,
  type ItemAttachment,
  type Schedule,
  type ScheduleStatus,
  type TagColorPreset,
} from '@/domain/schedule';
import {
  ITEM_ATTACHMENT_MAX_COUNT,
  isValidIsoDateOnly,
} from '@/shared/schemas';
import {
  TAG_COLOR_PRESETS,
  buildIsoFromLocalDateTime,
  getDateKeyFromInstant,
  getLocalTimeHHmm,
  getTagColorMeta,
  minutesToHHmm,
  shiftDateKey,
} from '@/shared/utils';
import {
  ITEM_ATTACHMENT_ACCEPT,
  formatAttachmentSize,
  isItemAttachmentImage,
  processItemAttachmentFiles,
  triggerAttachmentDownload,
} from './itemAttachmentUtils';

const isTestEnv = import.meta.env.MODE === 'test';
const PAST_TIME_BUFFER_MS = 2 * 60 * 1000;

function computeDefaultFutureScheduleSlot(
  requestedDateKey: string,
  referenceNow: Date,
  timeZone: string,
): { dateKey: string; startTime: string; endTime: string } {
  const todayKey = getDateKeyFromInstant(referenceNow, timeZone);
  if (requestedDateKey > todayKey) {
    return {
      dateKey: requestedDateKey,
      startTime: '09:00',
      endTime: '10:00',
    };
  }

  const nowHHmm = getLocalTimeHHmm(referenceNow.toISOString(), timeZone);
  const [hourStr, minuteStr] = nowHHmm.split(':');
  const currentMinutes = Number(hourStr) * 60 + Number(minuteStr);
  const roundedStartMinutes = Math.ceil((currentMinutes + 1) / 30) * 30;

  if (roundedStartMinutes + 60 <= 24 * 60) {
    return {
      dateKey: todayKey,
      startTime: minutesToHHmm(roundedStartMinutes),
      endTime: minutesToHHmm(roundedStartMinutes + 60),
    };
  }

  return {
    dateKey: shiftDateKey(todayKey, 1),
    startTime: '09:00',
    endTime: '10:00',
  };
}

export type ItemEditorModalState =
  | {
      mode: 'create';
      initialType?: 'schedule' | 'deadline';
      dateKey: string;
      startTime?: string;
      endTime?: string;
    }
  | {
      mode: 'edit';
      item: CalendarItem;
      proposedStartAt?: string;
      proposedEndAt?: string;
      initialConflictError?: Extract<CalendarApplicationError, { code: 'TIME_CONFLICT' }>;
      initialErrorMessage?: string;
    };

export interface ItemEditorModalProps {
  state: ItemEditorModalState | null;
  launchOrigin?: LaunchOrigin | null;
  timeZone: string;
  referenceNow?: Date;
  tags?: readonly CalendarTag[];
  onQuickCreateTag?: (input: {
    name: string;
    color: TagColorPreset;
  }) => Promise<ApplicationResult<CalendarTag>>;
  onClose: () => void;
  onCreateDeadline: (
    input: Omit<CreateDeadlineCommand, 'userId'>,
  ) => Promise<ApplicationResult<Deadline>>;
  onCreateSchedule: (
    input: Omit<CreateScheduleCommand, 'userId'>,
  ) => Promise<ApplicationResult<Schedule>>;
  onUpdateItem: (
    input: Omit<UpdateCalendarItemCommand, 'userId'>,
  ) => Promise<ApplicationResult<CalendarItem>>;
  onDeleteItem: (input: {
    itemId: string;
    expectedRevision: number;
  }) => Promise<ApplicationResult<DeleteCalendarItemResult>>;
  onRefresh: () => Promise<void>;
}

export function ItemEditorModal({
  state,
  launchOrigin,
  timeZone,
  referenceNow,
  tags = [],
  onQuickCreateTag,
  onClose,
  onCreateDeadline,
  onCreateSchedule,
  onUpdateItem,
  onDeleteItem,
  onRefresh,
}: ItemEditorModalProps) {
  const startTimeInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [itemType, setItemType] = useState<'schedule' | 'deadline'>('schedule');
  const [title, setTitle] = useState('');
  const [dateKey, setDateKey] = useState('');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('10:00');
  const [dueTime, setDueTime] = useState('');
  const [tag, setTag] = useState('');
  const [description, setDescription] = useState('');
  const [deadlineStatus, setDeadlineStatus] = useState<DeadlineStatus>('pending');
  const [scheduleStatus, setScheduleStatus] = useState<ScheduleStatus>('scheduled');
  const [attachments, setAttachments] = useState<ItemAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [isProcessingAttachments, setIsProcessingAttachments] = useState(false);
  const [lightboxAttachment, setLightboxAttachment] = useState<ItemAttachment | null>(
    null,
  );
  const [quickTagOpen, setQuickTagOpen] = useState(false);
  const [quickTagName, setQuickTagName] = useState('');
  const [quickTagColor, setQuickTagColor] = useState<TagColorPreset>('indigo');
  const [quickTagError, setQuickTagError] = useState<string | null>(null);
  const [isCreatingTag, setIsCreatingTag] = useState(false);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [conflictError, setConflictError] = useState<Extract<
    CalendarApplicationError,
    { code: 'TIME_CONFLICT' }
  > | null>(null);
  const [revisionConflict, setRevisionConflict] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isOpen = Boolean(state);
  const [isBodyReady, setIsBodyReady] = useState<boolean>(() => isTestEnv);

  useEffect(() => {
    if (isTestEnv) return;
    if (isOpen) {
      setIsBodyReady(false);
      const rafId = requestAnimationFrame(() => {
        setIsBodyReady(true);
      });
      return () => cancelAnimationFrame(rafId);
    }
    const timerId = window.setTimeout(() => {
      setIsBodyReady(false);
    }, 240);
    return () => window.clearTimeout(timerId);
  }, [isOpen]);

  const showBody = isTestEnv || isBodyReady;

  useEffect(() => {
    if (!state) return;

    setErrorMessage(state.mode === 'edit' ? (state.initialErrorMessage ?? null) : null);
    setConfirmingDelete(false);
    setRevisionConflict(false);
    setIsSubmitting(false);
    setAttachmentError(null);
    setIsProcessingAttachments(false);
    setLightboxAttachment(null);
    setQuickTagOpen(false);
    setQuickTagName('');
    setQuickTagColor('indigo');
    setQuickTagError(null);
    setIsCreatingTag(false);

    if (state.mode === 'create') {
      const nowRef = referenceNow ?? new Date();
      const todayKey = getDateKeyFromInstant(nowRef, timeZone);
      const fallbackSlot = computeDefaultFutureScheduleSlot(
        state.dateKey,
        nowRef,
        timeZone,
      );
      const defaultDateKey =
        state.startTime || state.endTime
          ? state.dateKey
          : state.initialType === 'deadline'
            ? state.dateKey < todayKey
              ? todayKey
              : state.dateKey
            : fallbackSlot.dateKey;

      setItemType(state.initialType ?? 'schedule');
      setTitle('');
      setDateKey(defaultDateKey);
      setStartTime(state.startTime ?? fallbackSlot.startTime);
      setEndTime(state.endTime ?? fallbackSlot.endTime);
      setDueTime('');
      setTag('');
      setDescription('');
      setAttachments([]);
      setDeadlineStatus('pending');
      setScheduleStatus('scheduled');
      setConflictError(null);
      return;
    }

    const { item } = state;
    setTitle(item.title);
    setTag(item.tag ?? '');
    setDescription(item.description ?? '');
    setAttachments(item.attachments ? [...item.attachments] : []);

    if (isDeadline(item)) {
      setItemType('deadline');
      setDateKey(getDateKeyFromInstant(item.dueDate, timeZone));
      setDueTime(
        isValidIsoDateOnly(item.dueDate)
          ? ''
          : getLocalTimeHHmm(item.dueDate, timeZone),
      );
      setDeadlineStatus(item.status ?? 'pending');
      setConflictError(null);
    } else {
      const effectiveStartAt = state.proposedStartAt ?? item.startAt;
      const effectiveEndAt = state.proposedEndAt ?? item.endAt;
      setItemType('schedule');
      setDateKey(getDateKeyFromInstant(effectiveStartAt, timeZone));
      setStartTime(getLocalTimeHHmm(effectiveStartAt, timeZone));
      setEndTime(getLocalTimeHHmm(effectiveEndAt, timeZone));
      setScheduleStatus(item.status ?? 'scheduled');
      setConflictError(state.initialConflictError ?? null);
    }
  }, [referenceNow, state, timeZone]);

  useEffect(() => {
    if (!state) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      if (lightboxAttachment) {
        setLightboxAttachment(null);
      } else {
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [lightboxAttachment, onClose, state]);

  const isEdit = state?.mode === 'edit';

  async function submitForm(allowConflict: boolean) {
    if (!state) return;
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setErrorMessage('請輸入標題');
      return;
    }
    if (!dateKey) {
      setErrorMessage('請選擇日期');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    const nowRef = referenceNow ?? new Date();

    try {
      if (itemType === 'deadline') {
        const dueDate = dueTime
          ? buildIsoFromLocalDateTime(dateKey, dueTime, timeZone)
          : dateKey;

        const dueDateChanged =
          !isEdit ||
          (isDeadline(state.item) && dueDate !== state.item.dueDate);
        const todayKey = getDateKeyFromInstant(nowRef, timeZone);
        if (dueDateChanged && getDateKeyFromInstant(dueDate, timeZone) < todayKey) {
          setErrorMessage('截止日期不可設為過去的時間');
          return;
        }

        const trimmedTag = tag.trim();
        const result = isEdit
          ? await onUpdateItem({
              itemId: state.item.id,
              expectedRevision: state.item.revision,
              patch: {
                title: trimmedTitle,
                dueDate,
                description: description.trim() || undefined,
                tag: trimmedTag ? trimmedTag : null,
                status: deadlineStatus,
                attachments,
              },
            })
          : await onCreateDeadline({
              title: trimmedTitle,
              dueDate,
              description: description.trim() || undefined,
              tag: trimmedTag || undefined,
              status: deadlineStatus,
              ...(attachments.length > 0 ? { attachments } : {}),
            });

        handleMutationResult(result);
        return;
      }

      if (!startTime || !endTime) {
        setErrorMessage('請填寫開始與結束時間');
        setIsSubmitting(false);
        return;
      }

      const startAt = buildIsoFromLocalDateTime(dateKey, startTime, timeZone);
      const endAt = buildIsoFromLocalDateTime(dateKey, endTime, timeZone);

      if (Date.parse(endAt) <= Date.parse(startAt)) {
        setErrorMessage('結束時間必須晚於開始時間');
        setIsSubmitting(false);
        return;
      }

      const startChanged =
        !isEdit ||
        (!isDeadline(state.item) &&
          Date.parse(startAt) !== Date.parse(state.item.startAt));
      const endChanged =
        !isEdit ||
        (!isDeadline(state.item) &&
          Date.parse(endAt) !== Date.parse(state.item.endAt));

      if (
        (startChanged && Date.parse(startAt) < nowRef.getTime() - PAST_TIME_BUFFER_MS) ||
        (endChanged && Date.parse(endAt) < nowRef.getTime() - PAST_TIME_BUFFER_MS)
      ) {
        setErrorMessage('無法在過去的時間設定行程');
        setIsSubmitting(false);
        return;
      }

      const trimmedTag = tag.trim();
      const result = isEdit
        ? await onUpdateItem({
            itemId: state.item.id,
            expectedRevision: state.item.revision,
            allowConflict,
            patch: {
              title: trimmedTitle,
              startAt,
              endAt,
              description: description.trim() || undefined,
              tag: trimmedTag ? trimmedTag : null,
              status: scheduleStatus,
              attachments,
            },
          })
        : await onCreateSchedule({
            title: trimmedTitle,
            startAt,
            endAt,
            allowConflict,
            description: description.trim() || undefined,
            tag: trimmedTag || undefined,
            status: scheduleStatus,
            ...(attachments.length > 0 ? { attachments } : {}),
          });

      handleMutationResult(result);
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleMutationResult(result: ApplicationResult<unknown>) {
    if (result.ok) {
      onClose();
      return;
    }

    const { error } = result;
    if (error.code === 'TIME_CONFLICT') {
      setConflictError(error);
      setErrorMessage(null);
      return;
    }
    if (error.code === 'REVISION_CONFLICT') {
      setRevisionConflict(true);
      setConflictError(null);
      setErrorMessage('資料版本已更新，請重新載入最新資料後再修改。');
      return;
    }
    setConflictError(null);
    setErrorMessage(error.message);
  }

  function handleFormSubmit(event: FormEvent) {
    event.preventDefault();
    void submitForm(false);
  }

  async function handleConfirmDelete() {
    if (!state || state.mode !== 'edit') return;
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const result = await onDeleteItem({
        itemId: state.item.id,
        expectedRevision: state.item.revision,
      });
      if (result.ok) {
        onClose();
      } else if (result.error.code === 'REVISION_CONFLICT') {
        setRevisionConflict(true);
        setErrorMessage('資料版本已更新，請重新載入最新資料後再刪除。');
      } else {
        setErrorMessage(result.error.message);
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleReloadLatest() {
    await onRefresh();
    onClose();
  }

  async function handleAttachmentFilesSelected(event: ChangeEvent<HTMLInputElement>) {
    const fileList = event.target.files;
    if (!fileList || fileList.length === 0) return;
    setAttachmentError(null);
    setIsProcessingAttachments(true);
    try {
      const { added, errors } = await processItemAttachmentFiles(
        fileList,
        attachments.length,
      );
      if (added.length > 0) {
        setAttachments((prev) =>
          [...prev, ...added].slice(0, ITEM_ATTACHMENT_MAX_COUNT),
        );
      }
      if (errors.length > 0) {
        setAttachmentError(errors[0]);
      }
    } finally {
      setIsProcessingAttachments(false);
      event.target.value = '';
    }
  }

  function handleRemoveAttachment(attachmentId: string) {
    setAttachments((prev) => prev.filter((item) => item.id !== attachmentId));
    setAttachmentError(null);
  }

  async function handleQuickCreateTag() {
    if (!onQuickCreateTag) return;
    const trimmed = quickTagName.trim();
    if (!trimmed) {
      setQuickTagError('請輸入標籤名稱');
      return;
    }

    setIsCreatingTag(true);
    setQuickTagError(null);
    try {
      const result = await onQuickCreateTag({
        name: trimmed,
        color: quickTagColor,
      });
      if (result.ok) {
        setTag(result.data.name);
        setQuickTagName('');
        setQuickTagOpen(false);
      } else {
        setQuickTagError(result.error.message);
      }
    } finally {
      setIsCreatingTag(false);
    }
  }

  const trimmedCurrentTag = tag.trim();
  const hasLegacyUnknownTag =
    trimmedCurrentTag.length > 0 && !tags.some((t) => t.name === trimmedCurrentTag);

  return (
    <>
      <SpatialMorphModal
        isOpen={Boolean(state)}
        onClose={onClose}
        origin={launchOrigin}
        ariaLabelledBy="item-editor-title"
        panelClassName="sm:max-w-lg"
      >
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--color-border-subtle)] px-5 py-4 sm:px-6">
              <h2
                id="item-editor-title"
                className="text-[length:var(--text-xl)] font-bold text-[var(--color-text-primary)]"
              >
                {isEdit
                  ? itemType === 'deadline'
                    ? '編輯截止事項'
                    : '編輯排程時段'
                  : '新增學習項目'}
              </h2>
              <LiquidButton
                onClick={onClose}
                aria-label="關閉視窗"
                className="modal-inner-surface flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]"
              >
                <X className="relative z-10 h-5 w-5" />
              </LiquidButton>
            </div>

        <div className="flex-1 overflow-y-auto overscroll-contain px-5 pb-5 sm:px-6 sm:pb-6">
        {showBody && (
          <div className={isTestEnv ? undefined : 'modal-body-reveal'}>

        {/* Type Switcher (Unlocked on Create, Locked on Edit) */}
        <div className="mt-4">
          {isEdit ? (
            <div className="flex items-center justify-between rounded-[var(--radius-md)] border-[length:var(--border-width-card)] border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] px-3.5 py-2.5 text-[length:var(--text-sm)] font-semibold text-[var(--color-text-secondary)]">
              <span>類型鎖定</span>
              <span>
                {itemType === 'schedule' ? 'Schedule 排程時段' : 'Deadline 截止事項'}
              </span>
            </div>
          ) : (
            <div
              role="group"
              aria-label="選擇行程類型"
              className="grid grid-cols-2 gap-1.5 rounded-[var(--radius-md)] border-[length:var(--border-width-card)] border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] p-1"
            >
              <button
                type="button"
                onClick={() => {
                  setItemType('schedule');
                  setConflictError(null);
                  setErrorMessage(null);
                }}
                aria-pressed={itemType === 'schedule'}
                className={`min-h-[44px] rounded-[var(--radius-sm)] px-3 text-[length:var(--text-sm)] font-bold transition-colors whitespace-nowrap ${
                  itemType === 'schedule'
                    ? 'bg-[var(--color-bg-surface)] text-[var(--color-schedule-accent)] shadow-[var(--shadow-card)]'
                    : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
                }`}
              >
                Schedule 排程時段
              </button>
              <button
                type="button"
                onClick={() => {
                  setItemType('deadline');
                  setConflictError(null);
                  setErrorMessage(null);
                }}
                aria-pressed={itemType === 'deadline'}
                className={`min-h-[44px] rounded-[var(--radius-sm)] px-3 text-[length:var(--text-sm)] font-bold transition-colors whitespace-nowrap ${
                  itemType === 'deadline'
                    ? 'bg-[var(--color-bg-surface)] text-[var(--color-deadline-accent)] shadow-[var(--shadow-card)]'
                    : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
                }`}
              >
                Deadline 截止事項
              </button>
            </div>
          )}
        </div>

        <form onSubmit={handleFormSubmit} className="mt-4 flex flex-col gap-4">
          <div>
            <label
              htmlFor="item-title-input"
              className="block text-[length:var(--text-sm)] font-bold text-[var(--color-text-primary)]"
            >
              標題
            </label>
            <input
              id="item-title-input"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={
                itemType === 'deadline' ? '例如：演算法作業 3 繳交' : '例如：微積分重點複習'
              }
              className="mt-1.5 min-h-[44px] w-full rounded-[var(--radius-sm)] border-[length:var(--border-width-card)] border-[var(--color-border-strong)] bg-[var(--color-bg-surface)] px-3.5 py-2 text-[length:var(--text-base)] text-[var(--color-text-primary)] focus:border-[var(--color-accent-primary)] focus:outline-none"
            />
          </div>

          {itemType === 'schedule' ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label
                  htmlFor="schedule-date-input"
                  className="block text-[length:var(--text-sm)] font-bold text-[var(--color-text-primary)]"
                >
                  日期
                </label>
                <input
                  id="schedule-date-input"
                  type="date"
                  value={dateKey}
                  onChange={(e) => {
                    setDateKey(e.target.value);
                    setConflictError(null);
                  }}
                  className="mt-1.5 min-h-[44px] w-full rounded-[var(--radius-sm)] border-[length:var(--border-width-card)] border-[var(--color-border-strong)] bg-[var(--color-bg-surface)] px-3 py-2 font-[family-name:var(--font-mono)] text-[length:var(--text-sm)] text-[var(--color-text-primary)] focus:border-[var(--color-accent-primary)] focus:outline-none"
                />
              </div>
              <div>
                <label
                  htmlFor="schedule-start-input"
                  className="block text-[length:var(--text-sm)] font-bold text-[var(--color-text-primary)]"
                >
                  開始時間
                </label>
                <input
                  ref={startTimeInputRef}
                  id="schedule-start-input"
                  type="time"
                  value={startTime}
                  onChange={(e) => {
                    setStartTime(e.target.value);
                    setConflictError(null);
                  }}
                  className="mt-1.5 min-h-[44px] w-full rounded-[var(--radius-sm)] border-[length:var(--border-width-card)] border-[var(--color-border-strong)] bg-[var(--color-bg-surface)] px-3 py-2 font-[family-name:var(--font-mono)] text-[length:var(--text-sm)] text-[var(--color-text-primary)] focus:border-[var(--color-accent-primary)] focus:outline-none"
                />
              </div>
              <div>
                <label
                  htmlFor="schedule-end-input"
                  className="block text-[length:var(--text-sm)] font-bold text-[var(--color-text-primary)]"
                >
                  結束時間
                </label>
                <input
                  id="schedule-end-input"
                  type="time"
                  value={endTime}
                  onChange={(e) => {
                    setEndTime(e.target.value);
                    setConflictError(null);
                  }}
                  className="mt-1.5 min-h-[44px] w-full rounded-[var(--radius-sm)] border-[length:var(--border-width-card)] border-[var(--color-border-strong)] bg-[var(--color-bg-surface)] px-3 py-2 font-[family-name:var(--font-mono)] text-[length:var(--text-sm)] text-[var(--color-text-primary)] focus:border-[var(--color-accent-primary)] focus:outline-none"
                />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="deadline-date-input"
                  className="block text-[length:var(--text-sm)] font-bold text-[var(--color-text-primary)]"
                >
                  截止日期
                </label>
                <input
                  id="deadline-date-input"
                  type="date"
                  value={dateKey}
                  onChange={(e) => setDateKey(e.target.value)}
                  className="mt-1.5 min-h-[44px] w-full rounded-[var(--radius-sm)] border-[length:var(--border-width-card)] border-[var(--color-border-strong)] bg-[var(--color-bg-surface)] px-3 py-2 font-[family-name:var(--font-mono)] text-[length:var(--text-sm)] text-[var(--color-text-primary)] focus:border-[var(--color-accent-primary)] focus:outline-none"
                />
              </div>
              <div>
                <label
                  htmlFor="deadline-time-input"
                  className="block text-[length:var(--text-sm)] font-bold text-[var(--color-text-primary)]"
                >
                  截止時間（選填）
                </label>
                <input
                  id="deadline-time-input"
                  type="time"
                  value={dueTime}
                  onChange={(e) => setDueTime(e.target.value)}
                  className="mt-1.5 min-h-[44px] w-full rounded-[var(--radius-sm)] border-[length:var(--border-width-card)] border-[var(--color-border-strong)] bg-[var(--color-bg-surface)] px-3 py-2 font-[family-name:var(--font-mono)] text-[length:var(--text-sm)] text-[var(--color-text-primary)] focus:border-[var(--color-accent-primary)] focus:outline-none"
                />
              </div>
            </div>
          )}

          <div className="space-y-3">
            <div data-testid="item-tag-selector">
              <div className="flex items-center justify-between gap-2">
                <span className="block text-[length:var(--text-sm)] font-bold text-[var(--color-text-primary)]">
                  標籤（選填）
                </span>
                {onQuickCreateTag && (
                  <button
                    type="button"
                    onClick={() => {
                      setQuickTagOpen((prev) => !prev);
                      setQuickTagError(null);
                    }}
                    className="inline-flex min-h-[32px] items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-border-strong)] bg-[var(--color-bg-subtle)] px-2.5 text-[length:var(--text-xs)] font-bold text-[var(--color-accent-primary)] hover:bg-[var(--color-bg-hover)]"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>+ 快速新增標籤</span>
                  </button>
                )}
              </div>

              <div
                role="group"
                aria-label="選擇行程標籤"
                className="mt-2 flex flex-wrap items-center gap-2"
              >
                {tags.map((tagItem) => {
                  const isSelected = trimmedCurrentTag === tagItem.name;
                  const meta = getTagColorMeta(tagItem.color);
                  return (
                    <button
                      key={tagItem.id}
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => setTag(isSelected ? '' : tagItem.name)}
                      className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-full border px-3 text-[length:var(--text-xs)] font-bold transition-colors ${
                        isSelected
                          ? meta.activeChipClass
                          : 'border-[var(--color-border-strong)] bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)]'
                      }`}
                    >
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{
                          backgroundColor: isSelected ? '#ffffff' : meta.swatchHex,
                        }}
                        aria-hidden="true"
                      />
                      <span>{tagItem.name}</span>
                      {isSelected && <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
                    </button>
                  );
                })}

                {hasLegacyUnknownTag && (
                  <button
                    type="button"
                    aria-pressed={true}
                    onClick={() => setTag('')}
                    className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full border border-[var(--color-accent-primary)] bg-[var(--color-accent-primary-soft)] px-3 text-[length:var(--text-xs)] font-bold text-[var(--color-accent-primary)]"
                  >
                    <span>{trimmedCurrentTag}</span>
                    <X className="h-3 w-3" aria-hidden="true" />
                  </button>
                )}

                {tags.length === 0 && !hasLegacyUnknownTag && (
                  <span className="text-[length:var(--text-xs)] text-[var(--color-text-muted)]">
                    尚無標籤，可點擊右側「+ 快速新增標籤」建立。
                  </span>
                )}
              </div>

              {quickTagOpen && onQuickCreateTag && (
                <div
                  data-testid="quick-create-tag-form"
                  className="mt-2.5 space-y-2.5 rounded-[var(--radius-md)] border border-[var(--color-border-strong)] bg-[var(--color-bg-subtle)] p-3"
                >
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      type="text"
                      aria-label="新標籤名稱"
                      value={quickTagName}
                      onChange={(e) => setQuickTagName(e.target.value)}
                      placeholder="輸入新標籤名稱（例如：實驗）"
                      className="min-h-[40px] flex-1 rounded-[var(--radius-sm)] border border-[var(--color-border-strong)] bg-[var(--color-bg-surface)] px-3 text-[length:var(--text-sm)] text-[var(--color-text-primary)] focus:border-[var(--color-accent-primary)] focus:outline-none"
                    />
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={isCreatingTag}
                        onClick={() => void handleQuickCreateTag()}
                        className="min-h-[40px] rounded-[var(--radius-sm)] bg-[var(--color-accent-primary)] px-3 text-[length:var(--text-xs)] font-bold text-[var(--color-text-inverse)] disabled:opacity-50 whitespace-nowrap"
                      >
                        建立並套用
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setQuickTagOpen(false);
                          setQuickTagError(null);
                        }}
                        className="min-h-[40px] rounded-[var(--radius-sm)] border border-[var(--color-border-strong)] bg-[var(--color-bg-surface)] px-2.5 text-[length:var(--text-xs)] font-semibold text-[var(--color-text-secondary)] whitespace-nowrap"
                      >
                        取消
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {TAG_COLOR_PRESETS.map((preset) => {
                      const selected = quickTagColor === preset.value;
                      return (
                        <button
                          key={preset.value}
                          type="button"
                          aria-label={`快速標籤顏色：${preset.label}`}
                          onClick={() => setQuickTagColor(preset.value)}
                          className={`flex h-7 w-7 items-center justify-center rounded-full border-2 ${
                            selected
                              ? 'scale-110 border-[var(--color-text-primary)]'
                              : 'border-transparent'
                          }`}
                          style={{ backgroundColor: preset.swatchHex }}
                        >
                          {selected && (
                            <Check className="h-3.5 w-3.5 text-white" aria-hidden="true" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                  {quickTagError && (
                    <p
                      role="alert"
                      className="text-[length:var(--text-xs)] font-semibold text-[var(--color-proposal-delete-text)]"
                    >
                      {quickTagError}
                    </p>
                  )}
                </div>
              )}
            </div>

            {isEdit && (
              <div>
                <label
                  htmlFor="item-status-select"
                  className="block text-[length:var(--text-sm)] font-bold text-[var(--color-text-primary)]"
                >
                  狀態
                </label>
                {itemType === 'deadline' ? (
                  <select
                    id="item-status-select"
                    value={deadlineStatus}
                    onChange={(e) => setDeadlineStatus(e.target.value as DeadlineStatus)}
                    className="mt-1.5 min-h-[44px] w-full rounded-[var(--radius-sm)] border-[length:var(--border-width-card)] border-[var(--color-border-strong)] bg-[var(--color-bg-surface)] px-3 py-2 text-[length:var(--text-sm)] text-[var(--color-text-primary)] focus:border-[var(--color-accent-primary)] focus:outline-none"
                  >
                    <option value="pending">待完成</option>
                    <option value="completed">已完成</option>
                  </select>
                ) : (
                  <select
                    id="item-status-select"
                    value={scheduleStatus}
                    onChange={(e) => setScheduleStatus(e.target.value as ScheduleStatus)}
                    className="mt-1.5 min-h-[44px] w-full rounded-[var(--radius-sm)] border-[length:var(--border-width-card)] border-[var(--color-border-strong)] bg-[var(--color-bg-surface)] px-3 py-2 text-[length:var(--text-sm)] text-[var(--color-text-primary)] focus:border-[var(--color-accent-primary)] focus:outline-none"
                  >
                    <option value="scheduled">已排程</option>
                    <option value="completed">已完成</option>
                    <option value="cancelled">已取消</option>
                  </select>
                )}
              </div>
            )}
          </div>

          <div>
            <label
              htmlFor="item-desc-input"
              className="block text-[length:var(--text-sm)] font-bold text-[var(--color-text-primary)]"
            >
              備註（選填）
            </label>
            <textarea
              id="item-desc-input"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="補充學習重點或繳交說明..."
              className="mt-1.5 w-full rounded-[var(--radius-sm)] border-[length:var(--border-width-card)] border-[var(--color-border-strong)] bg-[var(--color-bg-surface)] px-3.5 py-2 text-[length:var(--text-sm)] text-[var(--color-text-primary)] focus:border-[var(--color-accent-primary)] focus:outline-none"
            />
          </div>

          {/* Item Attachments & Images */}
          <div data-testid="item-attachments-section" className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <Paperclip
                  className="h-4 w-4 text-[var(--color-text-secondary)]"
                  aria-hidden="true"
                />
                <span className="text-[length:var(--text-sm)] font-bold text-[var(--color-text-primary)]">
                  附件與圖片（準備資料）
                </span>
                <span className="font-[family-name:var(--font-mono)] text-[length:var(--text-xs)] text-[var(--color-text-muted)]">
                  {attachments.length} / {ITEM_ATTACHMENT_MAX_COUNT}
                </span>
              </div>

              <input
                ref={fileInputRef}
                id="item-attachment-input"
                data-testid="item-attachment-input"
                type="file"
                multiple
                accept={ITEM_ATTACHMENT_ACCEPT}
                onChange={(e) => void handleAttachmentFilesSelected(e)}
                className="sr-only"
              />
              <button
                type="button"
                disabled={
                  isProcessingAttachments ||
                  attachments.length >= ITEM_ATTACHMENT_MAX_COUNT
                }
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-border-strong)] bg-[var(--color-bg-subtle)] px-3 text-[length:var(--text-xs)] font-bold text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] disabled:opacity-50"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                <span>
                  {isProcessingAttachments ? '處理中...' : '上傳圖片或檔案'}
                </span>
              </button>
            </div>

            <p className="text-[length:var(--text-xs)] text-[var(--color-text-muted)]">
              支援 PNG/JPG/WebP（自動最佳化縮圖）與 PDF/TXT/MD/DOCX/XLSX，單檔上限 3MB
            </p>

            {attachmentError && (
              <p
                role="alert"
                data-testid="item-attachment-error"
                className="rounded-[var(--radius-sm)] border border-[var(--color-proposal-delete-border)] bg-[var(--color-proposal-delete-bg)] px-3 py-2 text-[length:var(--text-xs)] font-semibold text-[var(--color-proposal-delete-text)]"
              >
                {attachmentError}
              </p>
            )}

            {attachments.length > 0 && (
              <div className="space-y-2">
                {attachments.map((att) => {
                  const isImage = isItemAttachmentImage(att.mimeType);
                  return (
                    <div
                      key={att.id}
                      data-testid={`item-attachment-row-${att.id}`}
                      className="flex items-center justify-between gap-2.5 rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] p-2"
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-2.5">
                        {isImage ? (
                          <button
                            type="button"
                            onClick={() => setLightboxAttachment(att)}
                            aria-label={`放大檢視 ${att.name}`}
                            className="group relative h-12 w-12 shrink-0 overflow-hidden rounded-[var(--radius-sm)] border border-[var(--color-border-strong)] bg-[var(--color-bg-surface)]"
                          >
                            <img
                              src={att.dataUrl}
                              alt={att.name}
                              className="h-full w-full object-cover"
                            />
                            <span className="absolute inset-0 flex items-center justify-center bg-slate-950/35 opacity-0 transition-opacity group-hover:opacity-100">
                              <ZoomIn className="h-4 w-4 text-white" aria-hidden="true" />
                            </span>
                          </button>
                        ) : (
                          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] text-[var(--color-accent-primary)]">
                            <FileText className="h-5 w-5" aria-hidden="true" />
                          </div>
                        )}

                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[length:var(--text-xs)] font-bold text-[var(--color-text-primary)]">
                            {att.name}
                          </p>
                          <p className="font-[family-name:var(--font-mono)] text-[11px] text-[var(--color-text-muted)]">
                            {formatAttachmentSize(att.size)}
                          </p>
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-1">
                        {isImage ? (
                          <button
                            type="button"
                            onClick={() => setLightboxAttachment(att)}
                            aria-label={`預覽 ${att.name}`}
                            className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
                          >
                            <ZoomIn className="h-4 w-4" aria-hidden="true" />
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => triggerAttachmentDownload(att)}
                            aria-label={`下載 ${att.name}`}
                            className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
                          >
                            <Download className="h-4 w-4" aria-hidden="true" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleRemoveAttachment(att.id)}
                          aria-label={`移除附件 ${att.name}`}
                          className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-proposal-delete-border)] bg-[var(--color-proposal-delete-bg)] text-[var(--color-proposal-delete-text)] hover:opacity-90"
                        >
                          <X className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Time Conflict Alert */}
          {conflictError && (
            <div
              role="alert"
              data-testid="time-conflict-alert"
              className="rounded-[var(--radius-md)] border-[length:var(--border-width-card)] border-[var(--color-deadline-border)] bg-[var(--color-deadline-bg)] p-3.5 text-[var(--color-deadline-text)]"
            >
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-deadline-accent)]" />
                <div className="min-w-0 flex-1">
                  <p className="text-[length:var(--text-sm)] font-bold">
                    時段與既有排程衝突
                  </p>
                  <ul className="mt-1.5 space-y-1 text-[length:var(--text-xs)]">
                    {conflictError.conflictingItems.map((c) => (
                      <li key={c.id} className="font-medium">
                        {c.title}（
                        <span className="font-[family-name:var(--font-mono)] tabular-nums">
                          {getLocalTimeHHmm(c.startAt, timeZone)} –{' '}
                          {getLocalTimeHHmm(c.endAt, timeZone)}
                        </span>
                        ）
                      </li>
                    ))}
                  </ul>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setConflictError(null);
                        startTimeInputRef.current?.focus();
                      }}
                      className="min-h-[40px] rounded-[var(--radius-sm)] border-[length:var(--border-width-card)] border-[var(--color-border-strong)] bg-[var(--color-bg-surface)] px-3 text-[length:var(--text-xs)] font-bold text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] whitespace-nowrap"
                    >
                      調整時間
                    </button>
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => void submitForm(true)}
                      className="min-h-[40px] rounded-[var(--radius-sm)] border-[length:var(--border-width-card)] border-[var(--color-deadline-accent)] bg-[var(--color-deadline-accent)] px-3 text-[length:var(--text-xs)] font-bold text-white hover:opacity-90 whitespace-nowrap disabled:opacity-50"
                    >
                      仍要排程
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Validation / Revision Error */}
          {errorMessage && (
            <div
              role="alert"
              className="rounded-[var(--radius-md)] border-[length:var(--border-width-card)] border-[var(--color-proposal-delete-border)] bg-[var(--color-proposal-delete-bg)] p-3 text-[length:var(--text-sm)] font-semibold text-[var(--color-proposal-delete-text)]"
            >
              <p>{errorMessage}</p>
              {revisionConflict && (
                <button
                  type="button"
                  onClick={() => void handleReloadLatest()}
                  className="mt-2 min-h-[40px] rounded-[var(--radius-sm)] border-[length:var(--border-width-card)] border-[var(--color-proposal-delete-border)] bg-[var(--color-bg-surface)] px-3 text-[length:var(--text-xs)] font-bold text-[var(--color-proposal-delete-text)]"
                >
                  重新載入最新資料
                </button>
              )}
            </div>
          )}

          {/* Footer Actions */}
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-border-subtle)] pt-4">
            {isEdit ? (
              confirmingDelete ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => void handleConfirmDelete()}
                    className="min-h-[44px] rounded-[var(--radius-sm)] border-[length:var(--border-width-card)] border-[var(--color-proposal-delete-accent)] bg-[var(--color-proposal-delete-accent)] px-3.5 text-[length:var(--text-sm)] font-bold text-white whitespace-nowrap"
                  >
                    確認刪除
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingDelete(false)}
                    className="min-h-[44px] rounded-[var(--radius-sm)] border-[length:var(--border-width-card)] border-[var(--color-border-strong)] bg-[var(--color-bg-surface)] px-3 text-[length:var(--text-sm)] font-semibold text-[var(--color-text-secondary)] whitespace-nowrap"
                  >
                    取消刪除
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(true)}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[var(--radius-sm)] border-[length:var(--border-width-card)] border-[var(--color-proposal-delete-border)] bg-[var(--color-proposal-delete-bg)] px-3.5 text-[length:var(--text-sm)] font-bold text-[var(--color-proposal-delete-text)] hover:opacity-90 whitespace-nowrap"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  <span>刪除</span>
                </button>
              )
            ) : (
              <span />
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="min-h-[44px] rounded-[var(--radius-sm)] border-[length:var(--border-width-card)] border-[var(--color-border-strong)] bg-[var(--color-bg-surface)] px-4 text-[length:var(--text-sm)] font-bold text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] whitespace-nowrap"
              >
                取消
              </button>
              <LiquidButton
                type="submit"
                disabled={isSubmitting}
                className="min-h-[44px] rounded-[var(--radius-sm)] border border-[var(--color-accent-primary)] bg-[var(--color-accent-primary)] px-5 text-[length:var(--text-sm)] font-bold text-[var(--color-text-inverse)] hover:bg-[var(--color-accent-primary-hover)] whitespace-nowrap disabled:opacity-50"
              >
                <span className="relative z-10">{isEdit ? '儲存變更' : '建立項目'}</span>
              </LiquidButton>
            </div>
          </div>
        </form>
          </div>
        )}
        </div>
      </SpatialMorphModal>

      <AnimatePresence>
        {lightboxAttachment && (
          <motion.div
            key="attachment-lightbox-backdrop"
            initial="hidden"
            animate="visible"
            exit="exit"
            variants={MODAL_BACKDROP_VARIANTS}
            data-testid="attachment-lightbox"
            role="dialog"
            aria-modal="true"
            aria-label={`圖片預覽：${lightboxAttachment.name}`}
            className="fixed inset-0 z-[var(--z-lightbox)] flex flex-col items-center justify-center bg-slate-950/88 p-4"
            onClick={() => setLightboxAttachment(null)}
          >
            <motion.div
              variants={MODAL_PANEL_VARIANTS}
              className="flex w-full max-w-4xl items-center justify-between gap-3 pb-3 text-white"
              onClick={(e) => e.stopPropagation()}
            >
              <p className="truncate text-[length:var(--text-sm)] font-bold">
                {lightboxAttachment.name}
              </p>
              <div className="flex shrink-0 items-center gap-2">
                <LiquidButton
                  onClick={() => triggerAttachmentDownload(lightboxAttachment)}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-[var(--radius-sm)] border border-white/25 bg-white/10 px-3 text-[length:var(--text-xs)] font-bold text-white hover:bg-white/20"
                >
                  <Download className="relative z-10 h-4 w-4" aria-hidden="true" />
                  <span className="relative z-10">下載圖片</span>
                </LiquidButton>
                <LiquidButton
                  aria-label="關閉圖片預覽"
                  onClick={() => setLightboxAttachment(null)}
                  className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-[var(--radius-sm)] border border-white/25 bg-white/10 text-white hover:bg-white/20"
                >
                  <X className="relative z-10 h-5 w-5" aria-hidden="true" />
                </LiquidButton>
              </div>
            </motion.div>

            <motion.img
              variants={MODAL_PANEL_VARIANTS}
              src={lightboxAttachment.dataUrl}
              alt={lightboxAttachment.name}
              onClick={(e) => e.stopPropagation()}
              className="max-h-[80vh] max-w-full rounded-[var(--radius-md)] object-contain shadow-2xl"
            />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
