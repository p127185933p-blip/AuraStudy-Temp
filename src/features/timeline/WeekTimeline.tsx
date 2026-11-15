import type { ReactNode } from 'react';
import { Plus } from 'lucide-react';
import {
  LiquidButton,
  captureOriginRect,
  type LaunchOrigin,
} from '@/components/ui/LiquidGlass';
import {
  filterItemsInDateRange,
  getDayRange,
  getWeekRange,
  isItemInDateRange,
} from '@/domain/planning';
import { getProposalEffectiveItem, type ProposalChange } from '@/domain/proposals';
import { isItemPast, type CalendarItem } from '@/domain/schedule';
import {
  formatDayHeaderParts,
  getLocalTimeHHmm,
  getWeekDateKeys,
} from '@/shared/utils';

export interface WeekTimelineProps {
  selectedDate: string;
  todayDateKey: string;
  referenceNow?: Date;
  timeZone: string;
  items: readonly CalendarItem[];
  proposals?: readonly ProposalChange[];
  onSelectDate: (dateKey: string) => void;
  onOpenDayView: (dateKey: string) => void;
  onRequestCreateForDate: (dateKey: string, origin?: LaunchOrigin) => void;
  renderItemCard: (item: CalendarItem) => ReactNode;
  renderProposalCard?: (change: ProposalChange) => ReactNode;
}

export function WeekTimeline({
  selectedDate,
  todayDateKey,
  referenceNow,
  timeZone,
  items,
  proposals = [],
  onSelectDate,
  onOpenDayView,
  onRequestCreateForDate,
  renderItemCard,
  renderProposalCard,
}: WeekTimelineProps) {
  const effectiveNow = referenceNow ?? new Date();
  const nowTimeLabel = getLocalTimeHHmm(effectiveNow.toISOString(), timeZone);
  const weekDateKeys = getWeekDateKeys(selectedDate, 1);
  const weekRange = getWeekRange(selectedDate, { timeZone, weekStartsOn: 1 });
  const weekItems = filterItemsInDateRange(items, weekRange).items;

  return (
    <section
      data-testid="week-timeline"
      aria-label="週時間軸視圖"
    >
      <div
        data-horizontal-scrollable="true"
        className="flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory lg:grid lg:grid-cols-7 lg:overflow-visible lg:pb-0"
      >
        {weekDateKeys.map((dateKey) => {
          const dayRange = getDayRange(dateKey, { timeZone });
          const { deadlines, schedules } = filterItemsInDateRange(weekItems, dayRange);
          const dayProposals = proposals.filter((p) =>
            isItemInDateRange(getProposalEffectiveItem(p), dayRange),
          );
          const header = formatDayHeaderParts(dateKey);
          const isSelected = dateKey === selectedDate;
          const isToday = dateKey === todayDateKey;
          const pastSchedules = isToday
            ? schedules.filter((sc) => isItemPast(sc, effectiveNow, timeZone))
            : [];
          const upcomingSchedules = isToday
            ? schedules.filter((sc) => !isItemPast(sc, effectiveNow, timeZone))
            : schedules;

          const nowDivider = isToday ? (
            <div
              data-testid="current-time-indicator"
              aria-label={`現在時間指示線 ${nowTimeLabel}`}
              className="flex items-center gap-1.5 py-0.5"
            >
              <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--color-now-indicator)]" />
              <span className="h-[2px] flex-1 bg-[var(--color-now-indicator)] opacity-80" />
              <span className="font-[family-name:var(--font-mono)] text-[10px] font-bold tabular-nums text-[var(--color-now-indicator)]">
                現在 {nowTimeLabel}
              </span>
            </div>
          ) : null;

          return (
            <div
              key={dateKey}
              data-testid={`week-column-${dateKey}`}
              className={`flex min-w-[78vw] flex-col overflow-hidden rounded-[var(--radius-lg)] snap-start sm:min-w-[260px] lg:min-w-0 ${
                isSelected
                  ? 'glass-layer-2 border-[var(--color-accent-primary-border)]'
                  : 'glass-layer-1'
              }`}
            >
              {/* Column Header */}
              <div
                className={`flex items-center justify-between gap-1 border-b px-3 py-2.5 ${
                  isSelected
                    ? 'border-[var(--color-accent-primary-border)] bg-[var(--color-accent-primary-soft)]'
                    : 'border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)]'
                }`}
              >
                <button
                  type="button"
                  onClick={() => {
                    onSelectDate(dateKey);
                    onOpenDayView(dateKey);
                  }}
                  aria-label={`前往 ${dateKey} 日視圖`}
                  className="flex min-h-[40px] flex-1 items-center gap-2 text-left"
                >
                  <span
                    className={`flex h-8 min-w-[32px] items-center justify-center rounded-[var(--radius-sm)] px-1.5 font-[family-name:var(--font-mono)] text-[length:var(--text-sm)] font-bold tabular-nums ${
                      isToday
                        ? 'bg-[var(--color-accent-primary)] text-[var(--color-text-inverse)] shadow-sm'
                        : 'text-[var(--color-text-primary)]'
                    }`}
                  >
                    {header.dayNumber}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[length:var(--text-xs)] font-bold text-[var(--color-text-secondary)]">
                      {header.weekday}
                    </p>
                    <p className="font-[family-name:var(--font-mono)] text-[11px] font-medium tabular-nums text-[var(--color-text-muted)]">
                      {header.monthDay}
                    </p>
                  </div>
                </button>

                <LiquidButton
                  sheen={false}
                  onClick={(e) =>
                    onRequestCreateForDate(
                      dateKey,
                      captureOriginRect(e.currentTarget) ?? undefined,
                    )
                  }
                  aria-label={`在 ${dateKey} 新增項目`}
                  className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-accent-primary)]"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                </LiquidButton>
              </div>

              {/* Column Body: Deadlines on top, Schedules & Proposals below */}
              <div className="flex flex-1 flex-col gap-3 p-2.5">
                {deadlines.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    <p className="text-[11px] font-bold text-[var(--color-deadline-accent)]">
                      截止事項
                    </p>
                    {deadlines.map((dl) => (
                      <div key={dl.id}>{renderItemCard(dl)}</div>
                    ))}
                  </div>
                )}

                {dayProposals.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    {dayProposals.map((change) => (
                      <div key={change.id}>{renderProposalCard?.(change)}</div>
                    ))}
                  </div>
                )}

                <div className="flex flex-1 flex-col gap-2">
                  {isToday && pastSchedules.map((sc) => (
                    <div key={sc.id}>{renderItemCard(sc)}</div>
                  ))}
                  {nowDivider}
                  {upcomingSchedules.length > 0 ? (
                    upcomingSchedules.map((sc) => (
                      <div key={sc.id}>{renderItemCard(sc)}</div>
                    ))
                  ) : !isToday && deadlines.length === 0 && dayProposals.length === 0 ? (
                    <p className="py-6 text-center text-[length:var(--text-xs)] text-[var(--color-text-muted)]">
                      無行程
                    </p>
                  ) : isToday &&
                    pastSchedules.length === 0 &&
                    deadlines.length === 0 &&
                    dayProposals.length === 0 ? (
                    <p className="py-4 text-center text-[length:var(--text-xs)] text-[var(--color-text-muted)]">
                      無行程
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
