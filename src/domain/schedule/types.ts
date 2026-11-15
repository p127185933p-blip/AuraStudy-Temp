import type { z } from 'zod';
import type {
  CalendarItemSchema,
  CalendarTagSchema,
  CreateDeadlineInputSchema,
  CreateScheduleInputSchema,
  CreateTagInputSchema,
  DeadlineSchema,
  DeadlineStatusSchema,
  ItemAttachmentSchema,
  ScheduleSchema,
  ScheduleStatusSchema,
  TagColorPresetSchema,
  UpdateDeadlinePatchSchema,
  UpdateSchedulePatchSchema,
  UpdateTagPatchSchema,
} from '@/shared/schemas';

export type DeadlineStatus = z.infer<typeof DeadlineStatusSchema>;
export type ScheduleStatus = z.infer<typeof ScheduleStatusSchema>;
export type ItemAttachment = z.infer<typeof ItemAttachmentSchema>;

export type Deadline = z.infer<typeof DeadlineSchema>;
export type Schedule = z.infer<typeof ScheduleSchema>;
export type CalendarItem = z.infer<typeof CalendarItemSchema>;

export type CreateDeadlineInput = z.infer<typeof CreateDeadlineInputSchema>;
export type CreateScheduleInput = z.infer<typeof CreateScheduleInputSchema>;

export type UpdateDeadlinePatch = z.infer<typeof UpdateDeadlinePatchSchema>;
export type UpdateSchedulePatch = z.infer<typeof UpdateSchedulePatchSchema>;

export type TagColorPreset = z.infer<typeof TagColorPresetSchema>;
export type CalendarTag = z.infer<typeof CalendarTagSchema>;
export type CreateTagInput = z.infer<typeof CreateTagInputSchema>;
export type UpdateTagPatch = z.infer<typeof UpdateTagPatchSchema>;

export class DomainValidationError extends Error {
  readonly code = 'DOMAIN_VALIDATION_ERROR' as const;
  readonly issues: readonly string[];

  constructor(message: string, issues: readonly string[] = []) {
    super(message);
    this.name = 'DomainValidationError';
    this.issues = issues;
  }
}

export function isDeadline(item: CalendarItem): item is Deadline {
  return item.type === 'deadline';
}

export function isSchedule(item: CalendarItem): item is Schedule {
  return item.type === 'schedule';
}
