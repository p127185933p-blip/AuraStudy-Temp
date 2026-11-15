import { z } from 'zod';

const ISO_DATE_ONLY_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_DATETIME_WITH_TZ_REGEX =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))$/;

function isValidCalendarDateParts(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

export function isValidIsoDateOnly(value: string): boolean {
  const match = ISO_DATE_ONLY_REGEX.exec(value);
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return isValidCalendarDateParts(year, month, day);
}

export function isValidIsoDateTimeWithTimezone(value: string): boolean {
  const match = ISO_DATETIME_WITH_TZ_REGEX.exec(value);
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);

  if (!isValidCalendarDateParts(year, month, day)) {
    return false;
  }
  if (hour > 23 || minute > 59 || second > 59) {
    return false;
  }

  const tz = match[8];
  if (tz !== 'Z') {
    const tzHour = Number(match[10]);
    const tzMinute = Number(match[11]);
    if (tzHour > 23 || tzMinute > 59) {
      return false;
    }
  }

  return Number.isFinite(Date.parse(value));
}

export function isValidIsoDateOrDateTime(value: string): boolean {
  return isValidIsoDateOnly(value) || isValidIsoDateTimeWithTimezone(value);
}

export const IsoDateTimeWithTzSchema = z
  .string()
  .refine(isValidIsoDateTimeWithTimezone, {
    message: 'Must be a valid ISO 8601 datetime string with timezone (e.g. Z or +08:00)',
  });

export const IsoDateOrDateTimeSchema = z
  .string()
  .refine(isValidIsoDateOrDateTime, {
    message: 'Must be a valid ISO 8601 date (YYYY-MM-DD) or datetime string',
  });

export const DeadlineStatusSchema = z.enum(['pending', 'completed']);
export const ScheduleStatusSchema = z.enum(['scheduled', 'completed', 'cancelled']);

const NonEmptyStringSchema = z.string().trim().min(1);

export const ITEM_ATTACHMENT_MAX_COUNT = 5;
export const ITEM_ATTACHMENT_MAX_BYTES = 3 * 1024 * 1024; // 3MB

export const ItemAttachmentSchema = z.strictObject({
  id: NonEmptyStringSchema,
  name: NonEmptyStringSchema,
  mimeType: NonEmptyStringSchema,
  size: z.number().int().nonnegative().max(ITEM_ATTACHMENT_MAX_BYTES),
  dataUrl: z.string().trim().min(1),
  createdAt: IsoDateTimeWithTzSchema,
});

export const DeadlineSchema = z.strictObject({
  id: NonEmptyStringSchema,
  userId: NonEmptyStringSchema,
  type: z.literal('deadline'),
  title: NonEmptyStringSchema,
  dueDate: IsoDateOrDateTimeSchema,
  revision: z.number().int().positive(),
  createdAt: IsoDateTimeWithTzSchema,
  updatedAt: IsoDateTimeWithTzSchema,
  description: z.string().optional(),
  tag: z.string().trim().min(1).optional(),
  status: DeadlineStatusSchema.optional(),
  attachments: z.array(ItemAttachmentSchema).max(ITEM_ATTACHMENT_MAX_COUNT).optional(),
});

const ScheduleBaseSchema = z.strictObject({
  id: NonEmptyStringSchema,
  userId: NonEmptyStringSchema,
  type: z.literal('schedule'),
  title: NonEmptyStringSchema,
  startAt: IsoDateTimeWithTzSchema,
  endAt: IsoDateTimeWithTzSchema,
  revision: z.number().int().positive(),
  createdAt: IsoDateTimeWithTzSchema,
  updatedAt: IsoDateTimeWithTzSchema,
  description: z.string().optional(),
  tag: z.string().trim().min(1).optional(),
  status: ScheduleStatusSchema.optional(),
  attachments: z.array(ItemAttachmentSchema).max(ITEM_ATTACHMENT_MAX_COUNT).optional(),
});

export const ScheduleSchema = ScheduleBaseSchema.superRefine((data, ctx) => {
  const startMs = Date.parse(data.startAt);
  const endMs = Date.parse(data.endAt);
  if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs <= startMs) {
    ctx.addIssue({
      code: 'custom',
      path: ['endAt'],
      message: 'endAt must be strictly after startAt',
    });
  }
});

export const CalendarItemSchema = z.discriminatedUnion('type', [
  DeadlineSchema,
  ScheduleSchema,
]);

export const CreateDeadlineInputSchema = z.strictObject({
  id: NonEmptyStringSchema.optional(),
  userId: NonEmptyStringSchema,
  title: NonEmptyStringSchema,
  dueDate: IsoDateOrDateTimeSchema,
  description: z.string().optional(),
  tag: z.string().trim().min(1).optional(),
  status: DeadlineStatusSchema.optional(),
  attachments: z.array(ItemAttachmentSchema).max(ITEM_ATTACHMENT_MAX_COUNT).optional(),
});

export const CreateScheduleInputSchema = z
  .strictObject({
    id: NonEmptyStringSchema.optional(),
    userId: NonEmptyStringSchema,
    title: NonEmptyStringSchema,
    startAt: IsoDateTimeWithTzSchema,
    endAt: IsoDateTimeWithTzSchema,
    description: z.string().optional(),
    tag: z.string().trim().min(1).optional(),
    status: ScheduleStatusSchema.optional(),
    attachments: z.array(ItemAttachmentSchema).max(ITEM_ATTACHMENT_MAX_COUNT).optional(),
  })
  .superRefine((data, ctx) => {
    const startMs = Date.parse(data.startAt);
    const endMs = Date.parse(data.endAt);
    if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs <= startMs) {
      ctx.addIssue({
        code: 'custom',
        path: ['endAt'],
        message: 'endAt must be strictly after startAt',
      });
    }
  });

export const UpdateDeadlinePatchSchema = z.strictObject({
  title: NonEmptyStringSchema.optional(),
  dueDate: IsoDateOrDateTimeSchema.optional(),
  description: z.string().optional(),
  tag: z.string().trim().min(1).nullable().optional(),
  status: DeadlineStatusSchema.optional(),
  attachments: z.array(ItemAttachmentSchema).max(ITEM_ATTACHMENT_MAX_COUNT).optional(),
});

export const UpdateSchedulePatchSchema = z.strictObject({
  title: NonEmptyStringSchema.optional(),
  startAt: IsoDateTimeWithTzSchema.optional(),
  endAt: IsoDateTimeWithTzSchema.optional(),
  description: z.string().optional(),
  tag: z.string().trim().min(1).nullable().optional(),
  status: ScheduleStatusSchema.optional(),
  attachments: z.array(ItemAttachmentSchema).max(ITEM_ATTACHMENT_MAX_COUNT).optional(),
});
