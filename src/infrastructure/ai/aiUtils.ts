import { z } from 'zod';
import type {
  AIProviderResult,
  ChatAttachmentMetadata,
} from '@/application/services';
import {
  AIProposalBatchInputSchema,
  isValidIsoDateOnly,
  isValidIsoDateTimeWithTimezone,
} from '@/shared/schemas';
import {
  buildIsoFromLocalDateTime,
  validateAttachmentCandidate,
} from '@/shared/utils';

export const DEFAULT_AI_TIMEOUT_MS = 30_000;

export interface NormalizeAIProposalOptions {
  timeZone?: string;
  userId?: string;
  now?: string;
}

const AIResponseEnvelopeSchema = z.object({
  assistantMessage: z.string().trim().min(1),
  changes: z.array(z.unknown()),
});

const NAIVE_ISO_DATETIME_REGEX =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,9}))?$/;

function generateFallbackId(prefix: string): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function sanitizeSecretFromText(text: string, secret?: string): string {
  let sanitized = text;
  const trimmedSecret = secret?.trim();
  if (trimmedSecret) {
    sanitized = sanitized.split(trimmedSecret).join('[REDACTED]');
    try {
      const encoded = encodeURIComponent(trimmedSecret);
      if (encoded && encoded !== trimmedSecret) {
        sanitized = sanitized.split(encoded).join('[REDACTED]');
      }
    } catch {
      // ignore URI encoding failure
    }
  }

  sanitized = sanitized.replace(/AIza[0-9A-Za-z_-]{12,}/g, '[REDACTED]');
  sanitized = sanitized.replace(/sk-(?:proj-)?[0-9A-Za-z_-]{12,}/g, '[REDACTED]');
  sanitized = sanitized.replace(/Bearer\s+[A-Za-z0-9._-]{12,}/gi, 'Bearer [REDACTED]');
  return sanitized;
}

export function validateAttachmentsBeforeSend(
  attachments?: readonly ChatAttachmentMetadata[],
): void {
  if (!attachments || attachments.length === 0) {
    return;
  }

  for (const att of attachments) {
    const check = validateAttachmentCandidate({
      name: att.name,
      mimeType: att.mimeType,
      size: att.size,
    });
    if (!check.ok) {
      throw new Error(check.reason);
    }
  }
}

function extractBalancedJsonObject(text: string): string | null {
  let startIndex = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === '{') {
      if (depth === 0) {
        startIndex = i;
      }
      depth += 1;
    } else if (ch === '}') {
      if (depth > 0) {
        depth -= 1;
        if (depth === 0 && startIndex >= 0) {
          return text.slice(startIndex, i + 1);
        }
      }
    }
  }

  return null;
}

export function extractJsonObjectString(raw: string): string {
  const trimmed = raw.trim();
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fencedMatch ? fencedMatch[1].trim() : trimmed;

  if (candidate.startsWith('{') && candidate.endsWith('}')) {
    return candidate;
  }

  const balanced = extractBalancedJsonObject(candidate);
  if (balanced) {
    return balanced;
  }

  if (fencedMatch) {
    const fallbackBalanced = extractBalancedJsonObject(trimmed);
    if (fallbackBalanced) {
      return fallbackBalanced;
    }
  }

  return candidate;
}

export function stripNullValues(value: unknown): unknown {
  if (value === null) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => stripNullValues(entry))
      .filter((entry) => entry !== undefined);
  }
  if (isPlainObject(value)) {
    const cleaned: Record<string, unknown> = {};
    for (const [key, entryValue] of Object.entries(value)) {
      const normalizedValue = stripNullValues(entryValue);
      if (normalizedValue !== undefined) {
        cleaned[key] = normalizedValue;
      }
    }
    return cleaned;
  }
  return value;
}

export function normalizeNaiveIsoDateTime(
  value: unknown,
  timeZone: string,
): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return trimmed;
  }
  if (isValidIsoDateOnly(trimmed) || isValidIsoDateTimeWithTimezone(trimmed)) {
    return trimmed;
  }

  const match = NAIVE_ISO_DATETIME_REGEX.exec(trimmed);
  if (!match) {
    return trimmed;
  }

  const dateKey = `${match[1]}-${match[2]}-${match[3]}`;
  if (!isValidIsoDateOnly(dateKey)) {
    return trimmed;
  }

  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] ?? '00');
  if (hour > 23 || minute > 59 || second > 59) {
    return trimmed;
  }

  try {
    const baseIso = buildIsoFromLocalDateTime(
      dateKey,
      `${match[4]}:${match[5]}`,
      timeZone,
    );
    const offsetMatch = /(Z|[+-]\d{2}:\d{2})$/.exec(baseIso);
    const offset = offsetMatch ? offsetMatch[1] : 'Z';
    const ss = String(second).padStart(2, '0');
    return `${dateKey}T${match[4]}:${match[5]}:${ss}${offset}`;
  } catch {
    return trimmed;
  }
}

function normalizeCalendarItemObject(
  rawItem: unknown,
  options: {
    timeZone: string;
    userId: string;
    nowIso: string;
    fillCreateDefaults: boolean;
  },
): unknown {
  if (!isPlainObject(rawItem)) {
    return rawItem;
  }

  const item: Record<string, unknown> = { ...rawItem };

  if (typeof item.dueDate === 'string') {
    item.dueDate = normalizeNaiveIsoDateTime(item.dueDate, options.timeZone);
  }
  if (typeof item.startAt === 'string') {
    item.startAt = normalizeNaiveIsoDateTime(item.startAt, options.timeZone);
  }
  if (typeof item.endAt === 'string') {
    item.endAt = normalizeNaiveIsoDateTime(item.endAt, options.timeZone);
  }
  if (typeof item.createdAt === 'string') {
    item.createdAt = normalizeNaiveIsoDateTime(item.createdAt, options.timeZone);
  }
  if (typeof item.updatedAt === 'string') {
    item.updatedAt = normalizeNaiveIsoDateTime(item.updatedAt, options.timeZone);
  }

  if (options.fillCreateDefaults) {
    if (typeof item.id !== 'string' || item.id.trim().length === 0) {
      const prefix = item.type === 'deadline' ? 'dl' : 'sc';
      item.id = generateFallbackId(prefix);
    }
    if (typeof item.userId !== 'string' || item.userId.trim().length === 0) {
      item.userId = options.userId;
    }
    if (item.revision === undefined) {
      item.revision = 1;
    }
    if (typeof item.createdAt !== 'string' || item.createdAt.trim().length === 0) {
      item.createdAt = options.nowIso;
    }
    if (typeof item.updatedAt !== 'string' || item.updatedAt.trim().length === 0) {
      item.updatedAt = options.nowIso;
    }
  }

  return item;
}

export function normalizeAIProposalPayload(
  parsedJson: unknown,
  options: NormalizeAIProposalOptions = {},
): unknown {
  const timeZone = options.timeZone?.trim() || 'Asia/Taipei';
  const userId = options.userId?.trim() || 'demo-student';
  const nowIso = options.now ?? new Date().toISOString();

  const stripped = stripNullValues(parsedJson);
  if (!isPlainObject(stripped)) {
    return stripped;
  }

  const normalizedChanges = Array.isArray(stripped.changes)
    ? stripped.changes.map((rawChange) => {
        if (!isPlainObject(rawChange)) {
          return rawChange;
        }
        const change: Record<string, unknown> = { ...rawChange };
        const isCreate = change.action === 'create';

        if (change.before !== undefined) {
          change.before = normalizeCalendarItemObject(change.before, {
            timeZone,
            userId,
            nowIso,
            fillCreateDefaults: false,
          });
        }
        if (change.after !== undefined) {
          change.after = normalizeCalendarItemObject(change.after, {
            timeZone,
            userId,
            nowIso,
            fillCreateDefaults: isCreate,
          });
        }

        return change;
      })
    : stripped.changes;

  return {
    ...stripped,
    changes: normalizedChanges,
  };
}

export function parseAndValidateAIProposalResponse(
  rawText: string,
  options: NormalizeAIProposalOptions = {},
): AIProviderResult {
  const cleanedJsonText = extractJsonObjectString(rawText);

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(cleanedJsonText);
  } catch {
    throw new Error('AI 回傳非有效 JSON 格式，已安全攔截並拒絕寫入。');
  }

  const normalized = normalizeAIProposalPayload(parsedJson, options);

  const envelope = AIResponseEnvelopeSchema.safeParse(normalized);
  if (!envelope.success) {
    const detail = envelope.error.issues
      .map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`)
      .join('; ');
    throw new Error(`AI 回傳結構不符合提案契約（${detail}），已安全攔截。`);
  }

  const batchValidation = AIProposalBatchInputSchema.safeParse(
    envelope.data.changes,
  );
  if (!batchValidation.success) {
    const detail = batchValidation.error.issues
      .map((issue) => `${issue.path.join('.') || 'changes'}: ${issue.message}`)
      .join('; ');
    throw new Error(`AI 提案資料未通過嚴格驗證（${detail}），已安全攔截。`);
  }

  return {
    assistantMessage: envelope.data.assistantMessage,
    rawChanges: batchValidation.data,
  };
}

export async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  input: string,
  init: RequestInit,
  options: {
    providerName: string;
    apiKey: string;
    timeoutMs?: number;
  },
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_AI_TIMEOUT_MS;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    return await fetchImpl(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (timedOut || (error instanceof Error && error.name === 'AbortError')) {
      const seconds = Math.max(1, Math.round(timeoutMs / 1000));
      throw new Error(
        `${options.providerName} 連線逾時（超過 ${seconds} 秒未回應），請稍後再試。`,
      );
    }
    const msg = error instanceof Error ? error.message : '網路連線失敗';
    throw new Error(
      sanitizeSecretFromText(`${options.providerName} 連線失敗：${msg}`, options.apiKey),
    );
  } finally {
    clearTimeout(timer);
  }
}

const MAX_API_ERROR_DETAIL_CHARS = 600;

function truncateAtSentenceBoundary(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }

  const slice = text.slice(0, maxChars);
  let lastBoundary = -1;
  for (let i = slice.length - 1; i >= Math.floor(maxChars * 0.5); i -= 1) {
    const ch = slice[i];
    if (ch === '.' || ch === '。' || ch === '!' || ch === '?' || ch === '！' || ch === '？') {
      lastBoundary = i + 1;
      break;
    }
  }

  if (lastBoundary > 0) {
    return `${slice.slice(0, lastBoundary).trimEnd()}…`;
  }

  const lastSpace = slice.lastIndexOf(' ');
  if (lastSpace > Math.floor(maxChars * 0.6)) {
    return `${slice.slice(0, lastSpace).trimEnd()}…`;
  }

  return `${slice.trimEnd()}…`;
}

function extractErrorDetailFromRawBody(rawBody: string): string {
  const trimmed = rawBody.trim();
  if (!trimmed) {
    return '';
  }

  let extracted = trimmed;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (isPlainObject(parsed)) {
      if (isPlainObject(parsed.error) && typeof parsed.error.message === 'string') {
        extracted = parsed.error.message;
      } else if (typeof parsed.message === 'string') {
        extracted = parsed.message;
      }
    } else if (Array.isArray(parsed) && parsed.length > 0) {
      const first = parsed[0];
      if (
        isPlainObject(first) &&
        isPlainObject(first.error) &&
        typeof first.error.message === 'string'
      ) {
        extracted = first.error.message;
      } else if (isPlainObject(first) && typeof first.message === 'string') {
        extracted = first.message;
      }
    }
  } catch {
    // rawBody is plain text, keep as-is
  }

  const normalized = sanitizeSecretFromText(extracted).replace(/\s+/g, ' ').trim();
  return truncateAtSentenceBoundary(normalized, MAX_API_ERROR_DETAIL_CHARS);
}

export function extractReadableApiErrorMessage(
  status: number,
  rawBody: string,
  providerLabel: string,
): string {
  const cleanDetail = extractErrorDetailFromRawBody(rawBody);

  if (status === 401 || status === 403) {
    return cleanDetail
      ? `${providerLabel} API Key 無效或權限不足（HTTP ${status}）：${cleanDetail}`
      : `${providerLabel} API Key 無效或權限不足（HTTP ${status}），請前往設定檢查金鑰。`;
  }
  if (status === 429) {
    return cleanDetail
      ? `${providerLabel} 請求次數已達上限或額度不足（HTTP 429）：${cleanDetail}`
      : `${providerLabel} 請求次數已達上限或額度不足（HTTP 429），請稍後再試。`;
  }
  return `${providerLabel} 回應失敗（HTTP ${status}）：${cleanDetail || '未知錯誤'}`;
}

export function formatHttpProviderError(
  providerName: string,
  status: number,
  rawBodyText: string,
  apiKey: string,
): Error {
  const readable = extractReadableApiErrorMessage(status, rawBodyText, providerName);
  return new Error(sanitizeSecretFromText(readable, apiKey));
}
