import type { ScheduleConflictDetail } from '@/domain/planning';
import type { ProposalChange } from '@/domain/proposals';
import type { Schedule } from '@/domain/schedule';

export type ProposalApplicationError =
  | {
      code: 'PROPOSAL_VALIDATION_ERROR';
      message: string;
      issues?: readonly string[];
    }
  | {
      code: 'PROPOSAL_NOT_FOUND';
      message: string;
      changeId: string;
    }
  | {
      code: 'PROPOSAL_INVALID_STATUS';
      message: string;
      changeId: string;
      status: ProposalChange['status'];
    }
  | {
      code: 'PROPOSAL_STALE';
      message: string;
      changeId: string;
    }
  | {
      code: 'TIME_CONFLICT';
      message: string;
      conflicts: readonly ScheduleConflictDetail[];
      conflictingItems: readonly Schedule[];
    }
  | {
      code: 'PAST_TIME_NOT_ALLOWED';
      message: string;
    }
  | {
      code: 'APPLICATION_ERROR';
      message: string;
    };

export type ProposalResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ProposalApplicationError };

export function proposalOk<T>(data: T): ProposalResult<T> {
  return { ok: true, data };
}

export function proposalFail<T = never>(
  error: ProposalApplicationError,
): ProposalResult<T> {
  return { ok: false, error };
}
