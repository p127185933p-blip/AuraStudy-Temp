import type { z } from 'zod';
import {
  CreateDeadlineInputSchema,
  CreateScheduleInputSchema,
  DeadlineSchema,
  IsoDateTimeWithTzSchema,
  ScheduleSchema,
  UpdateDeadlinePatchSchema,
  UpdateSchedulePatchSchema,
} from '@/shared/schemas';
import {
  DomainValidationError,
  type CreateDeadlineInput,
  type CreateScheduleInput,
  type Deadline,
  type Schedule,
  type UpdateDeadlinePatch,
  type UpdateSchedulePatch,
} from './types';

export interface FactoryOptions {
  id?: string;
  now?: string;
}

export interface UpdateOptions {
  now?: string;
}

let fallbackCounter = 0;

function generateId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  fallbackCounter += 1;
  return `item-${Date.now()}-${fallbackCounter}`;
}

function resolveTimestamp(now?: string): string {
  if (now === undefined) {
    return new Date().toISOString();
  }
  const parsed = IsoDateTimeWithTzSchema.safeParse(now);
  if (!parsed.success) {
    throw new DomainValidationError(
      'Invalid timestamp provided for domain operation',
      formatZodIssues(parsed.error),
    );
  }
  return parsed.data;
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

export function createDeadline(
  input: CreateDeadlineInput,
  options: FactoryOptions = {},
): Deadline {
  const validatedInput = parseOrThrow(
    CreateDeadlineInputSchema,
    input,
    'Invalid Deadline input',
  );
  const timestamp = resolveTimestamp(options.now);
  const id = options.id ?? validatedInput.id ?? generateId();

  const candidate: Deadline = {
    id,
    userId: validatedInput.userId,
    type: 'deadline',
    title: validatedInput.title,
    dueDate: validatedInput.dueDate,
    revision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...(validatedInput.description !== undefined
      ? { description: validatedInput.description }
      : {}),
    ...(validatedInput.tag !== undefined ? { tag: validatedInput.tag } : {}),
    ...(validatedInput.status !== undefined ? { status: validatedInput.status } : {}),
    ...(validatedInput.attachments !== undefined
      ? { attachments: validatedInput.attachments }
      : {}),
  };

  return parseOrThrow(DeadlineSchema, candidate, 'Invalid Deadline entity');
}

export function createSchedule(
  input: CreateScheduleInput,
  options: FactoryOptions = {},
): Schedule {
  const validatedInput = parseOrThrow(
    CreateScheduleInputSchema,
    input,
    'Invalid Schedule input',
  );
  const timestamp = resolveTimestamp(options.now);
  const id = options.id ?? validatedInput.id ?? generateId();

  const candidate: Schedule = {
    id,
    userId: validatedInput.userId,
    type: 'schedule',
    title: validatedInput.title,
    startAt: validatedInput.startAt,
    endAt: validatedInput.endAt,
    revision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...(validatedInput.description !== undefined
      ? { description: validatedInput.description }
      : {}),
    ...(validatedInput.tag !== undefined ? { tag: validatedInput.tag } : {}),
    ...(validatedInput.status !== undefined ? { status: validatedInput.status } : {}),
    ...(validatedInput.attachments !== undefined
      ? { attachments: validatedInput.attachments }
      : {}),
  };

  return parseOrThrow(ScheduleSchema, candidate, 'Invalid Schedule entity');
}

export function updateDeadline(
  existing: Deadline,
  patch: UpdateDeadlinePatch,
  options: UpdateOptions = {},
): Deadline {
  const current = parseOrThrow(DeadlineSchema, existing, 'Invalid existing Deadline');
  const validatedPatch = parseOrThrow(
    UpdateDeadlinePatchSchema,
    patch,
    'Invalid Deadline update patch',
  );
  const timestamp = resolveTimestamp(options.now);

  const { tag: patchedTag, ...restPatch } = validatedPatch;
  const next: Deadline = {
    ...current,
    ...restPatch,
    type: 'deadline',
    id: current.id,
    userId: current.userId,
    createdAt: current.createdAt,
    revision: current.revision + 1,
    updatedAt: timestamp,
  };

  if ('tag' in validatedPatch) {
    if (patchedTag === null || patchedTag === undefined) {
      delete next.tag;
    } else {
      next.tag = patchedTag;
    }
  }

  return parseOrThrow(DeadlineSchema, next, 'Invalid updated Deadline');
}

export function updateSchedule(
  existing: Schedule,
  patch: UpdateSchedulePatch,
  options: UpdateOptions = {},
): Schedule {
  const current = parseOrThrow(ScheduleSchema, existing, 'Invalid existing Schedule');
  const validatedPatch = parseOrThrow(
    UpdateSchedulePatchSchema,
    patch,
    'Invalid Schedule update patch',
  );
  const timestamp = resolveTimestamp(options.now);

  const { tag: patchedTag, ...restPatch } = validatedPatch;
  const next: Schedule = {
    ...current,
    ...restPatch,
    type: 'schedule',
    id: current.id,
    userId: current.userId,
    createdAt: current.createdAt,
    revision: current.revision + 1,
    updatedAt: timestamp,
  };

  if ('tag' in validatedPatch) {
    if (patchedTag === null || patchedTag === undefined) {
      delete next.tag;
    } else {
      next.tag = patchedTag;
    }
  }

  return parseOrThrow(ScheduleSchema, next, 'Invalid updated Schedule');
}
