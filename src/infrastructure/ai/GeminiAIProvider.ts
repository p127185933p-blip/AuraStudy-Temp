import type {
  AIProvider,
  AIProviderResult,
  GenerateProposalContext,
} from '@/application/services';
import type { ProposalChange } from '@/domain/proposals';
import type { CalendarItem } from '@/domain/schedule';
import { isImageMimeType } from '@/shared/utils';
import {
  DEFAULT_AI_TIMEOUT_MS,
  extractReadableApiErrorMessage,
  fetchWithTimeout,
  parseAndValidateAIProposalResponse,
  sanitizeSecretFromText,
  validateAttachmentsBeforeSend,
} from './aiUtils';
import { DEFAULT_GEMINI_MODEL } from './byokStorage';
import {
  buildExplainProposalPrompt,
  buildProposalSystemInstruction,
  buildProposalUserPrompt,
} from './promptBuilder';

export interface GeminiAIProviderOptions {
  apiKey: string;
  model?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

interface GeminiGenerateContentResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
  error?: { message?: string };
}

export class GeminiAIProvider implements AIProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: GeminiAIProviderOptions) {
    this.apiKey = options.apiKey.trim();
    this.model = options.model?.trim() || DEFAULT_GEMINI_MODEL;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_AI_TIMEOUT_MS;
  }

  async generateProposal(
    context: GenerateProposalContext,
  ): Promise<AIProviderResult> {
    if (!this.apiKey) {
      throw new Error('尚未設定 Google Gemini API Key，請前往設定輸入金鑰。');
    }

    validateAttachmentsBeforeSend(context.attachments);

    const parts: Array<
      | { text: string }
      | { inlineData: { mimeType: string; data: string } }
    > = [{ text: buildProposalUserPrompt(context) }];

    for (const att of context.attachments ?? []) {
      if (isImageMimeType(att.mimeType) && att.base64Data) {
        parts.push({
          inlineData: {
            mimeType: att.mimeType,
            data: att.base64Data,
          },
        });
      }
    }

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`;

    const response = await fetchWithTimeout(
      this.fetchImpl,
      endpoint,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.apiKey,
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: buildProposalSystemInstruction() }],
          },
          contents: [
            {
              role: 'user',
              parts,
            },
          ],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.2,
          },
        }),
      },
      {
        providerName: 'Google Gemini',
        apiKey: this.apiKey,
        timeoutMs: this.timeoutMs,
      },
    );

    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      const readable = extractReadableApiErrorMessage(
        response.status,
        bodyText,
        'Google Gemini',
      );
      throw new Error(sanitizeSecretFromText(readable, this.apiKey));
    }

    let payload: GeminiGenerateContentResponse;
    try {
      payload = (await response.json()) as GeminiGenerateContentResponse;
    } catch {
      throw new Error('Google Gemini 回應內容無法解析為 JSON。');
    }

    const rawText =
      payload.candidates?.[0]?.content?.parts
        ?.map((p) => p.text ?? '')
        .join('') ?? '';

    if (!rawText.trim()) {
      throw new Error('Google Gemini 未回傳任何有效提案內容。');
    }

    try {
      return parseAndValidateAIProposalResponse(rawText, {
        timeZone: context.timeZone,
        userId: context.userId,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'AI 提案驗證失敗。';
      throw new Error(sanitizeSecretFromText(message, this.apiKey));
    }
  }

  async explainProposal(
    change: ProposalChange,
    context: { timeZone: string; currentItems: readonly CalendarItem[] },
  ): Promise<string> {
    if (!this.apiKey) {
      throw new Error('尚未設定 Google Gemini API Key，請前往設定輸入金鑰。');
    }

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`;

    try {
      const response = await fetchWithTimeout(
        this.fetchImpl,
        endpoint,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': this.apiKey,
          },
          body: JSON.stringify({
            contents: [
              {
                role: 'user',
                parts: [{ text: buildExplainProposalPrompt(change, context) }],
              },
            ],
            generationConfig: { temperature: 0.3 },
          }),
        },
        {
          providerName: 'Google Gemini',
          apiKey: this.apiKey,
          timeoutMs: this.timeoutMs,
        },
      );

      if (!response.ok) {
        const bodyText = await response.text().catch(() => '');
        const readable = extractReadableApiErrorMessage(
          response.status,
          bodyText,
          'Google Gemini',
        );
        throw new Error(sanitizeSecretFromText(readable, this.apiKey));
      }

      const payload = (await response.json()) as GeminiGenerateContentResponse;
      const text =
        payload.candidates?.[0]?.content?.parts
          ?.map((p) => p.text ?? '')
          .join('')
          .trim() ?? '';

      return text || change.reason || '建議依照此時段調整學習規劃。';
    } catch (error) {
      const msg = error instanceof Error ? error.message : '說明生成失敗';
      throw new Error(sanitizeSecretFromText(msg, this.apiKey));
    }
  }
}
