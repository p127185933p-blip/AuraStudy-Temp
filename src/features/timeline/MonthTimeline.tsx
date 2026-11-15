import type { ReactNode } from 'react';
import { captureOriginRect, type LaunchOrigin } from '@/components/ui/LiquidGlass';
import {
  filterItemsInDateRange,
  getDayRange,
  getMonthRange,
  isItemInDateRange,
} from '@/domain/planning';
import { getProposalEffectiveItem, type ProposalChange } from '@/domain/proposals';
import { isItemPast, type CalendarItem } from '@/domain/schedule';
import {
  formatDayHeaderParts,
  getLocalTimeHHmm,
  getMonthGridDateKeys,
  parseDateKey,
} from '@/shared/utils';

export interface MonthTimelineProps {
  selectedDate: string;
  todayDateKey: string;
  referenceNow?: Date;
  timeZone: string;
  items: readonly CalendarItem[];
  proposals?: readonly ProposalChange[];
  onSelectDate: (dateKey: string) => void;
  onOpenDayView: (dateKey: string) => void;
  onSelectItem: (item: CalendarItem, origin?: LaunchOrigin) => void;
  renderItemCard: (item: CalendarItem) => ReactNode;
  renderProposalCard?: (change: ProposalChange) => ReactNode;
}

const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'] as const;

export function MonthTimeline({
  selectedDate,
  todayDateKey,
  referenceNow,
  timeZone,
  items,
  proposals = [],
  onSelectDate,
  onOpenDayView,
  onSelectItem,
  renderItemCard,
  renderProposalCard,
}: MonthTimelineProps) {
  const effectiveNow = referenceNow ?? new Date();
  const { month: activeMonth } = parseDateKey(selectedDate);
  const gridDateKeys = getMonthGridDateKeys(selectedDate, 1);

  const monthRange = getMonthRange(selectedDate, { timeZone });
  const monthFiltered = filterItemsInDateRange(items, monthRange);

  const selectedDayRange = getDayRange(selectedDate, { timeZone });
  const selectedDayItems = filterItemsInDateRange(items, selectedDayRange);
  const selectedDayProposals = proposals.filter((p) =>
    isItemInDateRange(getProposalEffectiveItem(p), selectedDayRange),
  );
  const selectedDayMeta = formatDayHeaderParts(selectedDate);

  return (
    <div data-testid="month-timeline" className="flex flex-col gap-4">
      <div className="glass-layer-1 overflow-hidden rounded-[var(--radius-lg)]">
        {/* Weekday header */}
        <div className="grid grid-cols-7 border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)]">
          {WEEKDAY_LABELS.map((label) => (
            <div
              key={label}
              className="py-2.5 text-center text-[length:var(--text-xs)] font-bold text-[var(--color-text-secondary)]"
            >
              週{label}
            </div>
          ))}
        </div>

        {/* Calendar Grid */}
        <div className="grid grid-cols-7">
          {gridDateKeys.map((dateKey, idx) => {
            const { month, day } = parseDateKey(dateKey);
            const isCurrentMonth = month === activeMonth;
            const isSelected = dateKey === selectedDate;
            const isToday = dateKey === todayDateKey;

            const dayRange = getDayRange(dateKey, { timeZone });
            const dayData = filterItemsInDateRange(
              isCurrentMonth ? monthFiltered.items : items,
              dayRange,
            );
            const dayProposals = proposals.filter((p) =>
              isItemInDateRange(getProposalEffectiveItem(p), dayRange),
            );
            const totalCount =
              dayData.deadlines.length + dayData.schedules.length + dayProposals.length;
            const visibleDeadlines = dayData.deadlines.slice(0, 2);
            const remainingSlots = Math.max(0, 3 - visibleDeadlines.length);
            const visibleSchedules = dayData.schedules.slice(0, remainingSlots);
            const hiddenCount =
              dayData.deadlines.length +
              dayData.schedules.length -
              visibleDeadlines.length -
              visibleSchedules.length;

            return (
              <div
                key={dateKey}
                data-testid={`month-cell-${dateKey}`}
                onClick={() => onSelectDate(dateKey)}
                className={`min-h-[84px] cursor-pointer border-b border-r border-[var(--color-border-subtle)] p-1.5 transition-colors sm:min-h-[112px] sm:p-2 ${
                  (idx + 1) % 7 === 0 ? 'border-r-0' : ''
                } ${
                  isSelected
                    ? 'bg-[var(--color-accent-primary-soft)]'
                    : isCurrentMonth
                      ? 'bg-[var(--color-bg-surface)] hover:bg-[var(--color-bg-subtle)]'
                      : 'bg-[var(--color-bg-canvas)] text-[var(--color-text-muted)]'
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <button
                    type="button"
                    aria-label={`查看 ${dateKey} 日視圖`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenDayView(dateKey);
                    }}
                    className={`flex min-h-[32px] min-w-[32px] items-center justify-center rounded-[var(--radius-sm)] font-[family-name:var(--font-mono)] text-[length:var(--text-xs)] font-bold tabular-nums sm:text-[length:var(--text-sm)] ${
                      isToday
                        ? 'bg-[var(--color-accent-primary)] text-[var(--color-text-inverse)]'
                        : isSelected
                          ? 'border-[length:var(--border-width-card)] border-[var(--color-accent-primary)] bg-[var(--color-bg-surface)] text-[var(--color-accent-primary)]'
                          : isCurrentMonth
                            ? 'text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)]'
                            : 'text-[var(--color-text-muted)]'
                    }`}
                  >
                    {day}
                  </button>

                  {totalCount > 0 && (
                    <span className="font-[family-name:var(--font-mono)] text-[10px] font-bold tabular-nums text-[var(--color-text-muted)] sm:hidden">
                      {totalCount}
                    </span>
                  )}
                </div>

                {/* Mobile minimal indicator dots */}
                {totalCount > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1 sm:hidden">
                    {dayData.deadlines.slice(0, 2).map((dl) => (
                      <span
                        key={dl.id}
                        className="h-2 w-2 rounded-full bg-[var(--color-deadline-accent)]"
                        title={dl.title}
                      />
                    ))}
                    {dayData.schedules.slice(0, 3).map((sc) => (
                      <span
                        key={sc.id}
                        className="h-2 w-2 rounded-full bg-[var(--color-schedule-accent)]"
                        title={sc.title}
                      />
                    ))}
                    {dayProposals.slice(0, 2).map((p) => (
                      <span
                        key={p.id}
                        className="h-2 w-2 rounded-full bg-[var(--color-proposal-create-accent)]"
                      />
                    ))}
                  </div>
                )}

                {/* Desktop / Tablet compact macro summary */}
                <div className="mt-1.5 hidden flex-col gap-1 sm:flex">
                  {visibleDeadlines.map((dl) => {
                    const past = isItemPast(dl, effectiveNow, timeZone);
                    return (
                      <button
                        key={dl.id}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectItem(dl, captureOriginRect(e.currentTarget) ?? undefined);
                        }}
                        className={`truncate rounded-[6px] border px-1.5 py-0.5 text-left text-[11px] font-bold hover:opacity-90 ${
                          past
                            ? 'border-[var(--color-border-strong)] bg-[var(--color-bg-subtle)] text-[var(--color-text-muted)] line-through opacity-60'
                            : 'border-[var(--color-deadline-border)] bg-[var(--color-deadline-bg)] text-[var(--color-deadline-text)]'
                        }`}
                      >
                        截止 · {dl.title}
                      </button>
                    );
                  })}

                  {visibleSchedules.map((sc) => {
                    const past = isItemPast(sc, effectiveNow, timeZone);
                    return (
                      <button
                        key={sc.id}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectItem(sc, captureOriginRect(e.currentTarget) ?? undefined);
                        }}
                        className={`truncate rounded-[6px] border px-1.5 py-0.5 text-left text-[11px] font-semibold hover:opacity-90 ${
                          past
                            ? 'border-[var(--color-border-strong)] bg-[var(--color-bg-subtle)] text-[var(--color-text-muted)] line-through opacity-60'
                            : 'border-[var(--color-schedule-border)] bg-[var(--color-schedule-bg)] text-[var(--color-schedule-text)]'
                        }`}
                      >
                        <span className="font-[family-name:var(--font-mono)] tabular-nums">
                          {getLocalTimeHHmm(sc.startAt, timeZone)}
                        </span>{' '}
                        {sc.title}
                      </button>
                    );
                  })}

                  {dayProposals.slice(0, 1).map((p) => (
                    <span
                      key={p.id}
                      className="truncate rounded-[6px] border border-[var(--color-proposal-create-border)] bg-[var(--color-proposal-create-bg)] px-1.5 py-0.5 text-[11px] font-bold text-[var(--color-proposal-create-text)]"
                    >
                      AI 提案 · {getProposalEffectiveItem(p).title}
                    </span>
                  ))}

                  {hiddenCount > 0 && (
                    <span className="px-1 text-[11px] font-bold text-[var(--color-text-muted)]">
                      +{hiddenCount} 項
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Selected Day Summary Strip */}
      <section
        aria-label="已選日期摘要"
        data-liquid-squish="true"
        className="liquid-squish-target glass-layer-2 rounded-[var(--radius-lg)] p-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[length:var(--text-base)] font-bold text-[var(--color-text-primary)] tabular-nums">
            {selectedDate}（{selectedDayMeta.weekday}）摘要
          </h2>
          <button
            type="button"
            onClick={() => onOpenDayView(selectedDate)}
            className="min-h-[40px] rounded-[var(--radius-sm)] border border-[var(--color-accent-primary-border)] bg-[var(--color-accent-primary-soft)] px-3 text-[length:var(--text-xs)] font-bold text-[var(--color-accent-primary)] transition-transform active:scale-95 hover:bg-[var(--color-bg-hover)] whitespace-nowrap"
          >
            切換至日視圖
          </button>
        </div>

        {selectedDayItems.items.length === 0 && selectedDayProposals.length === 0 ? (
          <p className="mt-3 text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
            當日尚未安排學習時段或截止事項。
          </p>
        ) : (
          <div className="mt-3 grid grid-cols-1 gap-2.5 md:grid-cols-2">
            {selectedDayProposals.map((change) => (
              <div key={change.id}>{renderProposalCard?.(change)}</div>
            ))}
            {selectedDayItems.deadlines.map((dl) => (
              <div key={dl.id}>{renderItemCard(dl)}</div>
            ))}
            {selectedDayItems.schedules.map((sc) => (
              <div key={sc.id}>{renderItemCard(sc)}</div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
