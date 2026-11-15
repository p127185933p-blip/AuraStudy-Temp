import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { CalendarClock, Flag, Paperclip } from 'lucide-react';
import {
  captureOriginRect,
  type LaunchOrigin,
} from '@/components/ui/LiquidGlass';
import {
  isDeadline,
  isItemPast,
  type CalendarItem,
  type TagColorPreset,
} from '@/domain/schedule';
import { isValidIsoDateOnly } from '@/shared/schemas';
import { getDateKeyFromInstant, getLocalTimeHHmm, getTagColorMeta } from '@/shared/utils';
import { LIQUID_SPRING_DEFAULT } from '@/styles/motion';

export interface CalendarItemCardProps {
  item: CalendarItem;
  timeZone: string;
  referenceNow?: Date;
  variant?: 'compact' | 'standard';
  overrideTimeLabel?: string;
  isDragging?: boolean;
  tagColor?: TagColorPreset;
  onSelect?: (item: CalendarItem, origin?: LaunchOrigin) => void;
  dragHandle?: ReactNode;
}

export function CalendarItemCard({
  item,
  timeZone,
  referenceNow,
  variant = 'standard',
  overrideTimeLabel,
  isDragging = false,
  tagColor,
  onSelect,
  dragHandle,
}: CalendarItemCardProps) {
  const attachmentCount = item.attachments?.length ?? 0;
  const tagMeta = item.tag && tagColor ? getTagColorMeta(tagColor) : null;
  const isPast = isItemPast(item, referenceNow ?? new Date(), timeZone);

  if (isDeadline(item)) {
    const dueDateKey = getDateKeyFromInstant(item.dueDate, timeZone);
    const hasDueTime = !isValidIsoDateOnly(item.dueDate);
    const dueLabel = hasDueTime
      ? `${dueDateKey} ${getLocalTimeHHmm(item.dueDate, timeZone)}`
      : dueDateKey;

    const isTitleStruck = isPast || item.status === 'completed';
    const accentStripeColor = isPast
      ? 'var(--color-border-strong)'
      : tagMeta
        ? tagMeta.swatchHex
        : 'var(--color-deadline-accent)';

    return (
      <motion.div
        layout="position"
        transition={{ layout: LIQUID_SPRING_DEFAULT }}
        data-testid={`calendar-card-${item.id}`}
        data-item-type="deadline"
        data-item-past={isPast ? 'true' : 'false'}
        className={`relative ${isPast ? 'opacity-60' : ''}`}
      >
        <div
          data-liquid-squish="true"
          className={`liquid-squish-target glass-layer-2 relative flex w-full items-stretch gap-2.5 overflow-hidden rounded-[var(--radius-md)] ${
            isPast
              ? 'border-[var(--color-border-strong)] bg-[var(--color-bg-subtle)]'
              : 'border-[var(--color-deadline-border)] bg-[var(--color-deadline-bg)]'
          } ${variant === 'compact' ? 'px-2.5 py-1.5' : 'px-3.5 py-2.5'}`}
        >
          <span
            aria-hidden="true"
            className="relative z-10 w-1 shrink-0 self-stretch rounded-full"
            style={{ backgroundColor: accentStripeColor }}
          />

          <button
            type="button"
            onClick={(e) => {
              const cardEl =
                e.currentTarget.closest('[data-testid^="calendar-card-"]') ??
                e.currentTarget;
              onSelect?.(item, captureOriginRect(cardEl) ?? undefined);
            }}
            className="relative z-10 flex min-h-[40px] flex-1 min-w-0 items-center justify-between gap-2 text-left focus-visible:outline-none"
          >
            <div className="min-w-0 flex-1">
              <div
                className={`flex items-center gap-1.5 text-[length:var(--text-xs)] font-bold ${
                  isPast
                    ? 'text-[var(--color-text-muted)]'
                    : 'text-[var(--color-deadline-accent)]'
                }`}
              >
                <Flag className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="whitespace-nowrap">截止</span>
                {item.tag && (
                  <>
                    <span aria-hidden="true">·</span>
                    {tagMeta && (
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: tagMeta.swatchHex }}
                        aria-hidden="true"
                      />
                    )}
                    <span className="truncate font-medium">{item.tag}</span>
                  </>
                )}
                {attachmentCount > 0 && (
                  <span
                    data-testid={`attachment-badge-${item.id}`}
                    aria-label={`含 ${attachmentCount} 個附件`}
                    className={`inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[11px] font-semibold ${
                      isPast
                        ? 'text-[var(--color-text-muted)]'
                        : 'text-[var(--color-deadline-text)]'
                    }`}
                  >
                    <Paperclip className="h-3 w-3 shrink-0" aria-hidden="true" />
                    <span>{attachmentCount}</span>
                  </span>
                )}
              </div>
              <p
                className={`mt-0.5 truncate font-bold ${
                  variant === 'compact'
                    ? 'text-[length:var(--text-xs)]'
                    : 'text-[length:var(--text-sm)]'
                } ${
                  isPast
                    ? 'text-[var(--color-text-secondary)]'
                    : 'text-[var(--color-deadline-text)]'
                } ${isTitleStruck ? 'line-through' : ''} ${
                  !isPast && item.status === 'completed' ? 'opacity-70' : ''
                }`}
              >
                {item.title}
              </p>
            </div>
            <span
              className={`shrink-0 font-[family-name:var(--font-mono)] text-[length:var(--text-xs)] font-semibold tabular-nums ${
                isPast
                  ? 'text-[var(--color-text-muted)]'
                  : 'text-[var(--color-deadline-text)]'
              }`}
            >
              {dueLabel}
            </span>
          </button>
        </div>
      </motion.div>
    );
  }

  const timeRangeLabel =
    overrideTimeLabel ??
    `${getLocalTimeHHmm(item.startAt, timeZone)} – ${getLocalTimeHHmm(item.endAt, timeZone)}`;
  const isTitleStruck = isPast || item.status === 'cancelled';
  const accentStripeColor = isPast
    ? 'var(--color-border-strong)'
    : tagMeta
      ? tagMeta.swatchHex
      : 'var(--color-schedule-accent)';

  return (
    <motion.div
      layout={isDragging ? false : 'position'}
      transition={{ layout: LIQUID_SPRING_DEFAULT }}
      data-testid={`calendar-card-${item.id}`}
      data-item-type="schedule"
      data-item-past={isPast ? 'true' : 'false'}
      className={`relative h-full ${isPast ? 'opacity-60' : ''}`}
    >
      <div
        data-liquid-squish={isDragging ? undefined : 'true'}
        className={`${
          isDragging ? '' : 'liquid-squish-target'
        } glass-layer-2 relative flex h-full w-full items-stretch gap-2 overflow-hidden rounded-[var(--radius-md)] ${
          isPast
            ? 'border-[var(--color-border-strong)] bg-[var(--color-bg-subtle)]'
            : 'border-[var(--color-schedule-border)] bg-[var(--color-schedule-bg)]'
        } ${
          isDragging ? 'ring-2 ring-[var(--color-accent-primary)] shadow-[var(--glass-layer-3-shadow)]' : ''
        } ${variant === 'compact' ? 'px-2.5 py-1.5' : 'px-3 py-2'}`}
      >
        <span
          aria-hidden="true"
          className="relative z-10 w-1 shrink-0 self-stretch rounded-full"
          style={{ backgroundColor: accentStripeColor }}
        />

        <button
          type="button"
          onClick={(e) => {
            const cardEl =
              e.currentTarget.closest('[data-testid^="calendar-card-"]') ??
              e.currentTarget;
            onSelect?.(item, captureOriginRect(cardEl) ?? undefined);
          }}
          className="relative z-10 flex min-h-[40px] flex-1 min-w-0 flex-col justify-center text-left focus-visible:outline-none"
        >
          <div
            className={`flex items-center gap-1.5 text-[length:var(--text-xs)] font-semibold tabular-nums ${
              isPast
                ? 'text-[var(--color-text-muted)]'
                : 'text-[var(--color-schedule-accent)]'
            }`}
          >
            <CalendarClock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="font-[family-name:var(--font-mono)] whitespace-nowrap tabular-nums">
              {timeRangeLabel}
            </span>
            {item.tag && variant !== 'compact' && (
              <>
                <span aria-hidden="true">·</span>
                {tagMeta && (
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: tagMeta.swatchHex }}
                    aria-hidden="true"
                  />
                )}
                <span className="truncate">{item.tag}</span>
              </>
            )}
            {attachmentCount > 0 && (
              <span
                data-testid={`attachment-badge-${item.id}`}
                aria-label={`含 ${attachmentCount} 個附件`}
                className={`inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[11px] font-semibold ${
                  isPast
                    ? 'text-[var(--color-text-muted)]'
                    : 'text-[var(--color-schedule-text)]'
                }`}
              >
                <Paperclip className="h-3 w-3 shrink-0" aria-hidden="true" />
                <span>{attachmentCount}</span>
              </span>
            )}
          </div>
          <p
            className={`mt-0.5 truncate font-bold ${
              variant === 'compact'
                ? 'text-[length:var(--text-xs)]'
                : 'text-[length:var(--text-sm)]'
            } ${
              isPast
                ? 'text-[var(--color-text-secondary)]'
                : 'text-[var(--color-schedule-text)]'
            } ${isTitleStruck ? 'line-through' : ''} ${
              !isPast && item.status === 'cancelled' ? 'opacity-60' : ''
            }`}
          >
            {item.title}
          </p>
        </button>
        {dragHandle && <div className="relative z-10 flex items-center shrink-0">{dragHandle}</div>}
      </div>
    </motion.div>
  );
}
