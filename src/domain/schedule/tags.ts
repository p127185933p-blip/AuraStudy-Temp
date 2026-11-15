import type { z } from 'zod';
import {
  CalendarTagSchema,
  CreateTagInputSchema,
  IsoDateTimeWithTzSchema,
  UpdateTagPatchSchema,
} from '@/shared/schemas';
import {
  DomainValidationError,
  type CalendarTag,
  type CreateTagInput,
  type TagColorPreset,
  type UpdateTagPatch,
} from './types';

export interface DefaultTagSeed {
  name: string;
  color: TagColorPreset;
}

export const DEFAULT_TAG_SEEDS: readonly DefaultTagSeed[] = [
  { name: '課業', color: 'indigo' },
  { name: '專題', color: 'violet' },
  { name: '生活', color: 'emerald' },
];

let fallbackTagCounter = 0;

function generateTagId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  fallbackTagCounter += 1;
  return `tag-${Date.now()}-${fallbackTagCounter}`;
}

function formatZodIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
    return `${path}${issue.message}`;
  });
}

function parseOrThrow<T>(schema: z.ZodType<T>, input: unknown, context: string): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issues = formatZodIssues(result.error);
    throw new DomainValidationError(`${context}: ${issues.join('; ')}`, issues);
  }
  return result.data;
}

function resolveTimestamp(now?: string): string {
  if (now === undefined) {
    return new Date().toISOString();
  }
  const parsed = IsoDateTimeWithTzSchema.safeParse(now);
  if (!parsed.success) {
    throw new DomainValidationError(
      'Invalid timestamp provided for tag operation',
      formatZodIssues(parsed.error),
    );
  }
  return parsed.data;
}

export function createTagEntity(
  input: CreateTagInput,
  options: { id?: string; now?: string } = {},
): CalendarTag {
  const validated = parseOrThrow(CreateTagInputSchema, input, 'Invalid Tag input');
  const createdAt = resolveTimestamp(options.now);
  const id = options.id ?? validated.id ?? generateTagId();

  return parseOrThrow(
    CalendarTagSchema,
    {
      id,
      userId: validated.userId,
      name: validated.name,
      color: validated.color,
      createdAt,
    },
    'Invalid CalendarTag entity',
  );
}

export function updateTagEntity(
  existing: CalendarTag,
  patch: UpdateTagPatch,
): CalendarTag {
  const current = parseOrThrow(CalendarTagSchema, existing, 'Invalid existing CalendarTag');
  const validatedPatch = parseOrThrow(
    UpdateTagPatchSchema,
    patch,
    'Invalid CalendarTag update patch',
  );

  return parseOrThrow(
    CalendarTagSchema,
    {
      ...current,
      ...(validatedPatch.name !== undefined ? { name: validatedPatch.name } : {}),
      ...(validatedPatch.color !== undefined ? { color: validatedPatch.color } : {}),
      id: current.id,
      userId: current.userId,
      createdAt: current.createdAt,
    },
    'Invalid updated CalendarTag',
  );
}
