import { z } from 'zod';
import { IsoDateTimeWithTzSchema } from './calendar';

const NonEmptyStringSchema = z.string().trim().min(1);

export const TagColorPresetSchema = z.enum([
  'indigo',
  'emerald',
  'amber',
  'rose',
  'violet',
  'cyan',
  'orange',
  'slate',
]);

export const CalendarTagSchema = z.strictObject({
  id: NonEmptyStringSchema,
  userId: NonEmptyStringSchema,
  name: NonEmptyStringSchema,
  color: TagColorPresetSchema,
  createdAt: IsoDateTimeWithTzSchema,
});

export const CreateTagInputSchema = z.strictObject({
  id: NonEmptyStringSchema.optional(),
  userId: NonEmptyStringSchema,
  name: NonEmptyStringSchema,
  color: TagColorPresetSchema,
});

export const UpdateTagPatchSchema = z.strictObject({
  name: NonEmptyStringSchema.optional(),
  color: TagColorPresetSchema.optional(),
});
