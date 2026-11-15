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
import { DEFAULT_OPENAI_MODEL, normalizeOpenAIModel } from './byokStorage';
import {
  buildExplainProposalPrompt,
  buildProposalSystemInstruction,
  buildProposalUserPrompt,
} from './promptBuilder';

export interface OpenAIProviderOptions {
  apiKey: string;
  model?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

interface OpenAIChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
}

interface BuildOpenAIChatRequestBodyOptions {
  model: string;
  messages: Array<Record<string, unknown>>;
  responseFormat?: { type: 'json_object' };
  legacyTemperature: number;
  maxTokens: number;
}

export function buildOpenAIChatRequestBody(
  options: BuildOpenAIChatRequestBodyOptions,
): Record<string, unknown> {
  const resolvedModel = normalizeOpenAIModel(options.model);
  const lowerModel = resolvedModel.toLowerCase();
  const isGpt6Series = lowerModel.startsWith('gpt-6');
  const isGpt6Luna =
    lowerModel === 'gpt-6-luna' || lowerModel.startsWith('gpt-6-luna-');

  const body: Record<string, unknown> = {
    model: resolvedModel,
    messages: options.messages,
  };

  if (options.responseFormat) {
    body.response_format = options.responseFormat;
  }

  if (isGpt6Series) {
    // GPT-6 series enables reasoning mode by default and rejects temperature;
    // use max_completion_tokens instead of max_tokens.
    body.max_completion_tokens = options.maxTokens;
    if (isGpt6Luna) {
      body.reasoning_effort = 'none';
    }
  } else {
    body.temperature = options.legacyTemperature;
    body.max_tokens = options.maxTokens;
  }

  return body;
}

export class OpenAIProvider implements AIProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: OpenAIProviderOptions) {
    this.apiKey = options.apiKey.trim();
    this.model = normalizeOpenAIModel(options.model ?? DEFAULT_OPENAI_MODEL);
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_AI_TIMEOUT_MS;
  }

  async generateProposal(
    context: GenerateProposalContext,
  ): Promise<AIProviderResult> {
    if (!this.apiKey) {
      throw new Error('尚未設定 OpenAI API Key，請前往設定輸入金鑰。');
    }

    validateAttachmentsBeforeSend(context.attachments);

    const imageParts = (context.attachments ?? [])
      .filter((att) => isImageMimeType(att.mimeType) && Boolean(att.base64Data))
      .map((att) => ({
        type: 'image_url' as const,
        image_url: {
          url: `data:${att.mimeType};base64,${att.base64Data}`,
        },
      }));

    const userPrompt = buildProposalUserPrompt(context);
    const userContent =
      imageParts.length > 0
        ? [{ type: 'text' as const, text: userPrompt }, ...imageParts]
        : userPrompt;

    const requestBody = buildOpenAIChatRequestBody({
      model: this.model,
      responseFormat: { type: 'json_object' },
      legacyTemperature: 0.2,
      maxTokens: 2048,
      messages: [
        {
          role: 'system',
          content: buildProposalSystemInstruction(),
        },
        {
          role: 'user',
          content: userContent,
        },
      ],
    });

    const response = await fetchWithTimeout(
      this.fetchImpl,
      'https://api.openai.com/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(requestBody),
      },
      {
        providerName: 'OpenAI',
        apiKey: this.apiKey,
        timeoutMs: this.timeoutMs,
      },
    );

    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      const readable = extractReadableApiErrorMessage(
        response.status,
        bodyText,
        'OpenAI',
      );
      throw new Error(sanitizeSecretFromText(readable, this.apiKey));
    }

    let payload: OpenAIChatCompletionResponse;
    try {
      payload = (await response.json()) as OpenAIChatCompletionResponse;
    } catch {
      throw new Error('OpenAI 回應內容無法解析為 JSON。');
    }

    const rawText = payload.choices?.[0]?.message?.content ?? '';
    if (!rawText.trim()) {
      throw new Error('OpenAI 未回傳任何有效提案內容。');
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
      throw new Error('尚未設定 OpenAI API Key，請前往設定輸入金鑰。');
    }

    const requestBody = buildOpenAIChatRequestBody({
      model: this.model,
      legacyTemperature: 0.3,
      maxTokens: 512,
      messages: [
        {
          role: 'user',
          content: buildExplainProposalPrompt(change, context),
        },
      ],
    });

    try {
      const response = await fetchWithTimeout(
        this.fetchImpl,
        'https://api.openai.com/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(requestBody),
        },
        {
          providerName: 'OpenAI',
          apiKey: this.apiKey,
          timeoutMs: this.timeoutMs,
        },
      );

      if (!response.ok) {
        const bodyText = await response.text().catch(() => '');
        const readable = extractReadableApiErrorMessage(
          response.status,
          bodyText,
          'OpenAI',
        );
        throw new Error(sanitizeSecretFromText(readable, this.apiKey));
      }

      const payload = (await response.json()) as OpenAIChatCompletionResponse;
      const text = payload.choices?.[0]?.message?.content?.trim() ?? '';
      return text || change.reason || '建議依照此時段調整學習規劃。';
    } catch (error) {
      const msg = error instanceof Error ? error.message : '說明生成失敗';
      throw new Error(sanitizeSecretFromText(msg, this.apiKey));
    }
  }
}
