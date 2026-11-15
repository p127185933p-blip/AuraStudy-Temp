import type { z } from 'zod';
import type { CalendarItem } from '@/domain/schedule';
import type {
  AIProposedChangeInputSchema,
  ProposalActionSchema,
  ProposalChangeSchema,
  ProposalStatusSchema,
} from '@/shared/schemas';

export type ProposalAction = z.infer<typeof ProposalActionSchema>;
export type ProposalStatus = z.infer<typeof ProposalStatusSchema>;
export type ProposalChange = z.infer<typeof ProposalChangeSchema>;
export type AIProposedChangeInput = z.infer<typeof AIProposedChangeInputSchema>;

export interface DecisionLogEntry {
  id: string;
  userId: string;
  changeId: string;
  proposalId: string;
  action: ProposalAction;
  decision: 'accepted' | 'rejected';
  targetItemId?: string;
  summary: string;
  reason?: string;
  decidedAt: string;
}

export class ProposalValidationError extends Error {
  readonly code = 'PROPOSAL_VALIDATION_ERROR' as const;
  readonly issues: readonly string[];

  constructor(message: string, issues: readonly string[] = []) {
    super(message);
    this.name = 'ProposalValidationError';
    this.issues = issues;
  }
}

export function getProposalEffectiveItem(change: ProposalChange): CalendarItem {
  if (change.action === 'delete') {
    if (!change.before) {
      throw new ProposalValidationError('Delete proposal is missing before snapshot');
    }
    return change.before;
  }
  if (!change.after) {
    throw new ProposalValidationError(`${change.action} proposal is missing after item`);
  }
  return change.after;
}
