import type { z } from 'zod';
import { type CalendarItem } from '@/domain/schedule';
import {
  AIProposalBatchInputSchema,
  IsoDateTimeWithTzSchema,
  ProposalChangeSchema,
} from '@/shared/schemas';
import {
  ProposalValidationError,
  type ProposalChange,
  type ProposalStatus,
} from './types';

let fallbackCounter = 0;

function generateId(prefix: string): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }
  fallbackCounter += 1;
  return `${prefix}-${Date.now()}-${fallbackCounter}`;
}

function formatZodIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
    return `${path}${issue.message}`;
  });
}

function resolveTimestamp(now?: string): string {
  if (now === undefined) {
    return new Date().toISOString();
  }
  const parsed = IsoDateTimeWithTzSchema.safeParse(now);
  if (!parsed.success) {
    throw new ProposalValidationError(
      'Invalid timestamp provided for proposal operation',
      formatZodIssues(parsed.error),
    );
  }
  return parsed.data;
}

/**
 * Pure staleness rule:
 * - A `create` proposal does not reference an existing formal item and is not stale by revision.
 * - An `update` or `delete` proposal is stale if the formal item was deleted (`null`)
 *   or its current `revision` no longer matches `proposal.baseRevision`.
 */
export function isProposalStale(
  proposal: ProposalChange,
  currentFormalItem: CalendarItem | null,
): boolean {
  if (proposal.action === 'create') {
    return false;
  }
  if (!currentFormalItem) {
    return true;
  }
  if (proposal.baseRevision === undefined) {
    return true;
  }
  return currentFormalItem.revision !== proposal.baseRevision;
}

/**
 * Strictly validates untrusted AI output before converting it into pending ProposalChange entities.
 */
export function buildValidatedProposalsFromAI(
  rawChanges: unknown,
  options: { proposalId?: string; now?: string } = {},
): ProposalChange[] {
  const parsedBatch = AIProposalBatchInputSchema.safeParse(rawChanges);
  if (!parsedBatch.success) {
    const issues = formatZodIssues(parsedBatch.error);
    throw new ProposalValidationError(
      `AI proposal payload failed validation: ${issues.join('; ')}`,
      issues,
    );
  }

  const timestamp = resolveTimestamp(options.now);
  const proposalId = options.proposalId ?? generateId('prop');

  return parsedBatch.data.map((raw) => {
    const candidate: ProposalChange = {
      id: raw.id ?? generateId('chg'),
      proposalId,
      action: raw.action,
      status: 'pending',
      createdAt: timestamp,
      updatedAt: timestamp,
      ...(raw.targetItemId !== undefined ? { targetItemId: raw.targetItemId } : {}),
      ...(raw.before !== undefined ? { before: raw.before } : {}),
      ...(raw.after !== undefined ? { after: raw.after } : {}),
      ...(raw.baseRevision !== undefined ? { baseRevision: raw.baseRevision } : {}),
      ...(raw.reason !== undefined ? { reason: raw.reason } : {}),
    };

    const validated = ProposalChangeSchema.safeParse(candidate);
    if (!validated.success) {
      const issues = formatZodIssues(validated.error);
      throw new ProposalValidationError(
        `Invalid ProposalChange entity: ${issues.join('; ')}`,
        issues,
      );
    }
    return validated.data;
  });
}

export function transitionProposalStatus(
  proposal: ProposalChange,
  nextStatus: ProposalStatus,
  now?: string,
): ProposalChange {
  const timestamp = resolveTimestamp(now);
  const updated: ProposalChange = {
    ...proposal,
    status: nextStatus,
    updatedAt: timestamp,
  };
  const validated = ProposalChangeSchema.safeParse(updated);
  if (!validated.success) {
    const issues = formatZodIssues(validated.error);
    throw new ProposalValidationError(
      `Invalid ProposalChange transition: ${issues.join('; ')}`,
      issues,
    );
  }
  return validated.data;
}

export function findStalePendingProposals(
  pendingProposals: readonly ProposalChange[],
  currentItemsById: ReadonlyMap<string, CalendarItem>,
  now?: string,
): ProposalChange[] {
  const timestamp = resolveTimestamp(now);
  const staleResults: ProposalChange[] = [];

  for (const proposal of pendingProposals) {
    if (proposal.status !== 'pending' || proposal.action === 'create') {
      continue;
    }
    const targetId = proposal.targetItemId;
    const formalItem = targetId ? (currentItemsById.get(targetId) ?? null) : null;
    if (isProposalStale(proposal, formalItem)) {
      staleResults.push(transitionProposalStatus(proposal, 'stale', timestamp));
    }
  }

  return staleResults;
}
