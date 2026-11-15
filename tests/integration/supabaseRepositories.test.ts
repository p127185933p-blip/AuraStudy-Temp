import { describe, expect, it } from 'vitest';
import {
  createDeadline,
  createSchedule,
  createTag,
  deleteCalendarItem,
  updateCalendarItem,
} from '@/application/commands';
import {
  RepositoryRevisionConflictError,
  SupabaseCalendarRepository,
  SupabaseDecisionLogRepository,
  SupabaseProposalRepository,
  SupabaseTagRepository,
  type SupabaseFilterBuilder,
  type SupabaseLikeClient,
  type SupabaseQueryResult,
} from '@/infrastructure/repositories';

interface TableStore {
  calendar_items: Record<string, unknown>[];
  proposal_changes: Record<string, unknown>[];
  decision_logs: Record<string, unknown>[];
  user_tags: Record<string, unknown>[];
}

function createMockSupabaseClient(options?: {
  simulateMissingAttachmentsColumn?: boolean;
  simulateMissingTagsTable?: boolean;
}): SupabaseLikeClient & { store: TableStore } {
  const store: TableStore = {
    calendar_items: [],
    proposal_changes: [],
    decision_logs: [],
    user_tags: [],
  };

  function makeBuilder(
    table: keyof TableStore,
    mode: 'select' | 'insert' | 'upsert' | 'update' | 'delete',
    payload?: Record<string, unknown> | Record<string, unknown>[],
  ): SupabaseFilterBuilder<Record<string, unknown>> {
    const filters: Array<{ col: string; val: unknown }> = [];
    let orderCol: string | null = null;
    let orderAsc = true;
    let limitCount: number | null = null;

    const execute = async (): Promise<
      SupabaseQueryResult<Record<string, unknown>[]>
    > => {
      if (table === 'user_tags' && options?.simulateMissingTagsTable) {
        return {
          data: null,
          error: {
            code: '42P01',
            message: 'relation "public.user_tags" does not exist',
          },
        };
      }

      if (
        table === 'calendar_items' &&
        options?.simulateMissingAttachmentsColumn &&
        (mode === 'insert' || mode === 'update')
      ) {
        const items = Array.isArray(payload) ? payload : [payload!];
        if (items.some((row) => 'attachments' in row)) {
          return {
            data: null,
            error: {
              code: 'PGRST204',
              message:
                "Could not find the 'attachments' column of 'calendar_items' in the schema cache",
            },
          };
        }
      }

      const rows = store[table];

      if (mode === 'insert') {
        const toInsert = Array.isArray(payload) ? payload : [payload!];
        for (const row of toInsert) {
          rows.push({ ...row });
        }
        return { data: toInsert.map((r) => ({ ...r })), error: null };
      }

      if (mode === 'upsert') {
        const toUpsert = Array.isArray(payload) ? payload : [payload!];
        const saved: Record<string, unknown>[] = [];
        for (const row of toUpsert) {
          const idx = rows.findIndex((r) => r.id === row.id);
          if (idx >= 0) {
            rows[idx] = { ...row };
          } else {
            rows.push({ ...row });
          }
          saved.push({ ...row });
        }
        return { data: saved, error: null };
      }

      const matches = (row: Record<string, unknown>) =>
        filters.every((f) => row[f.col] === f.val);

      if (mode === 'update') {
        const updated: Record<string, unknown>[] = [];
        for (let i = 0; i < rows.length; i += 1) {
          if (matches(rows[i])) {
            rows[i] = { ...rows[i], ...(payload as Record<string, unknown>) };
            updated.push({ ...rows[i] });
          }
        }
        return { data: updated, error: null };
      }

      if (mode === 'delete') {
        const deleted: Record<string, unknown>[] = [];
        for (let i = rows.length - 1; i >= 0; i -= 1) {
          if (matches(rows[i])) {
            deleted.push({ ...rows[i] });
            rows.splice(i, 1);
          }
        }
        return { data: deleted, error: null };
      }

      let result = rows.filter(matches).map((r) => ({ ...r }));
      if (orderCol) {
        result.sort((a, b) => {
          const av = String(a[orderCol!] ?? '');
          const bv = String(b[orderCol!] ?? '');
          return orderAsc ? av.localeCompare(bv) : bv.localeCompare(av);
        });
      }
      if (limitCount !== null) {
        result = result.slice(0, limitCount);
      }
      return { data: result, error: null };
    };

    const builder: SupabaseFilterBuilder<Record<string, unknown>> = {
      eq(column, value) {
        filters.push({ col: column, val: value });
        return builder;
      },
      order(column, options) {
        orderCol = column;
        orderAsc = options?.ascending ?? true;
        return builder;
      },
      limit(count) {
        limitCount = count;
        return builder;
      },
      select() {
        return builder;
      },
      async single() {
        const res = await execute();
        if (res.error) return { data: null, error: res.error };
        const first = res.data?.[0] ?? null;
        if (!first) {
          return {
            data: null,
            error: { message: 'Row not found' },
          };
        }
        return { data: first, error: null };
      },
      async maybeSingle() {
        const res = await execute();
        if (res.error) return { data: null, error: res.error };
        return {
          data: res.data?.[0] ?? null,
          error: null,
        };
      },
      then(onfulfilled, onrejected) {
        return execute().then(onfulfilled, onrejected);
      },
    };

    return builder;
  }

  return {
    store,
    from(table) {
      const key = table as keyof TableStore;
      return {
        select: () => makeBuilder(key, 'select'),
        insert: (values) => makeBuilder(key, 'insert', values),
        upsert: (values) => makeBuilder(key, 'upsert', values),
        update: (values) => makeBuilder(key, 'update', values),
        delete: () => makeBuilder(key, 'delete'),
      };
    },
  };
}

describe('Phase 4 Supabase Repositories (mocked client)', () => {
  it('performs Deadline & Schedule CRUD, user isolation, and optimistic locking', async () => {
    const mockClient = createMockSupabaseClient();
    const repo = new SupabaseCalendarRepository(mockClient);

    const dlRes = await createDeadline(repo, {
      userId: 'user-a',
      title: '資結作業 4',
      dueDate: '2026-11-20',
      now: '2026-11-13T10:00:00Z',
    });
    expect(dlRes.ok).toBe(true);
    if (!dlRes.ok) return;

    // Verify DB row strictly sets due_date and keeps start_at/end_at null
    expect(mockClient.store.calendar_items[0]).toMatchObject({
      type: 'deadline',
      due_date: '2026-11-20',
      start_at: null,
      end_at: null,
      revision: 1,
    });

    const schedRes = await createSchedule(repo, {
      userId: 'user-a',
      title: '作業系統複習',
      startAt: '2026-11-14T09:00:00+08:00',
      endAt: '2026-11-14T11:00:00+08:00',
      now: '2026-11-13T10:05:00Z',
    });
    expect(schedRes.ok).toBe(true);
    if (!schedRes.ok) return;

    await createDeadline(repo, {
      userId: 'user-b',
      title: 'User B 私人截止項',
      dueDate: '2026-11-21',
    });

    const userAItems = await repo.listByUser('user-a');
    expect(userAItems).toHaveLength(2);
    const userBItems = await repo.listByUser('user-b');
    expect(userBItems).toHaveLength(1);

    // Update Schedule revision 1 -> 2
    const updateRes = await updateCalendarItem(repo, {
      userId: 'user-a',
      itemId: schedRes.data.id,
      expectedRevision: 1,
      patch: { title: '作業系統複習（更新）' },
      now: '2026-11-13T10:10:00Z',
    });
    expect(updateRes.ok).toBe(true);
    if (!updateRes.ok) return;
    expect(updateRes.data.revision).toBe(2);

    // Direct repository save with stale revision (trying revision 2 when DB already has 2) must throw optimistic lock error
    await expect(
      repo.save({
        ...updateRes.data,
        title: '過期寫入',
        revision: 2,
      }),
    ).rejects.toThrow(RepositoryRevisionConflictError);

    // Delete item cleanly
    const delRes = await deleteCalendarItem(repo, {
      userId: 'user-a',
      itemId: dlRes.data.id,
      expectedRevision: 1,
    });
    expect(delRes.ok).toBe(true);
    expect(await repo.findById(dlRes.data.id)).toBeNull();
  });

  it('persists proposals and decision logs via Supabase repositories', async () => {
    const mockClient = createMockSupabaseClient();
    const proposalRepo = new SupabaseProposalRepository(mockClient, 'user-a');
    const logRepo = new SupabaseDecisionLogRepository(mockClient, 'user-a');

    await proposalRepo.save({
      id: 'chg-1',
      proposalId: 'prop-1',
      action: 'create',
      status: 'pending',
      after: {
        id: 'dl-prop-1',
        userId: 'user-a',
        type: 'deadline',
        title: 'AI 建議作業',
        dueDate: '2026-11-18',
        revision: 1,
        createdAt: '2026-11-13T10:00:00Z',
        updatedAt: '2026-11-13T10:00:00Z',
      },
      reason: '新增建議',
      createdAt: '2026-11-13T10:00:00Z',
      updatedAt: '2026-11-13T10:00:00Z',
    });

    const loaded = await proposalRepo.findById('chg-1');
    expect(loaded?.id).toBe('chg-1');
    expect(await proposalRepo.listByProposalId('prop-1')).toHaveLength(1);

    await logRepo.append({
      id: 'dlog-1',
      userId: 'user-a',
      changeId: 'chg-1',
      proposalId: 'prop-1',
      action: 'create',
      decision: 'accepted',
      summary: 'create: AI 建議作業',
      decidedAt: '2026-11-13T10:01:00Z',
    });

    const logs = await logRepo.listRecent(10);
    expect(logs).toHaveLength(1);
    expect(logs[0].decision).toBe('accepted');
  });

  it('persists attachments & user_tags in Supabase and degrades gracefully if migration 002 is not yet applied', async () => {
    window.localStorage.clear();

    // 1. When migration 002 IS applied -> attachments & user_tags persist in Supabase
    const upgradedClient = createMockSupabaseClient();
    const upgradedCalRepo = new SupabaseCalendarRepository(upgradedClient);
    const upgradedTagRepo = new SupabaseTagRepository(upgradedClient);

    const tagRes = await createTag(upgradedTagRepo, {
      userId: 'user-a',
      name: '專題',
      color: 'indigo',
    });
    expect(tagRes.ok).toBe(true);
    expect(upgradedClient.store.user_tags).toHaveLength(1);

    const dlWithAtt = await createDeadline(upgradedCalRepo, {
      userId: 'user-a',
      title: '雲端簡報',
      dueDate: '2026-11-22',
      attachments: [
        {
          id: 'att-cloud-1',
          name: 'slides.pdf',
          mimeType: 'application/pdf',
          size: 512,
          dataUrl: 'data:application/pdf;base64,JVBERi0xLjQ=',
          createdAt: '2026-11-13T10:00:00.000Z',
        },
      ],
      now: '2026-11-13T10:00:00Z',
    });
    expect(dlWithAtt.ok).toBe(true);
    if (!dlWithAtt.ok) return;
    expect(dlWithAtt.data.attachments).toHaveLength(1);

    // 2. When migration 002 is NOT yet applied -> falls back smoothly without throwing
    const legacyClient = createMockSupabaseClient({
      simulateMissingAttachmentsColumn: true,
      simulateMissingTagsTable: true,
    });
    const legacyCalRepo = new SupabaseCalendarRepository(legacyClient);
    const legacyTagRepo = new SupabaseTagRepository(legacyClient);

    const fallbackTagRes = await createTag(legacyTagRepo, {
      userId: 'user-legacy',
      name: '離線容錯標籤',
      color: 'amber',
    });
    expect(fallbackTagRes.ok).toBe(true);
    expect(await legacyTagRepo.listByUser('user-legacy')).toHaveLength(1);

    const fallbackDlRes = await createDeadline(legacyCalRepo, {
      userId: 'user-legacy',
      title: '容錯附件行程',
      dueDate: '2026-11-24',
      attachments: [
        {
          id: 'att-fb-1',
          name: 'note.txt',
          mimeType: 'text/plain',
          size: 64,
          dataUrl: 'data:text/plain;base64,aGVsbG8=',
          createdAt: '2026-11-13T10:00:00.000Z',
        },
      ],
      now: '2026-11-13T10:00:00Z',
    });
    expect(fallbackDlRes.ok).toBe(true);
    if (!fallbackDlRes.ok) return;
    expect(fallbackDlRes.data.attachments).toHaveLength(1);
    expect((await legacyCalRepo.listByUser('user-legacy'))[0].attachments).toHaveLength(
      1,
    );
  });

  it('overwrites single authoritative snapshot in Supabase without affecting other users and serializes concurrent syncs', async () => {
    const client = createMockSupabaseClient();
    const calRepo = new SupabaseCalendarRepository(client);
    const tagRepo = new SupabaseTagRepository(client);

    // Seed user-a with two items + two tags, and user-b with one item + one tag
    const refNow = new Date('2026-11-01T00:00:00Z');
    const itemA1 = await createSchedule(calRepo, {
      userId: 'user-a',
      title: '舊行程 A1',
      startAt: '2026-11-10T09:00:00+08:00',
      endAt: '2026-11-10T10:00:00+08:00',
      referenceNow: refNow,
      timeZone: 'Asia/Taipei',
    });
    const itemA2 = await createDeadline(calRepo, {
      userId: 'user-a',
      title: '保留截止 A2',
      dueDate: '2026-11-20',
      referenceNow: refNow,
      timeZone: 'Asia/Taipei',
    });
    const itemB1 = await createDeadline(calRepo, {
      userId: 'user-b',
      title: 'User B 行程',
      dueDate: '2026-11-22',
      referenceNow: refNow,
      timeZone: 'Asia/Taipei',
    });
    expect(itemA1.ok && itemA2.ok && itemB1.ok).toBe(true);
    if (!itemA1.ok || !itemA2.ok || !itemB1.ok) return;

    const tagA1 = await createTag(tagRepo, {
      userId: 'user-a',
      name: '待刪標籤',
      color: 'rose',
    });
    const tagA2 = await createTag(tagRepo, {
      userId: 'user-a',
      name: '保留標籤',
      color: 'indigo',
    });
    const tagB1 = await createTag(tagRepo, {
      userId: 'user-b',
      name: 'User B 標籤',
      color: 'emerald',
    });
    expect(tagA1.ok && tagA2.ok && tagB1.ok).toBe(true);
    if (!tagA1.ok || !tagA2.ok || !tagB1.ok) return;

    // Overwrite user-a snapshot concurrently: first keeping A2 (updated), then emptying user-a's calendar snapshot
    const updatedA2 = {
      ...itemA2.data,
      title: '保留截止 A2（覆蓋更新）',
      revision: 2,
    };

    await Promise.all([
      calRepo.syncSnapshot('user-a', [updatedA2]),
      tagRepo.syncSnapshot('user-a', [tagA2.data]),
    ]);

    const userAItemsAfterFirst = await calRepo.listByUser('user-a');
    expect(userAItemsAfterFirst.map((i) => i.title)).toEqual(['保留截止 A2（覆蓋更新）']);
    const userATagsAfterFirst = await tagRepo.listByUser('user-a');
    expect(userATagsAfterFirst.map((t) => t.name)).toEqual(['保留標籤']);

    // User B data remains untouched
    expect((await calRepo.listByUser('user-b')).map((i) => i.title)).toEqual([
      'User B 行程',
    ]);
    expect((await tagRepo.listByUser('user-b')).map((t) => t.name)).toEqual([
      'User B 標籤',
    ]);

    // Overwriting with empty snapshot clears all user-a rows while leaving user-b rows intact
    await calRepo.syncSnapshot('user-a', []);
    await tagRepo.syncSnapshot('user-a', []);
    expect(await calRepo.listByUser('user-a')).toEqual([]);
    expect(await tagRepo.listByUser('user-a')).toEqual([]);
    expect(await calRepo.listByUser('user-b')).toHaveLength(1);
    expect(await tagRepo.listByUser('user-b')).toHaveLength(1);
  });
});
