import type { ScheduleConflictDetail } from '@/domain/planning';
import type { Schedule } from '@/domain/schedule';

export type CalendarApplicationError =
  | {
      code: 'VALIDATION_ERROR';
      message: string;
      issues?: readonly string[];
    }
  | {
      code: 'NOT_FOUND';
      message: string;
      itemId: string;
    }
  | {
      code: 'FORBIDDEN';
      message: string;
      itemId: string;
    }
  | {
      code: 'REVISION_CONFLICT';
      message: string;
      itemId: string;
      expectedRevision: number;
      actualRevision: number;
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
    };

export type ApplicationResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: CalendarApplicationError };

export function ok<T>(data: T): ApplicationResult<T> {
  return { ok: true, data };
}

export function fail<T = never>(error: CalendarApplicationError): ApplicationResult<T> {
  return { ok: false, error };
}
