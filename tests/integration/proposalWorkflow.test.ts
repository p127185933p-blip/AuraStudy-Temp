import { describe, expect, it } from 'vitest';
import {
  acceptProposalChange,
  rejectProposalChange,
  requestAIProposal,
  syncStaleProposals,
  updateCalendarItem,
} from '@/application/commands';
import { createSchedule } from '@/domain/schedule';
import { MockAIProvider } from '@/infrastructure/ai';
import {
  InMemoryCalendarRepository,
  InMemoryDecisionLogRepository,
  InMemoryProposalRepository,
} from '@/infrastructure/repositories';

describe('Proposal Application Workflow Integration', () => {
  const userId = 'student-1';
  const timeZone = '+08:00';
  const now = '2026-11-13T08:00:00+08:00';

  function setupDeps(initialItems = [] as ReturnType<typeof createSchedule>[]) {
    const calendarRepository = new InMemoryCalendarRepository(initialItems);
    const proposalRepository = new InMemoryProposalRepository();
    const decisionLogRepository = new InMemoryDecisionLogRepository();
    const aiProvider = new MockAIProvider();
    return {
      calendarRepository,
      proposalRepository,
      decisionLogRepository,
      aiProvider,
    };
  }

  it('never modifies formal items until ✓ Accept is explicitly called for CREATE, UPDATE, and DELETE', async () => {
    const existing = createSchedule(
      {
        userId,
        title: '線性代數重點複習',
        startAt: '2026-11-13T09:00:00+08:00',
        endAt: '2026-11-13T10:30:00+08:00',
      },
      { id: 'sc-existing', now },
    );
    const deps = setupDeps([existing]);

    // 1. Request CREATE proposal
    const createReq = await requestAIProposal(deps, {
      userId,
      timeZone,
      selectedDate: '2026-11-13',
      userMessage: '安排明天下午讀書',
      now,
    });
    expect(createReq.ok).toBe(true);
    if (!createReq.ok) return;
    expect(createReq.data.changes).toHaveLength(1);
    expect(createReq.data.changes[0].action).toBe('create');
    expect(createReq.data.changes[0].status).toBe('pending');

    // Formal calendar must still contain ONLY the original item!
    expect(await deps.calendarRepository.listByUser(userId)).toHaveLength(1);

    // Accept CREATE
    const acceptCreate = await acceptProposalChange(deps, {
      userId,
      changeId: createReq.data.changes[0].id,
      now,
    });
    expect(acceptCreate.ok).toBe(true);
    expect(await deps.calendarRepository.listByUser(userId)).toHaveLength(2);

    // 2. Request UPDATE proposal for existing schedule
    const updateReq = await requestAIProposal(deps, {
      userId,
      timeZone,
      selectedDate: '2026-11-13',
      userMessage: '把線性代數重點複習改到 11:00',
      now,
    });
    expect(updateReq.ok).toBe(true);
    if (!updateReq.ok) return;
    expect(updateReq.data.changes[0].action).toBe('update');
    expect(updateReq.data.changes[0].baseRevision).toBe(1);

    const acceptUpdate = await acceptProposalChange(deps, {
      userId,
      changeId: updateReq.data.changes[0].id,
      now,
    });
    expect(acceptUpdate.ok).toBe(true);
    const updatedFormal = await deps.calendarRepository.findById('sc-existing');
    expect(updatedFormal?.revision).toBe(2);
    if (updatedFormal?.type === 'schedule') {
      expect(updatedFormal.startAt).toBe('2026-11-13T11:00:00+08:00');
    }

    // 3. Request DELETE proposal
    const deleteReq = await requestAIProposal(deps, {
      userId,
      timeZone,
      selectedDate: '2026-11-13',
      userMessage: '刪除線性代數重點複習',
      now,
    });
    expect(deleteReq.ok).toBe(true);
    if (!deleteReq.ok) return;
    expect(deleteReq.data.changes[0].action).toBe('delete');

    const acceptDelete = await acceptProposalChange(deps, {
      userId,
      changeId: deleteReq.data.changes[0].id,
      now,
    });
    expect(acceptDelete.ok).toBe(true);
    expect(await deps.calendarRepository.findById('sc-existing')).toBeNull();

    const logs = await deps.decisionLogRepository.listRecent();
    expect(logs).toHaveLength(3);
    expect(logs.every((l) => l.decision === 'accepted')).toBe(true);
  });

  it('marks pending proposals stale after manual edit and blocks accepting stale proposal', async () => {
    const existing = createSchedule(
      {
        userId,
        title: '計算機結構練習',
        startAt: '2026-11-13T14:00:00+08:00',
        endAt: '2026-11-13T16:00:00+08:00',
      },
      { id: 'sc-arch', now },
    );
    const deps = setupDeps([existing]);

    const req = await requestAIProposal(deps, {
      userId,
      timeZone,
      selectedDate: '2026-11-13',
      userMessage: '將計算機結構練習延後',
      now,
    });
    expect(req.ok).toBe(true);
    if (!req.ok) return;
    const changeId = req.data.changes[0].id;

    // User manually updates the same item -> revision 1 -> 2
    const manualRes = await updateCalendarItem(deps.calendarRepository, {
      userId,
      itemId: existing.id,
      expectedRevision: 1,
      patch: { title: '計算機結構練習（手動修改）' },
      now,
    });
    expect(manualRes.ok).toBe(true);

    const staleSynced = await syncStaleProposals(deps, { userId, now });
    expect(staleSynced).toHaveLength(1);
    expect(staleSynced[0].status).toBe('stale');

    // Accepting the stale proposal must fail with PROPOSAL_STALE
    const acceptAttempt = await acceptProposalChange(deps, {
      userId,
      changeId,
      now,
    });
    expect(acceptAttempt.ok).toBe(false);
    if (!acceptAttempt.ok) {
      expect(acceptAttempt.error.code).toBe('PROPOSAL_STALE');
    }

    const formalAfter = await deps.calendarRepository.findById(existing.id);
    expect(formalAfter?.title).toBe('計算機結構練習（手動修改）');
    expect(formalAfter?.revision).toBe(2);
  });

  it('logs rejected proposals and supports follow-up discussion to generate revised proposal', async () => {
    const deps = setupDeps([]);

    const firstReq = await requestAIProposal(deps, {
      userId,
      timeZone,
      selectedDate: '2026-11-13',
      userMessage: '安排明天下午讀書',
      now,
    });
    expect(firstReq.ok).toBe(true);
    if (!firstReq.ok) return;

    const firstChange = firstReq.data.changes[0];
    const rejectRes = await rejectProposalChange(deps, {
      userId,
      changeId: firstChange.id,
      now,
    });
    expect(rejectRes.ok).toBe(true);
    if (!rejectRes.ok) return;
    expect(rejectRes.data.status).toBe('rejected');

    // Formal calendar remains untouched
    expect(await deps.calendarRepository.listByUser(userId)).toHaveLength(0);

    // Continue discussing rejected item
    const followUp = await requestAIProposal(deps, {
      userId,
      timeZone,
      selectedDate: '2026-11-13',
      userMessage: '我剛剛按叉的那項，改到週三 16:00',
      now,
    });
    expect(followUp.ok).toBe(true);
    if (!followUp.ok) return;
    expect(followUp.data.changes).toHaveLength(1);
    const revised = followUp.data.changes[0];
    expect(revised.status).toBe('pending');
    expect(revised.after?.type).toBe('schedule');
    if (revised.after?.type === 'schedule') {
      // 2026-11-13 is Friday -> next Wednesday is 2026-11-18
      expect(revised.after.startAt).toBe('2026-11-18T16:00:00+08:00');
    }
  });
});
