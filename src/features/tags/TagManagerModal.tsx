import { useEffect, useState, type FormEvent } from 'react';
import { Check, Pencil, Plus, Tag, Trash2, X } from 'lucide-react';
import {
  LiquidButton,
  SpatialMorphModal,
  type LaunchOrigin,
} from '@/components/ui/LiquidGlass';
import type { ApplicationResult } from '@/application/services';
import type {
  CalendarTag,
  TagColorPreset,
  UpdateTagPatch,
} from '@/domain/schedule';
import { TAG_COLOR_PRESETS, getTagColorMeta } from '@/shared/utils';

export interface TagManagerModalProps {
  isOpen: boolean;
  launchOrigin?: LaunchOrigin | null;
  onClose: () => void;
  tags: readonly CalendarTag[];
  onCreateTag: (input: {
    name: string;
    color: TagColorPreset;
  }) => Promise<ApplicationResult<CalendarTag>>;
  onUpdateTag: (input: {
    tagId: string;
    patch: UpdateTagPatch;
  }) => Promise<ApplicationResult<CalendarTag>>;
  onDeleteTag: (
    tagId: string,
  ) => Promise<ApplicationResult<{ deletedId: string; detachedCount: number }>>;
}

export function TagManagerModal({
  isOpen,
  launchOrigin,
  onClose,
  tags,
  onCreateTag,
  onUpdateTag,
  onDeleteTag,
}: TagManagerModalProps) {
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState<TagColorPreset>('indigo');
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [editingColor, setEditingColor] = useState<TagColorPreset>('indigo');
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setFeedback(null);
    setEditingTagId(null);
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  async function handleCreateSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = newTagName.trim();
    if (!trimmed) {
      setFeedback({ type: 'error', text: '請輸入標籤名稱' });
      return;
    }

    setIsBusy(true);
    setFeedback(null);
    try {
      const res = await onCreateTag({ name: trimmed, color: newTagColor });
      if (res.ok) {
        setNewTagName('');
        setFeedback({ type: 'success', text: `已新增標籤「${res.data.name}」` });
      } else {
        setFeedback({ type: 'error', text: res.error.message });
      }
    } finally {
      setIsBusy(false);
    }
  }

  function startEditing(tag: CalendarTag) {
    setEditingTagId(tag.id);
    setEditingName(tag.name);
    setEditingColor(tag.color);
    setFeedback(null);
  }

  async function handleSaveEdit(tagId: string) {
    const trimmed = editingName.trim();
    if (!trimmed) {
      setFeedback({ type: 'error', text: '標籤名稱不可為空' });
      return;
    }

    setIsBusy(true);
    setFeedback(null);
    try {
      const res = await onUpdateTag({
        tagId,
        patch: { name: trimmed, color: editingColor },
      });
      if (res.ok) {
        setEditingTagId(null);
        setFeedback({ type: 'success', text: `已更新標籤「${res.data.name}」` });
      } else {
        setFeedback({ type: 'error', text: res.error.message });
      }
    } finally {
      setIsBusy(false);
    }
  }

  async function handleDelete(tag: CalendarTag) {
    setIsBusy(true);
    setFeedback(null);
    try {
      const res = await onDeleteTag(tag.id);
      if (res.ok) {
        if (editingTagId === tag.id) {
          setEditingTagId(null);
        }
        setFeedback({
          type: 'success',
          text:
            res.data.detachedCount > 0
              ? `已刪除標籤「${tag.name}」，並安全解除 ${res.data.detachedCount} 筆行程關聯。`
              : `已刪除標籤「${tag.name}」。`,
        });
      } else {
        setFeedback({ type: 'error', text: res.error.message });
      }
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <SpatialMorphModal
      isOpen={isOpen}
      onClose={onClose}
      origin={launchOrigin}
      ariaLabelledBy="tag-manager-title"
      dataTestId="tag-manager-modal"
      panelClassName="sm:max-w-lg"
    >
            {/* Header */}
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--color-border-subtle)] px-4 py-3.5 sm:px-6 sm:pt-5">
              <div className="flex items-center gap-2 min-w-0">
                <Tag
                  className="h-5 w-5 shrink-0 text-[var(--color-accent-primary)]"
                  aria-hidden="true"
                />
                <div>
                  <h2
                    id="tag-manager-title"
                    className="text-[length:var(--text-xl)] font-bold text-[var(--color-text-primary)]"
                  >
                    標籤管理
                  </h2>
                  <p className="text-[length:var(--text-xs)] text-[var(--color-text-secondary)]">
                    自訂學習分類顏色，刪除標籤僅解除關聯不會刪除行程
                  </p>
                </div>
              </div>
              <LiquidButton
                onClick={onClose}
                aria-label="關閉標籤管理視窗"
                className="modal-inner-surface flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-[var(--radius-md)] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)]"
              >
                <X className="relative z-10 h-5 w-5" aria-hidden="true" />
              </LiquidButton>
            </div>

            <div className="flex-1 overflow-y-auto overscroll-contain px-4 pb-5 sm:px-6 sm:pb-6">

            {/* Create new tag form */}
            <form
              onSubmit={handleCreateSubmit}
              className="modal-inner-surface mt-4 space-y-3 rounded-[var(--radius-md)] p-3.5"
            >
              <label
                htmlFor="new-tag-name-input"
                className="block text-[length:var(--text-sm)] font-bold text-[var(--color-text-primary)]"
              >
                新增標籤
              </label>
              <div className="flex flex-col gap-2.5 sm:flex-row">
                <input
                  id="new-tag-name-input"
                  type="text"
                  value={newTagName}
                  onChange={(e) => setNewTagName(e.target.value)}
                  placeholder="輸入標籤名稱（例如：數學、社團）"
                  className="min-h-[44px] flex-1 rounded-[var(--radius-sm)] border border-[var(--color-border-strong)] bg-[var(--color-bg-surface)] px-3 text-[length:var(--text-sm)] text-[var(--color-text-primary)] focus:border-[var(--color-accent-primary)] focus:outline-none"
                />
                <LiquidButton
                  type="submit"
                  disabled={isBusy}
                  className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-accent-primary)] px-4 text-[length:var(--text-sm)] font-bold text-[var(--color-text-inverse)] hover:bg-[var(--color-accent-primary-hover)] disabled:opacity-50 whitespace-nowrap"
                >
                  <Plus className="relative z-10 h-4 w-4" aria-hidden="true" />
                  <span className="relative z-10">新增標籤</span>
                </LiquidButton>
              </div>

          <div
            role="radiogroup"
            aria-label="選擇新標籤顏色"
            className="flex flex-wrap items-center gap-2"
          >
            {TAG_COLOR_PRESETS.map((preset) => {
              const selected = newTagColor === preset.value;
              return (
                <button
                  key={preset.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={`顏色：${preset.label}`}
                  onClick={() => setNewTagColor(preset.value)}
                  className={`flex h-8 w-8 items-center justify-center rounded-full border-2 transition-transform ${
                    selected
                      ? 'scale-110 border-[var(--color-text-primary)] ring-2 ring-[var(--color-accent-primary)]/40'
                      : 'border-transparent hover:scale-105'
                  }`}
                  style={{ backgroundColor: preset.swatchHex }}
                  title={preset.label}
                >
                  {selected && <Check className="h-4 w-4 text-white" aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        </form>

        {feedback && (
          <p
            data-testid="tag-manager-feedback"
            role="status"
            className={`mt-3 rounded-[var(--radius-sm)] px-3 py-2 text-[length:var(--text-xs)] font-semibold ${
              feedback.type === 'error'
                ? 'bg-[var(--color-proposal-delete-bg)] text-[var(--color-proposal-delete-text)]'
                : 'bg-[var(--color-proposal-create-bg)] text-[var(--color-proposal-create-text)]'
            }`}
          >
            {feedback.text}
          </p>
        )}

        {/* Existing Tags List */}
        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-[length:var(--text-sm)] font-bold text-[var(--color-text-primary)]">
              已建立的標籤（{tags.length}）
            </h3>
          </div>

          {tags.length === 0 ? (
            <p className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border-strong)] py-6 text-center text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
              尚未建立任何標籤，請於上方輸入名稱新增。
            </p>
          ) : (
            <ul className="space-y-2">
              {tags.map((tag) => {
                const isEditing = editingTagId === tag.id;
                const colorMeta = getTagColorMeta(tag.color);

                return (
                  <li
                    key={tag.id}
                    data-testid={`tag-manager-row-${tag.id}`}
                    className="modal-inner-surface rounded-[var(--radius-md)] p-3"
                  >
                    {isEditing ? (
                      <div className="space-y-2.5">
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            aria-label="編輯標籤名稱"
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            className="min-h-[40px] flex-1 rounded-[var(--radius-sm)] border border-[var(--color-border-strong)] bg-[var(--color-bg-surface)] px-3 text-[length:var(--text-sm)] text-[var(--color-text-primary)] focus:border-[var(--color-accent-primary)] focus:outline-none"
                          />
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void handleSaveEdit(tag.id)}
                            className="min-h-[40px] rounded-[var(--radius-sm)] bg-[var(--color-accent-primary)] px-3 text-[length:var(--text-xs)] font-bold text-[var(--color-text-inverse)]"
                          >
                            儲存
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingTagId(null)}
                            className="min-h-[40px] rounded-[var(--radius-sm)] border border-[var(--color-border-strong)] px-3 text-[length:var(--text-xs)] font-semibold text-[var(--color-text-secondary)]"
                          >
                            取消
                          </button>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {TAG_COLOR_PRESETS.map((preset) => {
                            const selected = editingColor === preset.value;
                            return (
                              <button
                                key={preset.value}
                                type="button"
                                aria-label={`編輯顏色：${preset.label}`}
                                onClick={() => setEditingColor(preset.value)}
                                className={`flex h-7 w-7 items-center justify-center rounded-full border-2 ${
                                  selected
                                    ? 'border-[var(--color-text-primary)] scale-110'
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
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span
                            className="h-3.5 w-3.5 shrink-0 rounded-full"
                            style={{ backgroundColor: colorMeta.swatchHex }}
                            aria-hidden="true"
                          />
                          <span className="truncate text-[length:var(--text-sm)] font-bold text-[var(--color-text-primary)]">
                            {tag.name}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => startEditing(tag)}
                            aria-label={`編輯標籤 ${tag.name}`}
                            className="flex min-h-[38px] min-w-[38px] items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
                          >
                            <Pencil className="h-4 w-4" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void handleDelete(tag)}
                            aria-label={`刪除標籤 ${tag.name}`}
                            className="flex min-h-[38px] min-w-[38px] items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-proposal-delete-border)] bg-[var(--color-proposal-delete-bg)] text-[var(--color-proposal-delete-text)] hover:opacity-90 disabled:opacity-50"
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
            </div>
    </SpatialMorphModal>
  );
}
