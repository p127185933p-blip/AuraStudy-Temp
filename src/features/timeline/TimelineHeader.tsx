import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, Plus, Settings, Tag } from 'lucide-react';
import {
  LiquidButton,
  LiquidSurface,
  captureOriginRect,
  type LaunchOrigin,
} from '@/components/ui/LiquidGlass';
import type { DateRangeMode } from '@/domain/planning';
import type { CalendarTag } from '@/domain/schedule';
import { formatRangeTitle, getTagColorMeta } from '@/shared/utils';
import { LIQUID_SPRING_DEFAULT } from '@/styles/motion';

export interface TimelineHeaderProps {
  selectedDate: string;
  viewMode: DateRangeMode;
  onChangeViewMode: (mode: DateRangeMode) => void;
  onNavigatePrev: () => void;
  onNavigateNext: () => void;
  onNavigateToday: () => void;
  onRequestCreate: (origin?: LaunchOrigin) => void;
  onOpenSettings?: (origin?: LaunchOrigin) => void;
  onOpenTagManager?: (origin?: LaunchOrigin) => void;
  tags?: readonly CalendarTag[];
  selectedTagFilter?: string | null;
  onSelectTagFilter?: (tagName: string | null) => void;
}

const VIEW_MODES: readonly { value: DateRangeMode; label: string }[] = [
  { value: 'month', label: '月' },
  { value: 'week', label: '週' },
  { value: 'day', label: '日' },
];

export function TimelineHeader({
  selectedDate,
  viewMode,
  onChangeViewMode,
  onNavigatePrev,
  onNavigateNext,
  onNavigateToday,
  onRequestCreate,
  onOpenSettings,
  onOpenTagManager,
  tags = [],
  selectedTagFilter = null,
  onSelectTagFilter,
}: TimelineHeaderProps) {
  const rangeTitle = formatRangeTitle(viewMode, selectedDate);
  const showFilterBar = Boolean(onSelectTagFilter && (tags.length > 0 || selectedTagFilter));

  return (
    <LiquidSurface
      layer={2}
      sheen={true}
      className="flex flex-col gap-3 rounded-[var(--radius-lg)] p-3.5 sm:p-4"
      aria-label="時間軸導航控制"
    >
      <div className="relative z-10 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* Left: Range title + Prev / Today / Next */}
        <div className="flex flex-wrap items-center justify-between gap-2 sm:justify-start sm:gap-3">
          <div className="flex items-center gap-1.5">
            <LiquidButton
              glassLayer={1}
              onClick={onNavigatePrev}
              aria-label="上一段"
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] sm:min-h-[40px] sm:min-w-[40px]"
            >
              <ChevronLeft className="relative z-10 h-5 w-5" aria-hidden="true" />
            </LiquidButton>

            <LiquidButton
              glassLayer={1}
              onClick={onNavigateToday}
              className="min-h-[44px] rounded-[var(--radius-sm)] px-3.5 text-[length:var(--text-sm)] font-bold text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] whitespace-nowrap shrink-0 sm:min-h-[40px]"
            >
              <span className="relative z-10">今天</span>
            </LiquidButton>

            <LiquidButton
              glassLayer={1}
              onClick={onNavigateNext}
              aria-label="下一段"
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] sm:min-h-[40px] sm:min-w-[40px]"
            >
              <ChevronRight className="relative z-10 h-5 w-5" aria-hidden="true" />
            </LiquidButton>
          </div>

          <h1
            data-testid="timeline-range-title"
            className="text-[length:var(--text-lg)] font-bold tracking-tight text-[var(--color-text-primary)] tabular-nums sm:text-[length:var(--text-xl)]"
          >
            {rangeTitle}
          </h1>
        </div>

        {/* Right: Liquid-Pill Segmented View Switcher + Create CTA + Tag Manager + Settings */}
        <div className="flex flex-wrap items-center justify-between gap-2 sm:justify-end sm:gap-2.5">
          <div
            role="group"
            aria-label="切換時間軸視圖"
            className="glass-layer-1 relative grid grid-cols-3 gap-1 rounded-[var(--radius-md)] p-1"
          >
            {VIEW_MODES.map((mode) => {
              const isActive = viewMode === mode.value;
              return (
                <LiquidButton
                  key={mode.value}
                  aria-pressed={isActive}
                  squish
                  onClick={() => onChangeViewMode(mode.value)}
                  className={`relative min-h-[40px] min-w-[48px] rounded-[var(--radius-sm)] px-3 text-[length:var(--text-sm)] font-bold transition-colors whitespace-nowrap shrink-0 ${
                    isActive
                      ? 'text-[var(--color-accent-primary)]'
                      : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
                  }`}
                >
                  {isActive && (
                    <motion.span
                      layoutId="active-view-pill"
                      transition={LIQUID_SPRING_DEFAULT}
                      aria-hidden="true"
                      className="glass-layer-2 absolute inset-0 rounded-[var(--radius-sm)] border border-[var(--color-accent-primary-border)]"
                    />
                  )}
                  <span className="relative z-10">{mode.label}</span>
                </LiquidButton>
              );
            })}
          </div>

          <div className="flex items-center gap-2">
            <LiquidButton
              onClick={(e) => onRequestCreate(captureOriginRect(e.currentTarget) ?? undefined)}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-accent-primary)] bg-[var(--color-accent-primary)] px-4 text-[length:var(--text-sm)] font-bold text-[var(--color-text-inverse)] shadow-[var(--shadow-card)] hover:bg-[var(--color-accent-primary-hover)] whitespace-nowrap shrink-0 sm:min-h-[42px]"
            >
              <Plus className="relative z-10 h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="relative z-10">新增</span>
            </LiquidButton>

            {onOpenTagManager && (
              <LiquidButton
                glassLayer={1}
                onClick={(e) =>
                  onOpenTagManager(captureOriginRect(e.currentTarget) ?? undefined)
                }
                aria-label="標籤管理"
                title="標籤管理"
                className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-[var(--radius-md)] px-3 text-[length:var(--text-sm)] font-bold text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] sm:min-h-[42px]"
              >
                <Tag className="relative z-10 h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="relative z-10 hidden sm:inline">標籤管理</span>
              </LiquidButton>
            )}

            {onOpenSettings && (
              <LiquidButton
                glassLayer={1}
                onClick={(e) =>
                  onOpenSettings(captureOriginRect(e.currentTarget) ?? undefined)
                }
                aria-label="開啟設定"
                title="設定（帳號、AI 服務與隱私）"
                className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-[var(--radius-md)] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] sm:min-h-[42px] sm:min-w-[42px]"
              >
                <Settings className="relative z-10 h-4 w-4" aria-hidden="true" />
              </LiquidButton>
            )}
          </div>
        </div>
      </div>

      {/* Horizontal Tag Quick Filter Glass Track */}
      <AnimatePresence initial={false}>
        {showFilterBar && onSelectTagFilter && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={LIQUID_SPRING_DEFAULT}
            data-testid="tag-filter-bar"
            role="group"
            aria-label="依標籤篩選行程"
            className="relative z-10 flex items-center gap-2 overflow-x-auto border-t border-[var(--color-border-subtle)] pt-2.5"
          >
            <LiquidButton
              squish
              aria-pressed={selectedTagFilter === null}
              onClick={() => onSelectTagFilter(null)}
              className={`relative min-h-[34px] shrink-0 rounded-full border px-3 text-[length:var(--text-xs)] font-bold transition-colors whitespace-nowrap ${
                selectedTagFilter === null
                  ? 'border-[var(--color-accent-primary)] bg-[var(--color-accent-primary)] text-[var(--color-text-inverse)] shadow-sm'
                  : 'glass-layer-1 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              <span className="relative z-10">全部</span>
            </LiquidButton>
            {tags.map((tag) => {
              const isActive = selectedTagFilter === tag.name;
              const colorMeta = getTagColorMeta(tag.color);
              return (
                <LiquidButton
                  key={tag.id}
                  squish
                  aria-pressed={isActive}
                  onClick={() => onSelectTagFilter(isActive ? null : tag.name)}
                  className={`relative inline-flex min-h-[34px] shrink-0 items-center gap-1.5 rounded-full border px-3 text-[length:var(--text-xs)] font-bold transition-colors whitespace-nowrap ${
                    isActive
                      ? `${colorMeta.activeChipClass} shadow-sm`
                      : 'glass-layer-1 text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)]'
                  }`}
                >
                  <span
                    className="relative z-10 h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{
                      backgroundColor: isActive ? '#ffffff' : colorMeta.swatchHex,
                    }}
                    aria-hidden="true"
                  />
                  <span className="relative z-10">{tag.name}</span>
                </LiquidButton>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </LiquidSurface>
  );
}
