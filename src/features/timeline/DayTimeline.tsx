import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { GripVertical } from 'lucide-react';
import { captureOriginRect, type LaunchOrigin } from '@/components/ui/LiquidGlass';
import {
  filterItemsInDateRange,
  getDayRange,
  isItemInDateRange,
} from '@/domain/planning';
import { getProposalEffectiveItem, type ProposalChange } from '@/domain/proposals';
import { isDeadline, isSchedule, type CalendarItem, type Schedule } from '@/domain/schedule';
import {
  buildIsoFromLocalDateTime,
  getDateKeyFromInstant,
  getLocalTimeHHmm,
  getMinutesFromMidnight,
  minutesToHHmm,
} from '@/shared/utils';

export const DAY_TIMELINE_HOUR_HEIGHT = 64;
const SNAP_MINUTES = 15;
const TOTAL_MINUTES = 24 * 60;

export interface DayTimelineRenderCardOptions {
  overrideTimeLabel?: string;
  isDragging: boolean;
  dragHandle: ReactNode;
}

export interface DayTimelineProps {
  selectedDate: string;
  todayDateKey?: string;
  referenceNow?: Date;
  timeZone: string;
  items: readonly CalendarItem[];
  proposals?: readonly ProposalChange[];
  onRequestCreateAt: (
    dateKey: string,
    startTime: string,
    endTime: string,
    origin?: LaunchOrigin,
  ) => void;
  onRescheduleSchedule: (
    schedule: Schedule,
    newStartAt: string,
    newEndAt: string,
  ) => Promise<void>;
  renderDeadlineCard: (item: CalendarItem) => ReactNode;
  renderScheduleCard: (
    schedule: Schedule,
    options: DayTimelineRenderCardOptions,
  ) => ReactNode;
  renderProposalCard?: (change: ProposalChange) => ReactNode;
}

interface PositionedSchedule {
  schedule: Schedule;
  startMinute: number;
  endMinute: number;
  column: number;
  columnCount: number;
}

interface ActiveDragState {
  schedule: Schedule;
  startY: number;
  originalStartMinute: number;
  originalDurationMinutes: number;
  previewStartMinute: number;
  previewEndMinute: number;
}

function layoutDaySchedules(
  schedules: readonly Schedule[],
  dayStartMs: number,
  dayEndMs: number,
): PositionedSchedule[] {
  const clamped = schedules
    .map((schedule) => {
      const startMs = Math.max(dayStartMs, Date.parse(schedule.startAt));
      const endMs = Math.min(dayEndMs, Date.parse(schedule.endAt));
      const startMinute = Math.max(
        0,
        Math.min(TOTAL_MINUTES - 15, Math.round((startMs - dayStartMs) / 60_000)),
      );
      const endMinute = Math.max(
        startMinute + 15,
        Math.min(TOTAL_MINUTES, Math.round((endMs - dayStartMs) / 60_000)),
      );
      return { schedule, startMinute, endMinute };
    })
    .sort((a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute);

  const result: PositionedSchedule[] = [];
  let cluster: typeof clamped = [];
  let clusterEnd = -1;

  const flushCluster = (group: typeof clamped) => {
    if (group.length === 0) return;
    const laneEnds: number[] = [];
    const assigned = group.map((entry) => {
      let laneIndex = laneEnds.findIndex((endMin) => endMin <= entry.startMinute);
      if (laneIndex === -1) {
        laneIndex = laneEnds.length;
        laneEnds.push(entry.endMinute);
      } else {
        laneEnds[laneIndex] = entry.endMinute;
      }
      return { ...entry, column: laneIndex };
    });

    const columnCount = Math.max(1, laneEnds.length);
    for (const item of assigned) {
      result.push({ ...item, columnCount });
    }
  };

  for (const item of clamped) {
    if (cluster.length === 0 || item.startMinute < clusterEnd) {
      cluster.push(item);
      clusterEnd = Math.max(clusterEnd, item.endMinute);
    } else {
      flushCluster(cluster);
      cluster = [item];
      clusterEnd = item.endMinute;
    }
  }
  flushCluster(cluster);

  return result;
}

export function DayTimeline({
  selectedDate,
  todayDateKey,
  referenceNow,
  timeZone,
  items,
  proposals = [],
  onRequestCreateAt,
  onRescheduleSchedule,
  renderDeadlineCard,
  renderScheduleCard,
  renderProposalCard,
}: DayTimelineProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [dragState, setDragState] = useState<ActiveDragState | null>(null);
  const dragStateRef = useRef<ActiveDragState | null>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);

  const dayRange = useMemo(
    () => getDayRange(selectedDate, { timeZone }),
    [selectedDate, timeZone],
  );
  const dayFiltered = useMemo(
    () => filterItemsInDateRange(items, dayRange),
    [dayRange, items],
  );
  const positionedSchedules = useMemo(
    () => layoutDaySchedules(dayFiltered.schedules, dayRange.startMs, dayRange.endMs),
    [dayFiltered.schedules, dayRange.endMs, dayRange.startMs],
  );

  const dayProposals = useMemo(
    () =>
      proposals.filter((p) =>
        isItemInDateRange(getProposalEffectiveItem(p), dayRange),
      ),
    [dayRange, proposals],
  );

  const deadlineProposals = useMemo(
    () => dayProposals.filter((p) => isDeadline(getProposalEffectiveItem(p))),
    [dayProposals],
  );

  const scheduleProposals = useMemo(
    () => dayProposals.filter((p) => isSchedule(getProposalEffectiveItem(p))),
    [dayProposals],
  );

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || typeof container.scrollTo !== 'function') return;

    const firstSchedule = positionedSchedules[0];
    const targetHour = firstSchedule
      ? Math.max(0, Math.floor(firstSchedule.startMinute / 60) - 1)
      : 8;
    container.scrollTo({ top: targetHour * DAY_TIMELINE_HOUR_HEIGHT, behavior: 'auto' });
  }, [selectedDate]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return () => {
      dragCleanupRef.current?.();
      dragStateRef.current = null;
    };
  }, []);

  function startDragging(
    event: ReactPointerEvent<HTMLButtonElement>,
    positioned: PositionedSchedule,
  ) {
    event.stopPropagation();
    event.preventDefault();
    dragCleanupRef.current?.();

    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // Ignore synthetic pointer events in test environments
    }

    const durationMinutes = Math.max(
      15,
      Math.round(
        (Date.parse(positioned.schedule.endAt) -
          Date.parse(positioned.schedule.startAt)) /
          60_000,
      ),
    );

    const initial: ActiveDragState = {
      schedule: positioned.schedule,
      startY: event.clientY,
      originalStartMinute: positioned.startMinute,
      originalDurationMinutes: durationMinutes,
      previewStartMinute: positioned.startMinute,
      previewEndMinute: Math.min(TOTAL_MINUTES, positioned.startMinute + durationMinutes),
    };

    dragStateRef.current = initial;
    setDragState(initial);

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const current = dragStateRef.current;
      if (!current) return;

      const deltaY = moveEvent.clientY - current.startY;
      const rawDeltaMinutes = (deltaY / DAY_TIMELINE_HOUR_HEIGHT) * 60;
      const snappedDelta = Math.round(rawDeltaMinutes / SNAP_MINUTES) * SNAP_MINUTES;

      const maxStart = Math.max(0, TOTAL_MINUTES - current.originalDurationMinutes);
      const nextStart = Math.max(
        0,
        Math.min(maxStart, current.originalStartMinute + snappedDelta),
      );
      const nextEnd = Math.min(
        TOTAL_MINUTES,
        nextStart + current.originalDurationMinutes,
      );

      const updated: ActiveDragState = {
        ...current,
        previewStartMinute: nextStart,
        previewEndMinute: nextEnd,
      };
      dragStateRef.current = updated;
      setDragState(updated);
    };

    const removeListeners = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', finishDrag);
      window.removeEventListener('pointercancel', finishDrag);
      if (dragCleanupRef.current === removeListeners) {
        dragCleanupRef.current = null;
      }
    };

    const finishDrag = () => {
      removeListeners();

      const finalState = dragStateRef.current;
      dragStateRef.current = null;
      setDragState(null);

      if (!finalState) return;
      if (finalState.previewStartMinute === finalState.originalStartMinute) {
        return;
      }

      const newStartHHmm = minutesToHHmm(finalState.previewStartMinute);
      const newEndHHmm = minutesToHHmm(finalState.previewEndMinute);
      const newStartAt = buildIsoFromLocalDateTime(selectedDate, newStartHHmm, timeZone);
      const newEndAt = buildIsoFromLocalDateTime(selectedDate, newEndHHmm, timeZone);

      if (Date.parse(newEndAt) > Date.parse(newStartAt)) {
        void onRescheduleSchedule(finalState.schedule, newStartAt, newEndAt);
      }
    };

    dragCleanupRef.current = removeListeners;
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', finishDrag);
    window.addEventListener('pointercancel', finishDrag);
  }

  const hours = Array.from({ length: 24 }, (_, hour) => hour);
  const effectiveNow = referenceNow ?? new Date();
  const effectiveTodayKey =
    todayDateKey ?? getDateKeyFromInstant(effectiveNow, timeZone);
  const isTodaySelected = selectedDate === effectiveTodayKey;
  const nowMinutes = getMinutesFromMidnight(effectiveNow.toISOString(), timeZone);
  const nowTopPx = (nowMinutes / 60) * DAY_TIMELINE_HOUR_HEIGHT;
  const nowTimeLabel = getLocalTimeHHmm(effectiveNow.toISOString(), timeZone);

  return (
    <section
      data-testid="day-timeline"
      aria-label="日時間軸視圖"
      className="flex flex-col gap-4"
    >
      {/* Dedicated Deadlines Section */}
      <div
        data-liquid-squish="true"
        className="liquid-squish-target glass-layer-2 rounded-[var(--radius-lg)] p-4"
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[length:var(--text-sm)] font-bold text-[var(--color-deadline-text)]">
            當日截止（Deadlines）
          </h2>
          <span className="font-[family-name:var(--font-mono)] text-[length:var(--text-xs)] font-bold tabular-nums text-[var(--color-text-muted)]">
            {dayFiltered.deadlines.length} 項
          </span>
        </div>

        {dayFiltered.deadlines.length === 0 && deadlineProposals.length === 0 ? (
          <p className="mt-2 text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
            當日無截止事項。
          </p>
        ) : (
          <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {deadlineProposals.map((change) => (
              <div key={change.id}>{renderProposalCard?.(change)}</div>
            ))}
            {dayFiltered.deadlines.map((dl) => (
              <div key={dl.id}>{renderDeadlineCard(dl)}</div>
            ))}
          </div>
        )}
      </div>

      {/* 00:00 - 24:00 Vertical Timeline */}
      <div className="glass-layer-1 overflow-hidden rounded-[var(--radius-lg)]">
        <div
          ref={scrollContainerRef}
          className="relative max-h-[68vh] overflow-y-auto"
        >
          <div
            className="relative w-full"
            style={{ height: `${24 * DAY_TIMELINE_HOUR_HEIGHT}px` }}
          >
            {/* Hour Grid Rows */}
            {hours.map((hour) => {
              const hourLabel = `${String(hour).padStart(2, '0')}:00`;
              const nextHourLabel =
                hour < 23 ? `${String(hour + 1).padStart(2, '0')}:00` : '23:59';

              return (
                <div
                  key={hour}
                  style={{ height: `${DAY_TIMELINE_HOUR_HEIGHT}px` }}
                  className="flex border-b border-[var(--color-border-subtle)]"
                >
                  <div className="w-16 shrink-0 border-r border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] pr-2 pt-1.5 text-right font-[family-name:var(--font-mono)] text-[length:var(--text-xs)] font-semibold tabular-nums text-[var(--color-text-muted)] sm:w-20">
                    {hourLabel}
                  </div>
                  <button
                    type="button"
                    aria-label={`在 ${hourLabel} 新增排程`}
                    onClick={(e) =>
                      onRequestCreateAt(
                        selectedDate,
                        hourLabel,
                        nextHourLabel,
                        captureOriginRect(e.currentTarget) ?? undefined,
                      )
                    }
                    className="flex-1 text-left transition-colors hover:bg-[var(--color-bg-hover)]/45 focus-visible:outline-none"
                  />
                </div>
              );
            })}

            {/* Positioned Schedule Cards + Proposal Overlays Layer */}
            <div className="pointer-events-none absolute inset-y-0 left-16 right-2 sm:left-20 sm:right-3">
              {positionedSchedules.map((positioned) => {
                const isDragging =
                  dragState?.schedule.id === positioned.schedule.id;
                const displayStartMinute = isDragging
                  ? dragState.previewStartMinute
                  : positioned.startMinute;
                const displayEndMinute = isDragging
                  ? dragState.previewEndMinute
                  : positioned.endMinute;

                const topPx = (displayStartMinute / 60) * DAY_TIMELINE_HOUR_HEIGHT;
                const heightPx = Math.max(
                  44,
                  ((displayEndMinute - displayStartMinute) / 60) *
                    DAY_TIMELINE_HOUR_HEIGHT,
                );

                const widthPercent = 100 / positioned.columnCount;
                const leftPercent = positioned.column * widthPercent;
                const overrideTimeLabel = isDragging
                  ? `${minutesToHHmm(displayStartMinute)} – ${minutesToHHmm(displayEndMinute)}`
                  : undefined;

                return (
                  <div
                    key={positioned.schedule.id}
                    data-testid={`day-schedule-block-${positioned.schedule.id}`}
                    style={{
                      top: `${topPx}px`,
                      height: `${heightPx}px`,
                      left: `calc(${leftPercent}% + 4px)`,
                      width: `calc(${widthPercent}% - 8px)`,
                    }}
                    className={`pointer-events-auto absolute py-0.5 ${
                      isDragging
                        ? 'z-[var(--z-timeline-header)]'
                        : 'z-[var(--z-timeline-card)]'
                    }`}
                  >
                    {renderScheduleCard(positioned.schedule, {
                      isDragging,
                      overrideTimeLabel,
                      dragHandle: (
                        <button
                          type="button"
                          data-testid={`drag-handle-${positioned.schedule.id}`}
                          aria-label={`拖曳調整 ${positioned.schedule.title} 時段`}
                          onPointerDown={(e) => startDragging(e, positioned)}
                          className="flex min-h-[40px] min-w-[40px] cursor-grab items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-schedule-accent)] hover:bg-[var(--color-bg-surface)]/70 active:cursor-grabbing touch-none"
                        >
                          <GripVertical className="h-4 w-4" aria-hidden="true" />
                        </button>
                      ),
                    })}
                  </div>
                );
              })}

              {/* AI Schedule Proposal Overlays */}
              {scheduleProposals.map((change) => {
                const effective = getProposalEffectiveItem(change);
                if (!isSchedule(effective)) return null;

                const startMs = Math.max(dayRange.startMs, Date.parse(effective.startAt));
                const endMs = Math.min(dayRange.endMs, Date.parse(effective.endAt));
                const startMinute = Math.max(
                  0,
                  Math.min(TOTAL_MINUTES - 30, Math.round((startMs - dayRange.startMs) / 60_000)),
                );
                const endMinute = Math.max(
                  startMinute + 30,
                  Math.min(TOTAL_MINUTES, Math.round((endMs - dayRange.startMs) / 60_000)),
                );
                const topPx = (startMinute / 60) * DAY_TIMELINE_HOUR_HEIGHT;
                const minHeightPx = Math.max(
                  86,
                  ((endMinute - startMinute) / 60) * DAY_TIMELINE_HOUR_HEIGHT,
                );

                return (
                  <div
                    key={change.id}
                    data-testid={`day-proposal-block-${change.id}`}
                    style={{
                      top: `${topPx}px`,
                      minHeight: `${minHeightPx}px`,
                      left: '8px',
                      right: '8px',
                    }}
                    className="pointer-events-auto absolute z-[var(--z-timeline-header)]"
                  >
                    {renderProposalCard?.(change)}
                  </div>
                );
              })}
            </div>

            {/* Current Time Indicator Line */}
            {isTodaySelected && (
              <div
                data-testid="current-time-indicator"
                aria-label={`現在時間指示線 ${nowTimeLabel}`}
                style={{ top: `${nowTopPx}px` }}
                className="pointer-events-none absolute left-14 right-0 z-[var(--z-timeline-header)] flex -translate-y-1/2 items-center sm:left-16"
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[var(--color-now-indicator)] ring-2 ring-[var(--color-bg-surface)]" />
                <span className="h-[2px] flex-1 bg-[var(--color-now-indicator)] opacity-85" />
                <span className="mr-2 rounded bg-[var(--color-now-indicator)] px-1.5 py-0.5 font-[family-name:var(--font-mono)] text-[10px] font-bold tabular-nums text-white shadow-sm">
                  {nowTimeLabel}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
