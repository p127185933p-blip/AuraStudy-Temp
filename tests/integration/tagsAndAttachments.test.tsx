import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppShell, CalendarProvider } from '@/app';
import {
  createTag,
  deleteTag,
  updateTag,
} from '@/application/commands';
import { exportUserBackup, importUserBackup } from '@/application/services';
import { createDeadline, createSchedule } from '@/domain/schedule';
import {
  InMemoryCalendarRepository,
  InMemoryTagRepository,
} from '@/infrastructure/repositories';
import { TimelinePage } from '@/pages';

function renderTimelineWithTags(options?: {
  repository?: InMemoryCalendarRepository;
  tagRepository?: InMemoryTagRepository;
  initialDate?: string;
  initialViewMode?: 'month' | 'week' | 'day';
}) {
  const repository = options?.repository ?? new InMemoryCalendarRepository();
  const tagRepository = options?.tagRepository ?? new InMemoryTagRepository();
  return {
    repository,
    tagRepository,
    ...render(
      <CalendarProvider
        repository={repository}
        tagRepository={tagRepository}
        userId="test-student"
        timeZone="+08:00"
        initialDate={options?.initialDate ?? '2026-11-13'}
        initialViewMode={options?.initialViewMode ?? 'week'}
        seedDemoData={false}
      >
        <AppShell>
          <TimelinePage />
        </AppShell>
      </CalendarProvider>,
    ),
  };
}

describe('Tags Management, Timeline Filtering, Week Overflow & Item Attachments', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('supports Tag CRUD commands with item rename sync and safe item detachment on delete', async () => {
    const calendarRepo = new InMemoryCalendarRepository();
    const tagRepo = new InMemoryTagRepository();

    const dl = createDeadline(
      {
        userId: 'u1',
        title: '專題報告繳交',
        dueDate: '2026-11-20',
        tag: '專題',
      },
      { id: 'dl-1', now: '2026-11-13T08:00:00Z' },
    );
    const sc = createSchedule(
      {
        userId: 'u1',
        title: '專題進度討論',
        startAt: '2026-11-14T10:00:00+08:00',
        endAt: '2026-11-14T11:30:00+08:00',
        tag: '專題',
      },
      { id: 'sc-1', now: '2026-11-13T08:00:00Z' },
    );
    await calendarRepo.save(dl);
    await calendarRepo.save(sc);

    const created = await createTag(tagRepo, {
      userId: 'u1',
      name: '專題',
      color: 'indigo',
      id: 'tag-1',
      now: '2026-11-13T08:00:00Z',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // Duplicate tag name rejected
    const dup = await createTag(tagRepo, {
      userId: 'u1',
      name: '專題',
      color: 'emerald',
    });
    expect(dup.ok).toBe(false);

    // Renaming tag syncs across existing items and increments revision
    const updated = await updateTag(tagRepo, calendarRepo, {
      userId: 'u1',
      tagId: created.data.id,
      patch: { name: '畢業專題', color: 'violet' },
    });
    expect(updated.ok).toBe(true);
    const syncedDl = await calendarRepo.findById('dl-1');
    const syncedSc = await calendarRepo.findById('sc-1');
    expect(syncedDl?.tag).toBe('畢業專題');
    expect(syncedDl?.revision).toBe(2);
    expect(syncedSc?.tag).toBe('畢業專題');
    expect(syncedSc?.revision).toBe(2);

    // Deleting tag detaches tag from items without deleting the items themselves
    const deleted = await deleteTag(tagRepo, calendarRepo, {
      userId: 'u1',
      tagId: created.data.id,
    });
    expect(deleted.ok).toBe(true);
    if (!deleted.ok) return;
    expect(deleted.data.detachedCount).toBe(2);

    const detachedDl = await calendarRepo.findById('dl-1');
    const detachedSc = await calendarRepo.findById('sc-1');
    expect(detachedDl).not.toBeNull();
    expect(detachedDl?.tag).toBeUndefined();
    expect(detachedSc).not.toBeNull();
    expect(detachedSc?.tag).toBeUndefined();
  });

  it('applies overflow-hidden to WeekTimeline columns and filters items via TagManagerModal & header chips', async () => {
    const scCourse = createSchedule(
      {
        userId: 'test-student',
        title: '資料結構演習',
        startAt: '2026-11-13T09:00:00+08:00',
        endAt: '2026-11-13T10:30:00+08:00',
        tag: '課業',
      },
      { id: 'sc-course', now: '2026-11-13T00:00:00+08:00' },
    );
    const scLife = createSchedule(
      {
        userId: 'test-student',
        title: '健身房慢跑',
        startAt: '2026-11-13T17:00:00+08:00',
        endAt: '2026-11-13T18:00:00+08:00',
        tag: '生活',
      },
      { id: 'sc-life', now: '2026-11-13T00:00:00+08:00' },
    );

    renderTimelineWithTags({
      repository: new InMemoryCalendarRepository([scCourse, scLife]),
      initialDate: '2026-11-13',
      initialViewMode: 'week',
    });

    await screen.findByTestId('week-timeline');
    const weekCol = screen.getByTestId('week-column-2026-11-13');
    expect(weekCol.className).toContain('overflow-hidden');

    // Default seeded tags appear in filter bar
    const filterBar = await screen.findByTestId('tag-filter-bar');
    expect(within(filterBar).getByRole('button', { name: '課業' })).toBeInTheDocument();
    expect(within(filterBar).getByRole('button', { name: '生活' })).toBeInTheDocument();

    // Filter by '課業' -> hides '健身房慢跑'
    fireEvent.click(within(filterBar).getByRole('button', { name: '課業' }));
    expect(screen.getByText('資料結構演習')).toBeInTheDocument();
    expect(screen.queryByText('健身房慢跑')).not.toBeInTheDocument();

    // Reset filter via '全部'
    fireEvent.click(within(filterBar).getByRole('button', { name: '全部' }));
    expect(screen.getByText('健身房慢跑')).toBeInTheDocument();

    // Open TagManagerModal -> create a custom tag '社團', then close
    fireEvent.click(screen.getByRole('button', { name: '標籤管理' }));
    const tagModal = await screen.findByTestId('tag-manager-modal');
    fireEvent.change(within(tagModal).getByLabelText('新增標籤'), {
      target: { value: '社團' },
    });
    fireEvent.click(within(tagModal).getByRole('radio', { name: '顏色：玫瑰' }));
    fireEvent.click(within(tagModal).getByRole('button', { name: '新增標籤' }));

    await waitFor(() => {
      expect(within(tagModal).getByTestId('tag-manager-feedback')).toHaveTextContent(
        '已新增標籤「社團」',
      );
    });

    fireEvent.click(within(tagModal).getByRole('button', { name: '關閉標籤管理視窗' }));
    await waitFor(() => {
      expect(screen.queryByTestId('tag-manager-modal')).not.toBeInTheDocument();
    });

    // Newly created tag shows up in TimelineHeader filter bar
    expect(
      within(screen.getByTestId('tag-filter-bar')).getByRole('button', { name: '社團' }),
    ).toBeInTheDocument();
  });

  it('supports quick tag creation and uploading/previewing/removing item attachments inside ItemEditorModal', async () => {
    renderTimelineWithTags({
      initialDate: '2026-11-13',
      initialViewMode: 'day',
    });

    await screen.findByTestId('day-timeline');
    fireEvent.click(screen.getByRole('button', { name: '新增' }));
    const editor = await screen.findByRole('dialog');

    // Quick create tag inside editor and auto-select it
    fireEvent.click(within(editor).getByRole('button', { name: '+ 快速新增標籤' }));
    const quickForm = within(editor).getByTestId('quick-create-tag-form');
    fireEvent.change(within(quickForm).getByLabelText('新標籤名稱'), {
      target: { value: '實驗' },
    });
    fireEvent.click(within(quickForm).getByRole('button', { name: '建立並套用' }));

    await waitFor(() => {
      const chip = within(editor).getByRole('button', { name: '實驗' });
      expect(chip).toHaveAttribute('aria-pressed', 'true');
    });

    // Fill schedule details
    fireEvent.change(within(editor).getByLabelText('標題'), {
      target: { value: '物理實驗預習' },
    });
    fireEvent.change(within(editor).getByLabelText('開始時間'), {
      target: { value: '10:00' },
    });
    fireEvent.change(within(editor).getByLabelText('結束時間'), {
      target: { value: '11:30' },
    });

    // Upload 1 PNG image + 1 PDF document
    const fileInput = within(editor).getByTestId('item-attachment-input');
    const pngFile = new File([new Uint8Array([137, 80, 78, 71])], 'diagram.png', {
      type: 'image/png',
    });
    const pdfFile = new File([new Uint8Array([37, 80, 68, 70])], 'handout.pdf', {
      type: 'application/pdf',
    });
    fireEvent.change(fileInput, { target: { files: [pngFile, pdfFile] } });

    await waitFor(() => {
      expect(within(editor).getByText('diagram.png')).toBeInTheDocument();
      expect(within(editor).getByText('handout.pdf')).toBeInTheDocument();
    });

    // Reject oversized (>3MB) file cleanly
    const hugeFile = new File(['x'], 'huge.pdf', { type: 'application/pdf' });
    Object.defineProperty(hugeFile, 'size', { value: 4 * 1024 * 1024 });
    fireEvent.change(fileInput, { target: { files: [hugeFile] } });
    await waitFor(() => {
      expect(within(editor).getByTestId('item-attachment-error')).toHaveTextContent(
        '超過 3MB 上限',
      );
    });

    // Click image thumbnail to open Lightbox, then close it
    fireEvent.click(within(editor).getByRole('button', { name: '放大檢視 diagram.png' }));
    const lightbox = await screen.findByTestId('attachment-lightbox');
    expect(within(lightbox).getByText('diagram.png')).toBeInTheDocument();
    fireEvent.click(within(lightbox).getByRole('button', { name: '關閉圖片預覽' }));
    await waitFor(() => {
      expect(screen.queryByTestId('attachment-lightbox')).not.toBeInTheDocument();
    });

    // Save item -> card displays paperclip badge with count 2
    fireEvent.click(within(editor).getByRole('button', { name: '建立項目' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    expect(screen.getByText('物理實驗預習')).toBeInTheDocument();
    const badge = screen.getByLabelText('含 2 個附件');
    expect(badge).toHaveTextContent('2');

    // Reopen item, remove one attachment, save -> badge updates to 1
    fireEvent.click(screen.getByText('物理實驗預習'));
    const editDialog = await screen.findByRole('dialog');
    fireEvent.click(
      within(editDialog).getByRole('button', { name: '移除附件 handout.pdf' }),
    );
    fireEvent.click(within(editDialog).getByRole('button', { name: '儲存變更' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(screen.getByLabelText('含 1 個附件')).toHaveTextContent('1');
  });

  it('preserves tags and item attachments through JSON backup round-trip and supports legacy backups', async () => {
    const sourceCalendarRepo = new InMemoryCalendarRepository();
    const sourceTagRepo = new InMemoryTagRepository();

    await createTag(sourceTagRepo, {
      userId: 'u-src',
      name: '物理',
      color: 'cyan',
      id: 'tag-phys',
      now: '2026-11-13T08:00:00Z',
    });

    const itemWithAttachment = createDeadline(
      {
        userId: 'u-src',
        title: '實驗預報',
        dueDate: '2026-11-25',
        tag: '物理',
        attachments: [
          {
            id: 'att-1',
            name: 'notes.txt',
            mimeType: 'text/plain',
            size: 128,
            dataUrl: 'data:text/plain;base64,SGVsbG8=',
            createdAt: '2026-11-13T09:00:00.000Z',
          },
        ],
      },
      { id: 'dl-att', now: '2026-11-13T09:00:00Z' },
    );
    await sourceCalendarRepo.save(itemWithAttachment);

    const backup = await exportUserBackup(
      sourceCalendarRepo,
      'u-src',
      undefined,
      sourceTagRepo,
    );
    expect(backup.tags).toHaveLength(1);
    expect(backup.items[0].attachments).toHaveLength(1);

    // Import into fresh repositories under a different userId
    const targetCalendarRepo = new InMemoryCalendarRepository();
    const targetTagRepo = new InMemoryTagRepository();
    const importRes = await importUserBackup(
      targetCalendarRepo,
      'u-dest',
      JSON.stringify(backup),
      undefined,
      targetTagRepo,
    );
    expect(importRes.ok).toBe(true);
    if (!importRes.ok) return;
    expect(importRes.data.importedCount).toBe(1);
    expect(importRes.data.tagsCount).toBe(1);

    const restoredItems = await targetCalendarRepo.listByUser('u-dest');
    const restoredTags = await targetTagRepo.listByUser('u-dest');
    expect(restoredItems[0].attachments).toHaveLength(1);
    expect(restoredItems[0].attachments?.[0].name).toBe('notes.txt');
    expect(restoredTags[0].name).toBe('物理');
    expect(restoredTags[0].color).toBe('cyan');

    // Backward-compatibility check: legacy backup without tags or attachments fields
    const legacyBackupJson = JSON.stringify({
      version: 1,
      exportedAt: '2026-11-01T00:00:00.000Z',
      items: [
        {
          id: 'legacy-1',
          userId: 'old-user',
          type: 'deadline',
          title: '舊版備份作業',
          dueDate: '2026-11-30',
          revision: 1,
          createdAt: '2026-11-01T00:00:00.000Z',
          updatedAt: '2026-11-01T00:00:00.000Z',
        },
      ],
    });

    const legacyImportRes = await importUserBackup(
      targetCalendarRepo,
      'u-dest',
      legacyBackupJson,
      undefined,
      targetTagRepo,
    );
    expect(legacyImportRes.ok).toBe(true);
    const itemsAfterLegacy = await targetCalendarRepo.listByUser('u-dest');
    expect(itemsAfterLegacy.some((i) => i.title === '舊版備份作業')).toBe(true);
  });
});
