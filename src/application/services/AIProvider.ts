import type { DecisionLogEntry, ProposalAction, ProposalChange } from '@/domain/proposals';
import type { CalendarItem } from '@/domain/schedule';

export type AIProviderType = 'demo' | 'gemini' | 'openai';
export type RemoteAIProviderType = 'gemini' | 'openai';

export interface StoredApiKeyEntry {
  id: string;
  label: string;
  apiKey: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatAttachmentMetadata {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  base64Data?: string;
  textContent?: string;
}

export interface RejectedProposalContext {
  changeId: string;
  proposalId: string;
  action: ProposalAction;
  title: string;
  summary: string;
  before?: CalendarItem;
  after?: CalendarItem;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  attachments?: readonly ChatAttachmentMetadata[];
  proposalId?: string;
  createdAt: string;
}

export interface GenerateProposalContext {
  userId: string;
  timeZone: string;
  selectedDate: string;
  userMessage: string;
  attachments?: readonly ChatAttachmentMetadata[];
  currentItems: readonly CalendarItem[];
  recentMessages: readonly ChatMessage[];
  rejectedProposals: readonly ProposalChange[];
  lastRejectedProposalId?: string;
  recentDecisions: readonly DecisionLogEntry[];
}

export interface AIProviderResult {
  assistantMessage: string;
  rawChanges: unknown[];
}

export interface AIProvider {
  generateProposal(context: GenerateProposalContext): Promise<AIProviderResult>;
  explainProposal(
    change: ProposalChange,
    context: {
      timeZone: string;
      currentItems: readonly CalendarItem[];
    },
  ): Promise<string>;
}
