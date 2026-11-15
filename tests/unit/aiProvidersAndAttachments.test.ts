import { describe, expect, it, vi } from 'vitest';
import { requestAIProposal } from '@/application/commands';
import {
  DEFAULT_OPENAI_MODEL,
  GeminiAIProvider,
  OpenAIProvider,
  deleteStoredApiKeyEntry,
  getActiveStoredApiKeyId,
  getStoredApiKey,
  getStoredApiKeyEntries,
  getStoredOpenAIModel,
  maskApiKey,
  renameStoredApiKey,
  sanitizeSecretFromText,
  saveStoredApiKey,
  setActiveStoredApiKey,
} from '@/infrastructure/ai';
import {
  InMemoryCalendarRepository,
  InMemoryDecisionLogRepository,
  InMemoryProposalRepository,
} from '@/infrastructure/repositories';
import {
  MAX_ATTACHMENT_SIZE_BYTES,
  validateAttachmentCandidate,
} from '@/shared/utils';

const BASE_CONTEXT = {
  userId: 'user-1',
  timeZone: 'Asia/Taipei',
  selectedDate: '2026-11-13',
  userMessage: '幫我安排明天下午 2 點到 4 點複習線性代數',
  currentItems: [],
  recentMessages: [],
  rejectedProposals: [],
  recentDecisions: [],
};

describe('Phase 4 AI Providers (mocked fetch) & Attachment Validation', () => {
  it('GeminiAIProvider assembles valid request, parses JSON, and passes Zod validation', async () => {
    const secretKey = 'AIzaSyTestSecretKeyValue123456';
    const mockFetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      assistantMessage: '已為您規劃明天下午線性代數複習時段。',
                      changes: [
                        {
                          action: 'create',
                          reason: '配合您的要求安排 2 小時專注時段。',
                          after: {
                            id: 'sched-gemini-1',
                            userId: 'user-1',
                            type: 'schedule',
                            title: '線性代數複習',
                            startAt: '2026-11-14T14:00:00+08:00',
                            endAt: '2026-11-14T16:00:00+08:00',
                            revision: 1,
                            status: 'scheduled',
                            createdAt: '2026-11-13T10:00:00Z',
                            updatedAt: '2026-11-13T10:00:00Z',
                          },
                        },
                      ],
                    }),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const provider = new GeminiAIProvider({
      apiKey: secretKey,
      fetchImpl: mockFetch,
    });

    const result = await provider.generateProposal({
      ...BASE_CONTEXT,
      attachments: [
        {
          id: 'att-img',
          name: 'syllabus.png',
          mimeType: 'image/png',
          size: 1024,
          base64Data: 'iVBORw0KGgoAAAANSUhEUg==',
        },
      ],
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = (mockFetch as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit];
    expect(url).toContain('models/gemini-4-hydrogen:generateContent');
    expect(url).not.toContain(secretKey);
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe(
      secretKey,
    );

    const parsedBody = JSON.parse(init.body as string) as {
      contents: Array<{ parts: Array<Record<string, unknown>> }>;
    };
    expect(parsedBody.contents[0].parts).toHaveLength(2);
    expect(parsedBody.contents[0].parts[1]).toEqual({
      inlineData: {
        mimeType: 'image/png',
        data: 'iVBORw0KGgoAAAANSUhEUg==',
      },
    });

    expect(result.assistantMessage).toBe('已為您規劃明天下午線性代數複習時段。');
    expect(result.rawChanges).toHaveLength(1);
  });

  it('OpenAIProvider assembles valid request, parses JSON, and passes Zod validation', async () => {
    const secretKey = 'sk-proj-testOpenAISecretKey987654';
    const mockFetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  assistantMessage: '已建立作業截止提案。',
                  changes: [
                    {
                      action: 'create',
                      reason: '根據課程大綱加入作業截止日。',
                      after: {
                        id: 'dl-openai-1',
                        userId: 'user-1',
                        type: 'deadline',
                        title: '計組實驗報告繳交',
                        dueDate: '2026-11-16',
                        revision: 1,
                        status: 'pending',
                        createdAt: '2026-11-13T10:00:00Z',
                        updatedAt: '2026-11-13T10:00:00Z',
                      },
                    },
                  ],
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const provider = new OpenAIProvider({
      apiKey: secretKey,
      fetchImpl: mockFetch,
    });

    const result = await provider.generateProposal(BASE_CONTEXT);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = (mockFetch as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${secretKey}`,
    );
    expect(result.rawChanges).toHaveLength(1);
  });

  it('rejects malformed JSON and invalid Schedule semantics from AI providers without mutating repos', async () => {
    const malformedFetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: '這不是合法的 JSON 結構 {{{' }],
              },
            },
          ],
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const gemini = new GeminiAIProvider({
      apiKey: 'AIzaSyMockKey1234567890',
      fetchImpl: malformedFetch,
    });

    await expect(gemini.generateProposal(BASE_CONTEXT)).rejects.toThrow(
      /JSON/,
    );

    const invalidScheduleFetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  assistantMessage: '無效時段',
                  changes: [
                    {
                      action: 'create',
                      after: {
                        id: 'bad-sched',
                        userId: 'user-1',
                        type: 'schedule',
                        title: '結束早於開始',
                        startAt: '2026-11-14T16:00:00+08:00',
                        endAt: '2026-11-14T14:00:00+08:00',
                        revision: 1,
                        createdAt: '2026-11-13T10:00:00Z',
                        updatedAt: '2026-11-13T10:00:00Z',
                      },
                    },
                  ],
                }),
              },
            },
          ],
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const calendarRepo = new InMemoryCalendarRepository();
    const proposalRepo = new InMemoryProposalRepository();
    const logRepo = new InMemoryDecisionLogRepository();
    const openai = new OpenAIProvider({
      apiKey: 'sk-proj-mockKey1234567890',
      fetchImpl: invalidScheduleFetch,
    });

    const appResult = await requestAIProposal(
      {
        calendarRepository: calendarRepo,
        proposalRepository: proposalRepo,
        decisionLogRepository: logRepo,
        aiProvider: openai,
      },
      {
        userId: 'user-1',
        timeZone: 'Asia/Taipei',
        selectedDate: '2026-11-13',
        userMessage: '排程測試',
      },
    );

    expect(appResult.ok).toBe(false);
    expect(await calendarRepo.listByUser('user-1')).toHaveLength(0);
    expect(await proposalRepo.listAll()).toHaveLength(0);
  });

  it('never leaks API keys in thrown HTTP/network errors', async () => {
    const geminiKey = 'AIzaSyUltraSecretLeakedInBody123456';
    const openaiKey = 'sk-proj-UltraSecretOpenAIKey123456';

    const leakingErrorFetch = vi.fn(async () => {
      return new Response(
        `Authentication failed for key ${geminiKey} and ${openaiKey}`,
        { status: 500 },
      );
    }) as unknown as typeof fetch;

    const gemini = new GeminiAIProvider({
      apiKey: geminiKey,
      fetchImpl: leakingErrorFetch,
    });

    let caughtMessage = '';
    try {
      await gemini.generateProposal(BASE_CONTEXT);
    } catch (error) {
      caughtMessage = error instanceof Error ? error.message : String(error);
    }

    expect(caughtMessage).toContain('HTTP 500');
    expect(caughtMessage).not.toContain(geminiKey);
    expect(caughtMessage).not.toContain(openaiKey);

    const scrubbed = sanitizeSecretFromText(
      `Error with ${openaiKey} and ${encodeURIComponent(geminiKey)}`,
      geminiKey,
    );
    expect(scrubbed).not.toContain(geminiKey);
    expect(scrubbed).not.toContain(openaiKey);
  });

  it('enforces attachment 5MB size limit and allowed MIME whitelist', () => {
    const oversized = validateAttachmentCandidate({
      name: 'huge-photo.png',
      mimeType: 'image/png',
      size: MAX_ATTACHMENT_SIZE_BYTES + 1,
    });
    expect(oversized.ok).toBe(false);

    const badMimePdf = validateAttachmentCandidate({
      name: 'syllabus.pdf',
      mimeType: 'application/pdf',
      size: 2048,
    });
    expect(badMimePdf.ok).toBe(false);

    const badMimeExe = validateAttachmentCandidate({
      name: 'malware.exe',
      mimeType: 'application/x-msdownload',
      size: 512,
    });
    expect(badMimeExe.ok).toBe(false);

    const validImage = validateAttachmentCandidate({
      name: 'notes.webp',
      mimeType: 'image/webp',
      size: 1024 * 500,
    });
    expect(validImage).toEqual({
      ok: true,
      normalizedMimeType: 'image/webp',
    });

    const validMarkdown = validateAttachmentCandidate({
      name: 'study-plan.md',
      mimeType: '',
      size: 1024,
    });
    expect(validMarkdown).toEqual({
      ok: true,
      normalizedMimeType: 'text/markdown',
    });
  });

  it('normalizes noisy LLM responses (prose + markdown fence + null fields + naive datetimes + missing create defaults) and passes strict Zod & domain validation', async () => {
    const noisyRawText = [
      '沒問題！以下是我為您規劃的學習提案：',
      '```json',
      JSON.stringify({
        assistantMessage: '已安排明天上午演算法精讀與專題截止提醒。',
        changes: [
          {
            id: null,
            action: 'create',
            targetItemId: null,
            before: null,
            baseRevision: null,
            reason: '上午精神較佳，適合進行演算法練習。',
            after: {
              type: 'schedule',
              title: '演算法動態規劃精讀',
              startAt: '2026-11-14T10:00:00',
              endAt: '2026-11-14T12:00:00',
              description: null,
              tag: null,
              status: 'scheduled',
            },
          },
          {
            action: 'create',
            targetItemId: null,
            before: null,
            baseRevision: null,
            reason: null,
            after: {
              type: 'deadline',
              title: '作業系統實驗報告',
              dueDate: '2026-11-18T23:59:00',
              description: null,
              tag: 'OS',
              status: null,
            },
          },
        ],
      }),
      '```',
      '請確認後點擊綠色打勾套用。',
    ].join('\n');

    const noisyFetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: noisyRawText }],
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const gemini = new GeminiAIProvider({
      apiKey: 'AIzaSyNoisyResponseTestKey123456',
      fetchImpl: noisyFetch,
    });

    const calendarRepo = new InMemoryCalendarRepository();
    const proposalRepo = new InMemoryProposalRepository();
    const logRepo = new InMemoryDecisionLogRepository();

    const result = await requestAIProposal(
      {
        calendarRepository: calendarRepo,
        proposalRepository: proposalRepo,
        decisionLogRepository: logRepo,
        aiProvider: gemini,
      },
      {
        userId: 'student-taipei',
        timeZone: 'Asia/Taipei',
        selectedDate: '2026-11-13',
        userMessage: '幫我安排明天上午讀演算法',
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.changes).toHaveLength(2);

    const scheduleChange = result.data.changes[0];
    expect(scheduleChange.action).toBe('create');
    expect(scheduleChange.after?.type).toBe('schedule');
    if (scheduleChange.after?.type === 'schedule') {
      expect(scheduleChange.after.userId).toBe('student-taipei');
      expect(scheduleChange.after.revision).toBe(1);
      expect(scheduleChange.after.startAt).toBe('2026-11-14T10:00:00+08:00');
      expect(scheduleChange.after.endAt).toBe('2026-11-14T12:00:00+08:00');
      expect(scheduleChange.after.tag).toBeUndefined();
      expect(scheduleChange.after.description).toBeUndefined();
    }

    const deadlineChange = result.data.changes[1];
    if (deadlineChange.after?.type === 'deadline') {
      expect(deadlineChange.after.dueDate).toBe('2026-11-18T23:59:00+08:00');
      expect(deadlineChange.after.tag).toBe('OS');
    }
  });

  it('still rejects invalid Schedule logic (endAt <= startAt) even after normalization and handles AbortController timeout', async () => {
    const invalidNaiveFetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  '```json\n' +
                  JSON.stringify({
                    assistantMessage: '無效時段測試',
                    changes: [
                      {
                        action: 'create',
                        targetItemId: null,
                        after: {
                          type: 'schedule',
                          title: '無效時間順序',
                          startAt: '2026-11-14T15:00:00',
                          endAt: '2026-11-14T14:00:00',
                        },
                      },
                    ],
                  }) +
                  '\n```',
              },
            },
          ],
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const openaiInvalid = new OpenAIProvider({
      apiKey: 'sk-proj-testInvalidOrder123456',
      fetchImpl: invalidNaiveFetch,
    });
    await expect(openaiInvalid.generateProposal(BASE_CONTEXT)).rejects.toThrow(
      /endAt must be strictly after startAt/,
    );

    const hangingFetch = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const abortErr = new Error('The operation was aborted.');
          abortErr.name = 'AbortError';
          reject(abortErr);
        });
      });
    }) as unknown as typeof fetch;

    const openaiTimeout = new OpenAIProvider({
      apiKey: 'sk-proj-testTimeoutKey123456',
      fetchImpl: hangingFetch,
      timeoutMs: 25,
    });

    await expect(openaiTimeout.generateProposal(BASE_CONTEXT)).rejects.toThrow(
      /連線逾時/,
    );
  });

  it('supports switching custom Gemini model (gemini-3.8-flash) and extracts full readable HTTP 404 JSON error (>300 chars) without leaking secrets', async () => {
    const secretKey = 'AIzaSyCustomModelSecretKey987654';
    const customModelFetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      assistantMessage: '已使用自訂模型完成規劃。',
                      changes: [],
                    }),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const customGemini = new GeminiAIProvider({
      apiKey: secretKey,
      model: 'gemini-3.8-flash',
      fetchImpl: customModelFetch,
    });

    const customResult = await customGemini.generateProposal(BASE_CONTEXT);
    expect(customResult.assistantMessage).toBe('已使用自訂模型完成規劃。');
    const [customUrl] = (
      customModelFetch as unknown as ReturnType<typeof vi.fn>
    ).mock.calls[0] as [string];
    expect(customUrl).toContain('models/gemini-3.8-flash:generateContent');

    const longDetailedMessage =
      `models/gemini-4-hydrogen is not found for API version v1beta, or is not supported for generateContent. ` +
      `Please call ListModels to see the list of available models and their supported methods in your region. ` +
      `Verify that your project billing status and model availability match your request key ${secretKey} before retrying this operation on mobile.`;
    expect(longDetailedMessage.length).toBeGreaterThan(300);

    const notFoundFetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          error: {
            code: 404,
            message: longDetailedMessage,
            status: 'NOT_FOUND',
          },
        }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const failingGemini = new GeminiAIProvider({
      apiKey: secretKey,
      fetchImpl: notFoundFetch,
    });

    let caught = '';
    try {
      await failingGemini.generateProposal(BASE_CONTEXT);
    } catch (error) {
      caught = error instanceof Error ? error.message : String(error);
    }

    expect(caught).toContain('HTTP 404');
    expect(caught).toContain('ListModels to see the list of available models');
    expect(caught).toContain('before retrying this operation on mobile.');
    expect(caught).not.toContain('"NOT_FOUND"');
    expect(caught).not.toContain(secretKey);
    expect(caught).toContain('[REDACTED]');
    expect(caught.length).toBeGreaterThan(300);
  });

  it('sends reasoning_effort: "none", omits temperature, and uses max_completion_tokens for gpt-6-luna and GPT-6 models', async () => {
    const capturedBodies: Array<Record<string, unknown>> = [];
    const mockFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      capturedBodies.push(JSON.parse(init?.body as string) as Record<string, unknown>);
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  assistantMessage: '已使用 GPT-6 Luna 完成規劃。',
                  changes: [],
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    // Default model should be gpt-6-luna
    const lunaProvider = new OpenAIProvider({
      apiKey: 'sk-proj-testLunaKey123456',
      fetchImpl: mockFetch,
    });
    await lunaProvider.generateProposal(BASE_CONTEXT);
    expect(capturedBodies[0]).toMatchObject({
      model: 'gpt-6-luna',
      reasoning_effort: 'none',
    });
    expect(capturedBodies[0]).toHaveProperty('max_completion_tokens');
    expect(capturedBodies[0]).not.toHaveProperty('temperature');
    expect(capturedBodies[0]).not.toHaveProperty('max_tokens');

    // Explain call on gpt-6-luna also sets reasoning_effort: "none" and omits temperature
    await lunaProvider.explainProposal(
      {
        id: 'chg-explain',
        proposalId: 'prop-explain',
        action: 'create',
        status: 'pending',
        after: {
          id: 'dl-1',
          userId: 'user-1',
          type: 'deadline',
          title: '微積分作業',
          dueDate: '2026-11-20',
          revision: 1,
          createdAt: '2026-11-13T10:00:00Z',
          updatedAt: '2026-11-13T10:00:00Z',
        },
        reason: '提前規劃',
        createdAt: '2026-11-13T10:00:00Z',
        updatedAt: '2026-11-13T10:00:00Z',
      },
      { timeZone: 'Asia/Taipei', currentItems: [] },
    );
    expect(capturedBodies[1]).toMatchObject({
      model: 'gpt-6-luna',
      reasoning_effort: 'none',
    });
    expect(capturedBodies[1]).toHaveProperty('max_completion_tokens');
    expect(capturedBodies[1]).not.toHaveProperty('temperature');
    expect(capturedBodies[1]).not.toHaveProperty('max_tokens');

    // Other GPT-6 variants (gpt-6.1-terra, gpt-6.1-sol, gpt-6-astra) omit temperature & use max_completion_tokens
    const terraProvider = new OpenAIProvider({
      apiKey: 'sk-proj-testTerraKey123456',
      model: 'gpt-6.1-terra',
      fetchImpl: mockFetch,
    });
    await terraProvider.generateProposal(BASE_CONTEXT);
    expect(capturedBodies[2].model).toBe('gpt-6.1-terra');
    expect(capturedBodies[2]).toHaveProperty('max_completion_tokens');
    expect(capturedBodies[2]).not.toHaveProperty('temperature');
    expect(capturedBodies[2]).not.toHaveProperty('reasoning_effort');

    // Legacy gpt-4o-mini passes safely migrate to gpt-6-luna
    const migratedProvider = new OpenAIProvider({
      apiKey: 'sk-proj-testMigrated123456',
      model: 'gpt-4o-mini',
      fetchImpl: mockFetch,
    });
    await migratedProvider.generateProposal(BASE_CONTEXT);
    expect(capturedBodies[3]).toMatchObject({
      model: 'gpt-6-luna',
      reasoning_effort: 'none',
    });
    expect(capturedBodies[3]).not.toHaveProperty('temperature');
  });

  it('supports OpenAI API key aliases, renaming, switching, masking, and seamless legacy migration', () => {
    window.localStorage.clear();
    window.sessionStorage.clear();

    // 1. Legacy plain string OpenAI key & legacy gpt-4o-mini model migrate cleanly
    window.localStorage.setItem('aurastudy.ai.apiKey.openai', 'sk-proj-legacy9988');
    window.localStorage.setItem('aurastudy.ai.openaiModel', 'gpt-4o-mini');
    window.localStorage.setItem('aurastudy.ai.persistLocal', 'true');

    expect(getStoredOpenAIModel()).toBe(DEFAULT_OPENAI_MODEL);
    expect(window.localStorage.getItem('aurastudy.ai.openaiModel')).toBe('gpt-6-luna');

    expect(getStoredApiKey('openai')).toBe('sk-proj-legacy9988');
    const migratedEntries = getStoredApiKeyEntries('openai');
    expect(migratedEntries).toHaveLength(1);
    expect(migratedEntries[0].label).toBe('OpenAI 預設金鑰');
    expect(maskApiKey(migratedEntries[0].apiKey)).toBe('sk-...9988');

    // 2. Rename migrated legacy entry
    const legacyId = migratedEntries[0].id;
    const afterRename = renameStoredApiKey('openai', legacyId, '個人主力帳號', true);
    expect(afterRename[0].label).toBe('個人主力帳號');

    // 3. Add a second key with custom alias -> becomes active automatically
    const afterAddSecond = saveStoredApiKey(
      'openai',
      'sk-proj-clubshared4321',
      true,
      '社團共用額度',
    );
    expect(afterAddSecond).toHaveLength(2);
    expect(getStoredApiKey('openai')).toBe('sk-proj-clubshared4321');
    expect(maskApiKey('sk-proj-clubshared4321')).toBe('sk-...4321');

    // 4. Add a third key with blank alias -> falls back to default alias
    const afterAddThird = saveStoredApiKey('openai', 'sk-proj-backup7777', true, '   ');
    expect(afterAddThird).toHaveLength(3);
    expect(afterAddThird[2].label).toBe('OpenAI 預設金鑰');

    // 5. Switch active key back to the first renamed key
    setActiveStoredApiKey('openai', legacyId, true);
    expect(getActiveStoredApiKeyId('openai')).toBe(legacyId);
    expect(getStoredApiKey('openai')).toBe('sk-proj-legacy9988');

    // 6. Delete active key -> automatically switches active to remaining first key
    const afterDelete = deleteStoredApiKeyEntry('openai', legacyId, true);
    expect(afterDelete).toHaveLength(2);
    expect(getStoredApiKey('openai')).toBe('sk-proj-clubshared4321');
  });
});
