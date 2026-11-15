import type { TagColorPreset } from '@/domain/schedule';

export interface TagColorMeta {
  value: TagColorPreset;
  label: string;
  swatchHex: string;
  chipClass: string;
  activeChipClass: string;
  dotClass: string;
}

export const TAG_COLOR_PRESETS: readonly TagColorMeta[] = [
  {
    value: 'indigo',
    label: '靛藍',
    swatchHex: '#4f46e5',
    chipClass:
      'border-indigo-300 bg-indigo-50 text-indigo-800 dark:border-indigo-400/50 dark:bg-indigo-500/20 dark:text-indigo-200',
    activeChipClass:
      'border-indigo-600 bg-indigo-600 text-white dark:border-indigo-400 dark:bg-indigo-500 dark:text-white',
    dotClass: 'bg-indigo-500',
  },
  {
    value: 'emerald',
    label: '翠綠',
    swatchHex: '#059669',
    chipClass:
      'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-400/50 dark:bg-emerald-500/20 dark:text-emerald-200',
    activeChipClass:
      'border-emerald-600 bg-emerald-600 text-white dark:border-emerald-400 dark:bg-emerald-500 dark:text-white',
    dotClass: 'bg-emerald-500',
  },
  {
    value: 'amber',
    label: '琥珀',
    swatchHex: '#d97706',
    chipClass:
      'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-400/50 dark:bg-amber-500/20 dark:text-amber-200',
    activeChipClass:
      'border-amber-600 bg-amber-600 text-white dark:border-amber-400 dark:bg-amber-500 dark:text-slate-950',
    dotClass: 'bg-amber-500',
  },
  {
    value: 'rose',
    label: '玫瑰',
    swatchHex: '#e11d48',
    chipClass:
      'border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-400/50 dark:bg-rose-500/20 dark:text-rose-200',
    activeChipClass:
      'border-rose-600 bg-rose-600 text-white dark:border-rose-400 dark:bg-rose-500 dark:text-white',
    dotClass: 'bg-rose-500',
  },
  {
    value: 'violet',
    label: '紫羅蘭',
    swatchHex: '#7c3aed',
    chipClass:
      'border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-400/50 dark:bg-violet-500/20 dark:text-violet-200',
    activeChipClass:
      'border-violet-600 bg-violet-600 text-white dark:border-violet-400 dark:bg-violet-500 dark:text-white',
    dotClass: 'bg-violet-500',
  },
  {
    value: 'cyan',
    label: '青藍',
    swatchHex: '#0891b2',
    chipClass:
      'border-cyan-300 bg-cyan-50 text-cyan-800 dark:border-cyan-400/50 dark:bg-cyan-500/20 dark:text-cyan-200',
    activeChipClass:
      'border-cyan-600 bg-cyan-600 text-white dark:border-cyan-400 dark:bg-cyan-500 dark:text-slate-950',
    dotClass: 'bg-cyan-500',
  },
  {
    value: 'orange',
    label: '暖橘',
    swatchHex: '#ea580c',
    chipClass:
      'border-orange-300 bg-orange-50 text-orange-800 dark:border-orange-400/50 dark:bg-orange-500/20 dark:text-orange-200',
    activeChipClass:
      'border-orange-600 bg-orange-600 text-white dark:border-orange-400 dark:bg-orange-500 dark:text-white',
    dotClass: 'bg-orange-500',
  },
  {
    value: 'slate',
    label: '青灰',
    swatchHex: '#475569',
    chipClass:
      'border-slate-300 bg-slate-100 text-slate-800 dark:border-slate-500/60 dark:bg-slate-600/30 dark:text-slate-200',
    activeChipClass:
      'border-slate-700 bg-slate-700 text-white dark:border-slate-400 dark:bg-slate-500 dark:text-white',
    dotClass: 'bg-slate-500',
  },
];

export function getTagColorMeta(color: TagColorPreset | undefined): TagColorMeta {
  return (
    TAG_COLOR_PRESETS.find((preset) => preset.value === color) ??
    TAG_COLOR_PRESETS[0]
  );
}
