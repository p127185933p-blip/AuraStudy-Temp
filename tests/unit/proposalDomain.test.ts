import { describe, expect, it } from 'vitest';
import {
  ProposalValidationError,
  buildValidatedProposalsFromAI,
  findStalePendingProposals,
  isProposalStale,
} from '@/domain/proposals';
import { createDeadline, createSchedule, updateSchedule } from '@/domain/schedule';

describe('Proposal Domain Validation & Staleness Rules', () => {
  const now = '2026-11-13T08:00:00+08:00';

  it('intercepts invalid untrusted AI payloads via strict Zod validation', () => {
    // 1. create missing `after`
    expect(() =>
      buildValidatedProposalsFromAI([{ action: 'create' }], { now }),
    ).toThrow(ProposalValidationError);

    // 2. Schedule with endAt <= startAt inside `after`
    expect(() =>
      buildValidatedProposalsFromAI(
        [
          {
            action: 'create',
            after: {
              id: 'ai-bad-1',
              userId: 'user-1',
              type: 'schedule',
              title: 'Invalid Time',
              startAt: '2026-11-14T10:00:00+08:00',
              endAt: '2026-11-14T09:00:00+08:00',
              revision: 1,
              createdAt: now,
              updatedAt: now,
            },
          },
        ],
        { now },
      ),
    ).toThrow(ProposalValidationError);

    // 3. update attempting to convert Deadline into Schedule
    const existingDeadline = createDeadline(
      { userId: 'user-1', title: 'HW 1', dueDate: '2026-11-15' },
      { id: 'dl-1', now },
    );
    expect(() =>
      buildValidatedProposalsFromAI(
        [
          {
            action: 'update',
            targetItemId: 'dl-1',
            baseRevision: 1,
            before: existingDeadline,
            after: {
              id: 'dl-1',
              userId: 'user-1',
              type: 'schedule',
              title: 'HW 1',
              startAt: '2026-11-15T09:00:00+08:00',
              endAt: '2026-11-15T10:00:00+08:00',
              revision: 1,
              createdAt: now,
              updatedAt: now,
            },
          },
        ],
        { now },
      ),
    ).toThrow(ProposalValidationError);

    // 4. delete with `after` present
    expect(() =>
      buildValidatedProposalsFromAI(
        [
          {
            action: 'delete',
            targetItemId: 'dl-1',
            baseRevision: 1,
            before: existingDeadline,
            after: existingDeadline,
          },
        ],
        { now },
      ),
    ).toThrow(ProposalValidationError);
  });

  it('detects stale proposals when formal revision changes or target item is deleted', () => {
    const schedule = createSchedule(
      {
        userId: 'user-1',
        title: 'Study Session',
        startAt: '2026-11-14T09:00:00+08:00',
        endAt: '2026-11-14T11:00:00+08:00',
      },
      { id: 'sc-1', now },
    );

    const [updateProp, createProp] = buildValidatedProposalsFromAI(
      [
        {
          action: 'update',
          targetItemId: schedule.id,
          baseRevision: schedule.revision,
          before: schedule,
          after: {
            ...schedule,
            startAt: '2026-11-14T13:00:00+08:00',
            endAt: '2026-11-14T15:00:00+08:00',
          },
        },
        {
          action: 'create',
          after: {
            id: 'sc-new',
            userId: 'user-1',
            type: 'schedule',
            title: 'New Block',
            startAt: '2026-11-15T09:00:00+08:00',
            endAt: '2026-11-15T10:00:00+08:00',
            revision: 1,
            createdAt: now,
            updatedAt: now,
          },
        },
      ],
      { now },
    );

    expect(isProposalStale(createProp, null)).toBe(false);
    expect(isProposalStale(updateProp, schedule)).toBe(false);

    // Target deleted -> stale
    expect(isProposalStale(updateProp, null)).toBe(true);

    // Target revision bumped -> stale
    const modified = updateSchedule(schedule, { title: 'Manually Edited' }, { now });
    expect(modified.revision).toBe(2);
    expect(isProposalStale(updateProp, modified)).toBe(true);

    const staleList = findStalePendingProposals(
      [updateProp, createProp],
      new Map([[modified.id, modified]]),
      now,
    );
    expect(staleList).toHaveLength(1);
    expect(staleList[0].id).toBe(updateProp.id);
    expect(staleList[0].status).toBe('stale');
  });
});
