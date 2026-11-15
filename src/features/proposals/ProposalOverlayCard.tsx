import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, Check, Lightbulb, X } from 'lucide-react';
import { LiquidButton, LiquidSurface } from '@/components/ui/LiquidGlass';
import type { ProposalResult } from '@/application/services';
import type { AcceptProposalChangeOutput } from '@/application/commands';
import { getProposalEffectiveItem, type ProposalChange } from '@/domain/proposals';
import { isDeadline, isSchedule, type CalendarItem } from '@/domain/schedule';
import { isValidIsoDateOnly } from '@/shared/schemas';
import { getDateKeyFromInstant, getLocalTimeHHmm } from '@/shared/utils';
import { LIQUID_SPRING_DEFAULT, POPOVER_VARIANTS } from '@/styles/motion';

export interface ProposalOverlayCardProps {
  change: ProposalChange;
  timeZone: string;
  compact?: boolean;
  onAccept: (
    changeId: string,
    options?: { allowConflict?: boolean },
  ) => Promise<ProposalResult<AcceptProposalChangeOutput>>;
  onReject: (changeId: string) => Promise<ProposalResult<ProposalChange>>;
}

function formatItemSummary(item: CalendarItem, timeZone: string): string {
  if (isDeadline(item)) {
    const dateKey = getDateKeyFromInstant(item.dueDate, timeZone);
    return isValidIsoDateOnly(item.dueDate)
      ? `截止 ${dateKey}`
      : `截止 ${dateKey} ${getLocalTimeHHmm(item.dueDate, timeZone)}`;
  }
  const dateKey = getDateKeyFromInstant(item.startAt, timeZone);
  return `${dateKey} ${getLocalTimeHHmm(item.startAt, timeZone)} – ${getLocalTimeHHmm(item.endAt, timeZone)}`;
}

export function ProposalOverlayCard({
  change,
  timeZone,
  compact = false,
  onAccept,
  onReject,
}: ProposalOverlayCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [showExplanation, setShowExplanation] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [conflictNames, setConflictNames] = useState<string[] | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  const isStale = change.status === 'stale';
  const effectiveItem = getProposalEffectiveItem(change);

  useEffect(() => {
    if (!showExplanation) return;

    function handleOutsideClick(event: MouseEvent) {
      if (cardRef.current && !cardRef.current.contains(event.target as Node)) {
        setShowExplanation(false);
      }
    }

    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [showExplanation]);

  async function handleAcceptClick(allowConflict = false) {
    if (isStale || isProcessing) return;
    setIsProcessing(true);
    setErrorText(null);
    try {
      const res = await onAccept(change.id, { allowConflict });
      if (!res.ok) {
        if (res.error.code === 'TIME_CONFLICT') {
          setConflictNames(
            res.error.conflictingItems.map(
              (c) =>
                `${c.title} (${getLocalTimeHHmm(c.startAt, timeZone)}–${getLocalTimeHHmm(c.endAt, timeZone)})`,
            ),
          );
        } else {
          setErrorText(res.error.message);
        }
      } else {
        setConflictNames(null);
      }
    } finally {
      setIsProcessing(false);
    }
  }

  async function handleRejectClick() {
    if (isProcessing) return;
    setIsProcessing(true);
    setErrorText(null);
    setConflictNames(null);
    try {
      await onReject(change.id);
    } finally {
      setIsProcessing(false);
    }
  }

  const styleByAction = {
    create: {
      container:
        'border-[var(--color-proposal-create-border)] bg-[var(--color-proposal-create-bg)]',
      labelColor: 'text-[var(--color-proposal-create-accent)]',
      textColor: 'text-[var(--color-proposal-create-text)]',
      badgeText: 'AI 建議新增',
    },
    update: {
      container:
        'border-[var(--color-proposal-update-border)] bg-[var(--color-proposal-update-bg)]',
      labelColor: 'text-[var(--color-proposal-update-accent)]',
      textColor: 'text-[var(--color-proposal-update-text)]',
      badgeText: 'AI 建議調整',
    },
    delete: {
      container:
        'border-[var(--color-proposal-delete-border)] bg-[var(--color-proposal-delete-bg)]',
      labelColor: 'text-[var(--color-proposal-delete-accent)]',
      textColor: 'text-[var(--color-proposal-delete-text)]',
      badgeText: 'AI 建議刪除',
    },
  }[change.action];

  return (
    <LiquidSurface
      ref={cardRef}
      layer={2}
      squish
      layout
      initial={{ opacity: 0, scale: 0.96, y: 6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95, y: -4 }}
      transition={LIQUID_SPRING_DEFAULT}
      data-testid={`proposal-card-${change.id}`}
      data-proposal-action={change.action}
      data-proposal-status={change.status}
      className={`rounded-[var(--radius-md)] ${
        isStale
          ? 'border-[var(--color-border-strong)] bg-[var(--color-bg-subtle)] opacity-85'
          : styleByAction.container
      } ${compact ? 'p-2.5' : 'p-3'}`}
    >
      <div className="relative z-10 flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={`text-[length:var(--text-xs)] font-bold ${
                isStale ? 'text-[var(--color-text-muted)]' : styleByAction.labelColor
              }`}
            >
              {isStale ? '已過期（資料已變更）' : styleByAction.badgeText}
            </span>
            <span className="text-[11px] font-medium text-[var(--color-text-muted)]">
              · {isSchedule(effectiveItem) ? '排程' : '截止'}
            </span>
          </div>

          {/* Diff content based on action */}
          {change.action === 'update' && change.before && change.after ? (
            <div className="mt-1 space-y-0.5">
              <p className="truncate text-[length:var(--text-xs)] text-[var(--color-text-muted)] line-through">
                {change.before.title}（{formatItemSummary(change.before, timeZone)}）
              </p>
              <p
                className={`truncate text-[length:var(--text-sm)] font-bold ${
                  isStale ? 'text-[var(--color-text-secondary)]' : styleByAction.textColor
                }`}
              >
                {change.after.title}（{formatItemSummary(change.after, timeZone)}）
              </p>
            </div>
          ) : (
            <div className="mt-1">
              <p
                className={`truncate text-[length:var(--text-sm)] font-bold ${
                  change.action === 'delete' ? 'line-through' : ''
                } ${isStale ? 'text-[var(--color-text-secondary)]' : styleByAction.textColor}`}
              >
                {effectiveItem.title}
              </p>
              <p className="mt-0.5 font-[family-name:var(--font-mono)] text-[length:var(--text-xs)] font-semibold tabular-nums text-[var(--color-text-secondary)]">
                {formatItemSummary(effectiveItem, timeZone)}
              </p>
            </div>
          )}
        </div>

        {/* Fixed 3 Minimal Action Buttons: ✓ / × / 💡 */}
        <div className="flex shrink-0 items-center gap-1">
          <LiquidButton
            glassLayer={1}
            disabled={isStale || isProcessing}
            aria-disabled={isStale}
            aria-label="接受提案"
            data-testid={`proposal-accept-${change.id}`}
            onClick={() => void handleAcceptClick(false)}
            className="flex min-h-[38px] min-w-[38px] items-center justify-center rounded-[var(--radius-sm)] border-[var(--color-proposal-create-border)] text-[var(--color-proposal-create-accent)] hover:bg-[var(--color-proposal-create-bg)] disabled:cursor-not-allowed disabled:border-[var(--color-border-subtle)] disabled:text-[var(--color-text-muted)] disabled:opacity-50"
          >
            <Check className="relative z-10 h-4 w-4" aria-hidden="true" />
          </LiquidButton>

          <LiquidButton
            glassLayer={1}
            disabled={isProcessing}
            aria-label="拒絕提案"
            data-testid={`proposal-reject-${change.id}`}
            onClick={() => void handleRejectClick()}
            className="flex min-h-[38px] min-w-[38px] items-center justify-center rounded-[var(--radius-sm)] border-[var(--color-proposal-delete-border)] text-[var(--color-proposal-delete-accent)] hover:bg-[var(--color-proposal-delete-bg)] disabled:opacity-50"
          >
            <X className="relative z-10 h-4 w-4" aria-hidden="true" />
          </LiquidButton>

          <LiquidButton
            glassLayer={1}
            aria-label="查看提案理由"
            aria-expanded={showExplanation}
            data-testid={`proposal-explain-${change.id}`}
            onClick={() => setShowExplanation((prev) => !prev)}
            className={`flex min-h-[38px] min-w-[38px] items-center justify-center rounded-[var(--radius-sm)] transition-colors ${
              showExplanation
                ? 'border-[var(--color-deadline-accent)] bg-[var(--color-deadline-bg)] text-[var(--color-deadline-accent)]'
                : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]'
            }`}
          >
            <Lightbulb className="relative z-10 h-4 w-4" aria-hidden="true" />
          </LiquidButton>
        </div>
      </div>

      {/* Inline Time Conflict Prompt on Accept */}
      {conflictNames && (
        <div
          role="alert"
          className="relative z-10 mt-2.5 rounded-[var(--radius-sm)] border border-[var(--color-deadline-border)] bg-[var(--color-deadline-bg)] p-2.5 text-[length:var(--text-xs)] text-[var(--color-deadline-text)]"
        >
          <div className="flex items-start gap-1.5">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div className="flex-1">
              <p className="font-bold">套用將與以下行程衝突：{conflictNames.join('、')}</p>
              <div className="mt-2 flex gap-2">
                <LiquidButton
                  onClick={() => void handleAcceptClick(true)}
                  className="min-h-[34px] rounded-[6px] bg-[var(--color-deadline-accent)] px-2.5 font-bold text-white"
                >
                  <span className="relative z-10">仍要套用</span>
                </LiquidButton>
                <LiquidButton
                  glassLayer={1}
                  onClick={() => setConflictNames(null)}
                  className="min-h-[34px] rounded-[6px] px-2.5 font-bold text-[var(--color-text-secondary)]"
                >
                  <span className="relative z-10">取消</span>
                </LiquidButton>
              </div>
            </div>
          </div>
        </div>
      )}

      {errorText && (
        <p className="relative z-10 mt-2 text-[length:var(--text-xs)] font-semibold text-[var(--color-proposal-delete-text)]">
          {errorText}
        </p>
      )}

      {/* Lightweight Floating Explanation Popover (💡) */}
      <AnimatePresence>
        {showExplanation && (
          <motion.div
            initial="hidden"
            animate="visible"
            exit="exit"
            variants={POPOVER_VARIANTS}
            role="dialog"
            aria-label="提案說明"
            data-testid={`proposal-popover-${change.id}`}
            className="glass-layer-3 absolute right-0 top-full z-[var(--z-popover)] mt-1.5 w-72 max-w-[calc(100vw-2rem)] rounded-[var(--radius-md)] p-3 text-[length:var(--text-xs)] leading-[var(--leading-normal)] text-[var(--color-text-primary)]"
          >
            <p className="font-bold text-[var(--color-text-primary)]">提案說明</p>
            <p className="mt-1 text-[var(--color-text-secondary)]">
              {change.reason ?? 'AI 根據您目前的學習排程產生此建議。'}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </LiquidSurface>
  );
}
