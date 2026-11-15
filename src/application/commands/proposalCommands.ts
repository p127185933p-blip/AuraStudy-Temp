import {
  ProposalValidationError,
  buildValidatedProposalsFromAI,
  findStalePendingProposals,
  getProposalEffectiveItem,
  isProposalStale,
  transitionProposalStatus,
  type DecisionLogEntry,
  type ProposalChange,
} from '@/domain/proposals';
import { isDeadline, type CalendarItem } from '@/domain/schedule';
import {
  createDeadline,
  createSchedule,
  deleteCalendarItem,
  updateCalendarItem,
} from '@/application/commands/calendarCommands';
import type {
  AIProvider,
  ChatAttachmentMetadata,
  ChatMessage,
} from '@/application/services/AIProvider';
import type { CalendarRepository } from '@/application/services/CalendarRepository';
import type {
  DecisionLogRepository,
  ProposalRepository,
} from '@/application/services/ProposalRepository';
import {
  proposalFail,
  proposalOk,
  type ProposalResult,
} from '@/application/services/proposalTypes';
import { validateAttachmentCandidate } from '@/shared/utils';

export interface ProposalCommandDeps {
  calendarRepository: CalendarRepository;
  proposalRepository: ProposalRepository;
  decisionLogRepository: DecisionLogRepository;
}

export interface RequestAIProposalDeps extends ProposalCommandDeps {
  aiProvider: AIProvider;
}

export interface RequestAIProposalInput {
  userId: string;
  timeZone: string;
  selectedDate: string;
  userMessage: string;
  attachments?: readonly ChatAttachmentMetadata[];
  recentMessages?: readonly ChatMessage[];
  lastRejectedProposalId?: string;
  now?: string;
}

export interface RequestAIProposalOutput {
  proposalId: string;
  assistantMessage: string;
  changes: ProposalChange[];
}

export interface AcceptProposalChangeInput {
  userId: string;
  changeId: string;
  allowConflict?: boolean;
  now?: string;
  referenceNow?: Date;
  timeZone?: string;
}

export interface AcceptProposalChangeOutput {
  acceptedChange: ProposalChange;
  appliedItem: CalendarItem | null;
  staleChanges: ProposalChange[];
}

export interface RejectProposalChangeInput {
  userId: string;
  changeId: string;
  now?: string;
}

let logCounter = 0;

function nextLogId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `dlog-${globalThis.crypto.randomUUID()}`;
  }
  logCounter += 1;
  return `dlog-${Date.now()}-${logCounter}`;
}

function summarizeChange(change: ProposalChange): string {
  const item = getProposalEffectiveItem(change);
  return `${change.action}: ${item.title}`;
}

export async function syncStaleProposals(
  deps: Pick<ProposalCommandDeps, 'calendarRepository' | 'proposalRepository'>,
  input: { userId: string; now?: string },
): Promise<ProposalChange[]> {
  const [allProposals, currentUserItems] = await Promise.all([
    deps.proposalRepository.listAll(),
    deps.calendarRepository.listByUser(input.userId),
  ]);

  const currentItemsById = new Map<string, CalendarItem>(
    currentUserItems.map((item) => [item.id, item]),
  );

  const staleUpdates = findStalePendingProposals(
    allProposals,
    currentItemsById,
    input.now,
  );

  if (staleUpdates.length > 0) {
    await deps.proposalRepository.saveMany(staleUpdates);
  }

  return staleUpdates;
}

export async function requestAIProposal(
  deps: RequestAIProposalDeps,
  input: RequestAIProposalInput,
): Promise<ProposalResult<RequestAIProposalOutput>> {
  const trimmed = input.userMessage.trim();
  if (!trimmed && (!input.attachments || input.attachments.length === 0)) {
    return proposalFail({
      code: 'PROPOSAL_VALIDATION_ERROR',
      message: '請輸入訊息或附加檔案後再送出。',
    });
  }

  if (input.attachments) {
    for (const att of input.attachments) {
      const check = validateAttachmentCandidate({
        name: att.name,
        mimeType: att.mimeType,
        size: att.size,
      });
      if (!check.ok) {
        return proposalFail({
          code: 'PROPOSAL_VALIDATION_ERROR',
          message: check.reason,
          issues: [check.reason],
        });
      }
    }
  }

  const [currentItems, allProposals, recentDecisions] = await Promise.all([
    deps.calendarRepository.listByUser(input.userId),
    deps.proposalRepository.listAll(),
    deps.decisionLogRepository.listRecent(20),
  ]);

  const rejectedProposals = allProposals.filter((p) => p.status === 'rejected');

  let aiResponse;
  try {
    aiResponse = await deps.aiProvider.generateProposal({
      userId: input.userId,
      timeZone: input.timeZone,
      selectedDate: input.selectedDate,
      userMessage: trimmed,
      attachments: input.attachments,
      currentItems,
      recentMessages: input.recentMessages ?? [],
      rejectedProposals,
      lastRejectedProposalId: input.lastRejectedProposalId,
      recentDecisions,
    });
  } catch (error) {
    return proposalFail({
      code: 'APPLICATION_ERROR',
      message:
        error instanceof Error
          ? error.message
          : 'AI 服務連線失敗，請檢查網路或 API Key 設定後再試。',
    });
  }

  let validatedChanges: ProposalChange[];
  try {
    validatedChanges = buildValidatedProposalsFromAI(aiResponse.rawChanges, {
      now: input.now,
    });
  } catch (error) {
    if (error instanceof ProposalValidationError) {
      return proposalFail({
        code: 'PROPOSAL_VALIDATION_ERROR',
        message: error.message,
        issues: error.issues,
      });
    }
    throw error;
  }

  const savedChanges =
    validatedChanges.length > 0
      ? await deps.proposalRepository.saveMany(validatedChanges)
      : [];

  const proposalId =
    savedChanges[0]?.proposalId ?? `prop-empty-${Date.now()}`;

  return proposalOk({
    proposalId,
    assistantMessage: aiResponse.assistantMessage,
    changes: savedChanges,
  });
}

export async function acceptProposalChange(
  deps: ProposalCommandDeps,
  input: AcceptProposalChangeInput,
): Promise<ProposalResult<AcceptProposalChangeOutput>> {
  const existing = await deps.proposalRepository.findById(input.changeId);
  if (!existing) {
    return proposalFail({
      code: 'PROPOSAL_NOT_FOUND',
      message: `找不到提案變更「${input.changeId}」`,
      changeId: input.changeId,
    });
  }

  if (existing.status !== 'pending') {
    if (existing.status === 'stale') {
      return proposalFail({
        code: 'PROPOSAL_STALE',
        message: '此提案已過期，目標行程已發生變更。',
        changeId: existing.id,
      });
    }
    return proposalFail({
      code: 'PROPOSAL_INVALID_STATUS',
      message: `此提案目前狀態為 ${existing.status}，無法重複套用。`,
      changeId: existing.id,
      status: existing.status,
    });
  }

  // Staleness check against current formal state
  if (existing.action === 'update' || existing.action === 'delete') {
    const targetId = existing.targetItemId!;
    const currentFormal = await deps.calendarRepository.findById(targetId);

    if (isProposalStale(existing, currentFormal)) {
      const staleChange = transitionProposalStatus(existing, 'stale', input.now);
      await deps.proposalRepository.save(staleChange);
      return proposalFail({
        code: 'PROPOSAL_STALE',
        message: '原行程已被修改或刪除，此提案已標記為過期，無法套用。',
        changeId: existing.id,
      });
    }
  }

  let appliedItem: CalendarItem | null = null;

  if (existing.action === 'create') {
    const after = existing.after!;
    if (isDeadline(after)) {
      const res = await createDeadline(deps.calendarRepository, {
        userId: input.userId,
        id: after.id,
        title: after.title,
        dueDate: after.dueDate,
        description: after.description,
        tag: after.tag,
        status: after.status,
        now: input.now,
        referenceNow: input.referenceNow,
        timeZone: input.timeZone,
      });
      if (!res.ok) {
        if (res.error.code === 'PAST_TIME_NOT_ALLOWED') {
          return proposalFail({
            code: 'PAST_TIME_NOT_ALLOWED',
            message: res.error.message,
          });
        }
        return proposalFail({
          code: 'APPLICATION_ERROR',
          message: res.error.message,
        });
      }
      appliedItem = res.data;
    } else {
      const res = await createSchedule(deps.calendarRepository, {
        userId: input.userId,
        id: after.id,
        title: after.title,
        startAt: after.startAt,
        endAt: after.endAt,
        description: after.description,
        tag: after.tag,
        status: after.status,
        allowConflict: input.allowConflict,
        now: input.now,
        referenceNow: input.referenceNow,
        timeZone: input.timeZone,
      });
      if (!res.ok) {
        if (res.error.code === 'TIME_CONFLICT') {
          return proposalFail({
            code: 'TIME_CONFLICT',
            message: res.error.message,
            conflicts: res.error.conflicts,
            conflictingItems: res.error.conflictingItems,
          });
        }
        if (res.error.code === 'PAST_TIME_NOT_ALLOWED') {
          return proposalFail({
            code: 'PAST_TIME_NOT_ALLOWED',
            message: res.error.message,
          });
        }
        return proposalFail({
          code: 'APPLICATION_ERROR',
          message: res.error.message,
        });
      }
      appliedItem = res.data;
    }
  } else if (existing.action === 'update') {
    const after = existing.after!;
    const patch = isDeadline(after)
      ? {
          title: after.title,
          dueDate: after.dueDate,
          description: after.description,
          tag: after.tag,
          status: after.status,
        }
      : {
          title: after.title,
          startAt: after.startAt,
          endAt: after.endAt,
          description: after.description,
          tag: after.tag,
          status: after.status,
        };

    const res = await updateCalendarItem(deps.calendarRepository, {
      userId: input.userId,
      itemId: existing.targetItemId!,
      expectedRevision: existing.baseRevision!,
      allowConflict: input.allowConflict,
      now: input.now,
      referenceNow: input.referenceNow,
      timeZone: input.timeZone,
      patch,
    });

    if (!res.ok) {
      if (res.error.code === 'TIME_CONFLICT') {
        return proposalFail({
          code: 'TIME_CONFLICT',
          message: res.error.message,
          conflicts: res.error.conflicts,
          conflictingItems: res.error.conflictingItems,
        });
      }
      if (res.error.code === 'PAST_TIME_NOT_ALLOWED') {
        return proposalFail({
          code: 'PAST_TIME_NOT_ALLOWED',
          message: res.error.message,
        });
      }
      if (res.error.code === 'REVISION_CONFLICT' || res.error.code === 'NOT_FOUND') {
        const staleChange = transitionProposalStatus(existing, 'stale', input.now);
        await deps.proposalRepository.save(staleChange);
        return proposalFail({
          code: 'PROPOSAL_STALE',
          message: '原行程已被修改或刪除，此提案已標記為過期。',
          changeId: existing.id,
        });
      }
      return proposalFail({
        code: 'APPLICATION_ERROR',
        message: res.error.message,
      });
    }
    appliedItem = res.data;
  } else {
    const res = await deleteCalendarItem(deps.calendarRepository, {
      userId: input.userId,
      itemId: existing.targetItemId!,
      expectedRevision: existing.baseRevision!,
    });
    if (!res.ok) {
      if (res.error.code === 'REVISION_CONFLICT' || res.error.code === 'NOT_FOUND') {
        const staleChange = transitionProposalStatus(existing, 'stale', input.now);
        await deps.proposalRepository.save(staleChange);
        return proposalFail({
          code: 'PROPOSAL_STALE',
          message: '原行程已被修改或刪除，此提案已標記為過期。',
          changeId: existing.id,
        });
      }
      return proposalFail({
        code: 'APPLICATION_ERROR',
        message: res.error.message,
      });
    }
  }

  const acceptedChange = transitionProposalStatus(existing, 'accepted', input.now);
  await deps.proposalRepository.save(acceptedChange);

  const decisionEntry: DecisionLogEntry = {
    id: nextLogId(),
    userId: input.userId,
    changeId: acceptedChange.id,
    proposalId: acceptedChange.proposalId,
    action: acceptedChange.action,
    decision: 'accepted',
    ...(acceptedChange.targetItemId !== undefined
      ? { targetItemId: acceptedChange.targetItemId }
      : {}),
    summary: summarizeChange(acceptedChange),
    ...(acceptedChange.reason !== undefined ? { reason: acceptedChange.reason } : {}),
    decidedAt: acceptedChange.updatedAt,
  };
  await deps.decisionLogRepository.append(decisionEntry);

  const staleChanges = await syncStaleProposals(deps, {
    userId: input.userId,
    now: input.now,
  });

  return proposalOk({
    acceptedChange,
    appliedItem,
    staleChanges,
  });
}

export async function rejectProposalChange(
  deps: Pick<ProposalCommandDeps, 'proposalRepository' | 'decisionLogRepository'>,
  input: RejectProposalChangeInput,
): Promise<ProposalResult<ProposalChange>> {
  const existing = await deps.proposalRepository.findById(input.changeId);
  if (!existing) {
    return proposalFail({
      code: 'PROPOSAL_NOT_FOUND',
      message: `找不到提案變更「${input.changeId}」`,
      changeId: input.changeId,
    });
  }

  if (existing.status !== 'pending' && existing.status !== 'stale') {
    return proposalFail({
      code: 'PROPOSAL_INVALID_STATUS',
      message: `此提案目前狀態為 ${existing.status}，無法拒絕。`,
      changeId: existing.id,
      status: existing.status,
    });
  }

  const rejectedChange = transitionProposalStatus(existing, 'rejected', input.now);
  await deps.proposalRepository.save(rejectedChange);

  const decisionEntry: DecisionLogEntry = {
    id: nextLogId(),
    userId: input.userId,
    changeId: rejectedChange.id,
    proposalId: rejectedChange.proposalId,
    action: rejectedChange.action,
    decision: 'rejected',
    ...(rejectedChange.targetItemId !== undefined
      ? { targetItemId: rejectedChange.targetItemId }
      : {}),
    summary: summarizeChange(rejectedChange),
    ...(rejectedChange.reason !== undefined ? { reason: rejectedChange.reason } : {}),
    decidedAt: rejectedChange.updatedAt,
  };
  await deps.decisionLogRepository.append(decisionEntry);

  return proposalOk(rejectedChange);
}
