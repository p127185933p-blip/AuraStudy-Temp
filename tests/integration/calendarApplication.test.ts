import { describe, expect, it } from 'vitest';
import {
  createDeadline,
  createSchedule,
  deleteCalendarItem,
  updateCalendarItem,
} from '@/application/commands';
import { listCalendarItems } from '@/application/services';
import { getDayRange } from '@/domain/planning';
import { InMemoryCalendarRepository } from '@/infrastructure/repositories';

describe('Calendar Application CRUD & Optimistic Locking Integration', () => {
  const userId = 'student-1';

  it('runs complete CRUD lifecycle with revision increments and stale revision rejection', async () => {
    const repo = new InMemoryCalendarRepository();

    // 1. Create Deadline (revision 1)
    const dlCreateRes = await createDeadline(repo, {
      userId,
      title: 'Compiler Assignment 1',
      dueDate: '2026-11-15T23:59:00+08:00',
      now: '2026-11-13T08:00:00+08:00',
    });
    expect(dlCreateRes.ok).toBe(true);
    if (!dlCreateRes.ok) return;
    expect(dlCreateRes.data.revision).toBe(1);

    // 2. Create Schedule overlapping the Deadline's timestamp -> allowed (Deadlines never conflict)
    const scCreateRes = await createSchedule(repo, {
      userId,
      title: 'Compiler Reading',
      startAt: '2026-11-15T22:00:00+08:00',
      endAt: '2026-11-15T23:59:30+08:00',
      now: '2026-11-13T08:05:00+08:00',
    });
    expect(scCreateRes.ok).toBe(true);
    if (!scCreateRes.ok) return;
    expect(scCreateRes.data.revision).toBe(1);

    // 3. List items for user
    const listRes = await listCalendarItems(repo, { userId });
    expect(listRes.ok).toBe(true);
    if (!listRes.ok) return;
    expect(listRes.data.deadlines).toHaveLength(1);
    expect(listRes.data.schedules).toHaveLength(1);

    // 4. Update Deadline -> revision becomes 2
    const dlUpdateRes = await updateCalendarItem(repo, {
      userId,
      itemId: dlCreateRes.data.id,
      expectedRevision: 1,
      patch: { status: 'completed', title: 'Compiler Assignment 1 (Done)' },
      now: '2026-11-13T10:00:00+08:00',
    });
    expect(dlUpdateRes.ok).toBe(true);
    if (!dlUpdateRes.ok) return;
    expect(dlUpdateRes.data.revision).toBe(2);

    // 5. Attempt update with stale revision (1 instead of 2) -> REVISION_CONFLICT
    const staleUpdateRes = await updateCalendarItem(repo, {
      userId,
      itemId: dlCreateRes.data.id,
      expectedRevision: 1,
      patch: { title: 'Stale Overwrite Attempt' },
    });
    expect(staleUpdateRes.ok).toBe(false);
    if (!staleUpdateRes.ok) {
      expect(staleUpdateRes.error.code).toBe('REVISION_CONFLICT');
      if (staleUpdateRes.error.code === 'REVISION_CONFLICT') {
        expect(staleUpdateRes.error.expectedRevision).toBe(1);
        expect(staleUpdateRes.error.actualRevision).toBe(2);
      }
    }

    // 6. Attempt delete with stale revision (1 instead of 2) -> REVISION_CONFLICT
    const staleDeleteRes = await deleteCalendarItem(repo, {
      userId,
      itemId: dlCreateRes.data.id,
      expectedRevision: 1,
    });
    expect(staleDeleteRes.ok).toBe(false);
    if (!staleDeleteRes.ok) {
      expect(staleDeleteRes.error.code).toBe('REVISION_CONFLICT');
    }

    // 7. Delete with current revision (2) -> succeeds
    const deleteRes = await deleteCalendarItem(repo, {
      userId,
      itemId: dlCreateRes.data.id,
      expectedRevision: 2,
    });
    expect(deleteRes.ok).toBe(true);

    const afterDeleteList = await listCalendarItems(repo, { userId });
    expect(afterDeleteList.ok).toBe(true);
    if (afterDeleteList.ok) {
      expect(afterDeleteList.data.deadlines).toHaveLength(0);
      expect(afterDeleteList.data.schedules).toHaveLength(1);
    }
  });

  it('enforces Schedule conflict checks on create/update while supporting allowConflict override', async () => {
    const repo = new InMemoryCalendarRepository();

    const first = await createSchedule(repo, {
      userId,
      title: 'Block A',
      startAt: '2026-11-16T09:00:00+08:00',
      endAt: '2026-11-16T11:00:00+08:00',
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // Adjacent block should succeed
    const adjacent = await createSchedule(repo, {
      userId,
      title: 'Block B',
      startAt: '2026-11-16T11:00:00+08:00',
      endAt: '2026-11-16T12:00:00+08:00',
    });
    expect(adjacent.ok).toBe(true);
    if (!adjacent.ok) return;

    // Overlapping creation fails with TIME_CONFLICT
    const overlappingCreate = await createSchedule(repo, {
      userId,
      title: 'Block Overlap',
      startAt: '2026-11-16T10:30:00+08:00',
      endAt: '2026-11-16T11:30:00+08:00',
    });
    expect(overlappingCreate.ok).toBe(false);
    if (!overlappingCreate.ok) {
      expect(overlappingCreate.error.code).toBe('TIME_CONFLICT');
      if (overlappingCreate.error.code === 'TIME_CONFLICT') {
        expect(overlappingCreate.error.conflictingItems).toHaveLength(2);
      }
    }

    // Editing Block A within its own original range (10:00-11:00) excludes self and succeeds
    const selfResize = await updateCalendarItem(repo, {
      userId,
      itemId: first.data.id,
      expectedRevision: 1,
      patch: {
        startAt: '2026-11-16T10:00:00+08:00',
        endAt: '2026-11-16T11:00:00+08:00',
      },
    });
    expect(selfResize.ok).toBe(true);
    if (!selfResize.ok) return;
    expect(selfResize.data.revision).toBe(2);

    // Extending Block A into Block B fails unless allowConflict is true
    const extendConflict = await updateCalendarItem(repo, {
      userId,
      itemId: first.data.id,
      expectedRevision: 2,
      patch: { endAt: '2026-11-16T11:30:00+08:00' },
    });
    expect(extendConflict.ok).toBe(false);
    if (!extendConflict.ok) {
      expect(extendConflict.error.code).toBe('TIME_CONFLICT');
    }

    const forcedExtend = await updateCalendarItem(repo, {
      userId,
      itemId: first.data.id,
      expectedRevision: 2,
      patch: { endAt: '2026-11-16T11:30:00+08:00' },
      allowConflict: true,
    });
    expect(forcedExtend.ok).toBe(true);
    if (forcedExtend.ok) {
      expect(forcedExtend.data.revision).toBe(3);
    }
  });

  it('rejects cross-type field updates, unauthorized users, and supports range filtering', async () => {
    const repo = new InMemoryCalendarRepository();

    const dl = await createDeadline(repo, {
      userId,
      title: 'Midterm Exam',
      dueDate: '2026-11-17',
    });
    expect(dl.ok).toBe(true);
    if (!dl.ok) return;

    // Attempt to attach startAt to a Deadline -> VALIDATION_ERROR
    const invalidPatch = await updateCalendarItem(repo, {
      userId,
      itemId: dl.data.id,
      expectedRevision: 1,
      patch: {
        startAt: '2026-11-17T09:00:00+08:00',
      } as unknown as Record<string, string>,
    });
    expect(invalidPatch.ok).toBe(false);
    if (!invalidPatch.ok) {
      expect(invalidPatch.error.code).toBe('VALIDATION_ERROR');
    }

    // Wrong user -> FORBIDDEN
    const forbidden = await deleteCalendarItem(repo, {
      userId: 'other-user',
      itemId: dl.data.id,
      expectedRevision: 1,
    });
    expect(forbidden.ok).toBe(false);
    if (!forbidden.ok) {
      expect(forbidden.error.code).toBe('FORBIDDEN');
    }

    // Range filter
    const nov17Range = getDayRange('2026-11-17', { timeZone: '+08:00' });
    const nov18Range = getDayRange('2026-11-18', { timeZone: '+08:00' });

    const inRange = await listCalendarItems(repo, { userId, range: nov17Range });
    const outRange = await listCalendarItems(repo, { userId, range: nov18Range });

    expect(inRange.ok && inRange.data.deadlines).toHaveLength(1);
    expect(outRange.ok && outRange.data.deadlines).toHaveLength(0);
  });
});
