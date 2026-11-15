import { z } from 'zod';
import { CalendarItemSchema, IsoDateTimeWithTzSchema } from './calendar';

const NonEmptyStringSchema = z.string().trim().min(1);

export const ProposalActionSchema = z.enum(['create', 'update', 'delete']);
export const ProposalStatusSchema = z.enum([
  'pending',
  'accepted',
  'rejected',
  'stale',
  'blocked',
]);

function validateProposalActionFields(
  data: {
    action: 'create' | 'update' | 'delete';
    targetItemId?: string;
    before?: z.infer<typeof CalendarItemSchema>;
    after?: z.infer<typeof CalendarItemSchema>;
    baseRevision?: number;
  },
  ctx: z.RefinementCtx,
): void {
  if (data.action === 'create') {
    if (!data.after) {
      ctx.addIssue({
        code: 'custom',
        path: ['after'],
        message: 'create proposal must include after',
      });
    }
    if (data.targetItemId !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['targetItemId'],
        message: 'create proposal must not specify targetItemId',
      });
    }
    if (data.before !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['before'],
        message: 'create proposal must not specify before',
      });
    }
    if (data.baseRevision !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['baseRevision'],
        message: 'create proposal must not specify baseRevision',
      });
    }
    return;
  }

  if (!data.targetItemId) {
    ctx.addIssue({
      code: 'custom',
      path: ['targetItemId'],
      message: `${data.action} proposal must include targetItemId`,
    });
  }
  if (!data.before) {
    ctx.addIssue({
      code: 'custom',
      path: ['before'],
      message: `${data.action} proposal must include before snapshot`,
    });
  }
  if (data.baseRevision === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['baseRevision'],
      message: `${data.action} proposal must include baseRevision`,
    });
  } else if (data.before && data.baseRevision !== data.before.revision) {
    ctx.addIssue({
      code: 'custom',
      path: ['baseRevision'],
      message: 'baseRevision must match before.revision',
    });
  }

  if (data.before && data.targetItemId && data.before.id !== data.targetItemId) {
    ctx.addIssue({
      code: 'custom',
      path: ['before', 'id'],
      message: 'before.id must match targetItemId',
    });
  }

  if (data.action === 'update') {
    if (!data.after) {
      ctx.addIssue({
        code: 'custom',
        path: ['after'],
        message: 'update proposal must include after',
      });
    } else if (data.before) {
      if (data.after.type !== data.before.type) {
        ctx.addIssue({
          code: 'custom',
          path: ['after', 'type'],
          message: 'update proposal cannot convert between Deadline and Schedule',
        });
      }
      if (data.after.id !== data.before.id) {
        ctx.addIssue({
          code: 'custom',
          path: ['after', 'id'],
          message: 'after.id must match before.id',
        });
      }
      if (data.after.userId !== data.before.userId) {
        ctx.addIssue({
          code: 'custom',
          path: ['after', 'userId'],
          message: 'after.userId must match before.userId',
        });
      }
    }
  }

  if (data.action === 'delete' && data.after !== undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['after'],
      message: 'delete proposal must not include after',
    });
  }
}

export const ProposalChangeSchema = z
  .strictObject({
    id: NonEmptyStringSchema,
    proposalId: NonEmptyStringSchema,
    targetItemId: NonEmptyStringSchema.optional(),
    action: ProposalActionSchema,
    status: ProposalStatusSchema,
    before: CalendarItemSchema.optional(),
    after: CalendarItemSchema.optional(),
    baseRevision: z.number().int().positive().optional(),
    reason: z.string().optional(),
    createdAt: IsoDateTimeWithTzSchema,
    updatedAt: IsoDateTimeWithTzSchema,
  })
  .superRefine(validateProposalActionFields);

export const AIProposedChangeInputSchema = z
  .strictObject({
    id: NonEmptyStringSchema.optional(),
    targetItemId: NonEmptyStringSchema.optional(),
    action: ProposalActionSchema,
    before: CalendarItemSchema.optional(),
    after: CalendarItemSchema.optional(),
    baseRevision: z.number().int().positive().optional(),
    reason: z.string().optional(),
  })
  .superRefine(validateProposalActionFields);

export const AIProposalBatchInputSchema = z.array(AIProposedChangeInputSchema);
