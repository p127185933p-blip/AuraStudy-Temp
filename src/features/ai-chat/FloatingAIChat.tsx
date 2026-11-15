import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { LayoutGroup, motion } from 'framer-motion';
import {
  AlertCircle,
  ChevronDown,
  KeyRound,
  Lightbulb,
  Paperclip,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import { LiquidButton } from '@/components/ui/LiquidGlass';
import type { RequestAIProposalOutput } from '@/application/commands';
import type {
  ChatAttachmentMetadata,
  ChatMessage,
  ProposalResult,
} from '@/application/services';
import { getProposalEffectiveItem, type ProposalChange } from '@/domain/proposals';
import {
  ATTACHMENT_FILE_ACCEPT,
  isImageMimeType,
  validateAttachmentCandidate,
} from '@/shared/utils';
import { LIQUID_SPRING_BOUNCY, LIQUID_SPRING_MORPH } from '@/styles/motion';

const isTestEnv = import.meta.env.MODE === 'test';

export interface FloatingAIChatProps {
  messages: readonly ChatMessage[];
  lastRejectedProposal: ProposalChange | null;
  isGenerating: boolean;
  isProviderConfigured?: boolean;
  providerLabel?: string;
  onOpenSettings?: () => void;
  onClearChat?: () => void;
  onSendMessage: (
    message: string,
    attachments?: readonly ChatAttachmentMetadata[],
  ) => Promise<ProposalResult<RequestAIProposalOutput>>;
}

const SAMPLE_PROMPTS = [
  '安排明天下午讀書',
  '新增後天作業截止',
  '調整今日行程',
] as const;

async function readFileAsBase64(file: File): Promise<string | undefined> {
  if (typeof FileReader === 'undefined') {
    return undefined;
  }
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const commaIdx = result.indexOf(',');
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : undefined);
    };
    reader.onerror = () => resolve(undefined);
    reader.readAsDataURL(file);
  });
}

async function readFileAsText(file: File): Promise<string | undefined> {
  if (typeof file.text === 'function') {
    try {
      return await file.text();
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function FloatingAIChat({
  messages,
  lastRejectedProposal,
  isGenerating,
  isProviderConfigured = true,
  providerLabel = 'AI',
  onOpenSettings,
  onClearChat,
  onSendMessage,
}: FloatingAIChatProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isContentFadingOut, setIsContentFadingOut] = useState(false);
  const [inputText, setInputText] = useState('');
  const [attachments, setAttachments] = useState<ChatAttachmentMetadata[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const collapseTimerRef = useRef<number | null>(null);

  const isLocked = !isProviderConfigured;

  useEffect(() => {
    return () => {
      if (collapseTimerRef.current !== null) {
        window.clearTimeout(collapseTimerRef.current);
      }
    };
  }, []);

  function handleExpand() {
    if (collapseTimerRef.current !== null) {
      window.clearTimeout(collapseTimerRef.current);
      collapseTimerRef.current = null;
    }
    setIsContentFadingOut(false);
    setIsExpanded(true);
  }

  function handleCollapse() {
    if (isTestEnv) {
      setIsContentFadingOut(false);
      setIsExpanded(false);
      return;
    }
    if (isContentFadingOut) return;
    setIsContentFadingOut(true);
    collapseTimerRef.current = window.setTimeout(() => {
      collapseTimerRef.current = null;
      setIsExpanded(false);
      setIsContentFadingOut(false);
    }, 80);
  }

  async function submitPrompt(text: string) {
    if (isLocked || isGenerating) return;
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0) return;

    const currentAttachments = [...attachments];
    setInputText('');
    setAttachments([]);
    setAttachmentError(null);
    handleExpand();

    await onSendMessage(trimmed, currentAttachments);
  }

  function handleFormSubmit(event: FormEvent) {
    event.preventDefault();
    void submitPrompt(inputText);
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setAttachmentError(null);
    const accepted: ChatAttachmentMetadata[] = [];
    const errors: string[] = [];

    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const check = validateAttachmentCandidate({
        name: file.name,
        mimeType: file.type,
        size: file.size,
      });

      if (!check.ok) {
        errors.push(check.reason);
        continue;
      }

      const isImage = isImageMimeType(check.normalizedMimeType);
      const base64Data = isImage ? await readFileAsBase64(file) : undefined;
      const textContent = !isImage ? await readFileAsText(file) : undefined;

      accepted.push({
        id: `att-${Date.now()}-${index}`,
        name: file.name,
        mimeType: check.normalizedMimeType,
        size: file.size,
        ...(base64Data ? { base64Data } : {}),
        ...(textContent !== undefined ? { textContent } : {}),
      });
    }

    if (accepted.length > 0) {
      setAttachments((prev) => [...prev, ...accepted]);
    }
    if (errors.length > 0) {
      setAttachmentError(errors.join(' '));
    }

    event.target.value = '';
  }

  const rejectedTitle = lastRejectedProposal
    ? getProposalEffectiveItem(lastRejectedProposal).title
    : null;

  const lockedBanner = isLocked ? (
    <div
      data-testid="ai-chat-locked-banner"
      className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] px-3.5 py-2.5"
    >
      <div className="flex items-center gap-2 text-[length:var(--text-xs)] font-bold text-[var(--color-text-secondary)]">
        <KeyRound className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span>
          尚未設定 {providerLabel} API Key，對話功能已暫時鎖定。
        </span>
      </div>
      {onOpenSettings && (
        <LiquidButton
          onClick={onOpenSettings}
          className="min-h-[36px] rounded-[var(--radius-sm)] border border-[var(--color-accent-primary)] bg-[var(--color-accent-primary)] px-3 text-[length:var(--text-xs)] font-bold text-[var(--color-text-inverse)] hover:bg-[var(--color-accent-primary-hover)] whitespace-nowrap"
        >
          <span className="relative z-10">前往設定 API Key</span>
        </LiquidButton>
      )}
    </div>
  ) : null;

  const compactForm = (
    <form
      onSubmit={handleFormSubmit}
      className="flex items-center gap-1.5 px-2.5 py-2 sm:px-3"
    >
      {isExpanded && (
        <LiquidButton
          sheen={false}
          aria-label="收合對話"
          aria-expanded={true}
          onClick={handleCollapse}
          className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-[var(--radius-md)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]"
        >
          <ChevronDown className="h-5 w-5" aria-hidden="true" />
        </LiquidButton>
      )}

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={ATTACHMENT_FILE_ACCEPT}
        disabled={isLocked}
        onChange={(e) => void handleFileChange(e)}
        className="hidden"
        aria-label="選擇附件檔案"
      />

      <LiquidButton
        sheen={false}
        disabled={isLocked}
        aria-label="附加檔案或圖片"
        onClick={() => fileInputRef.current?.click()}
        className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-[var(--radius-md)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Paperclip className="h-5 w-5" aria-hidden="true" />
      </LiquidButton>

      <input
        type="text"
        value={inputText}
        disabled={isLocked}
        onChange={(e) => setInputText(e.target.value)}
        aria-label="輸入學習規劃指令"
        placeholder={
          isLocked
            ? `請先於設定中輸入 ${providerLabel} API Key...`
            : '輸入指令（如：安排明天下午讀書）...'
        }
        className="min-h-[44px] flex-1 min-w-0 bg-transparent px-1.5 text-[length:var(--text-sm)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none disabled:cursor-not-allowed"
      />

      <LiquidButton
        type="submit"
        disabled={
          isLocked ||
          isGenerating ||
          (!inputText.trim() && attachments.length === 0)
        }
        aria-label="送出規劃指令"
        className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-accent-primary)] text-[var(--color-text-inverse)] shadow-sm hover:bg-[var(--color-accent-primary-hover)] disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Send className="relative z-10 h-4 w-4" aria-hidden="true" />
      </LiquidButton>
    </form>
  );

  return (
    <LayoutGroup id="floating-ai-morph">
      <aside
        aria-label="AI 排程協作對話框"
        data-testid="floating-ai-chat"
        data-disabled={isLocked ? 'true' : 'false'}
        className={
          isExpanded
            ? 'floating-ai-safe-bottom fixed left-1/2 z-[var(--z-modal)] w-[calc(100%-1.25rem)] max-w-2xl -translate-x-1/2'
            : 'floating-ai-safe-bottom fixed right-4 z-[var(--z-floating-ai)] sm:right-6'
        }
      >
        {/* Collapsed State: Bottom-Right Liquid Glass Glowing Orb (z-30) */}
        {!isExpanded ? (
          <div className="relative flex items-center justify-end">
            {/* Keep locked banner & input accessible for assistive tech and existing automated tests */}
            <div className="sr-only">
              {lockedBanner}
              {attachmentError && (
                <div role="alert" data-testid="chat-attachment-error">
                  {attachmentError}
                </div>
              )}
              {rejectedTitle && !isLocked && (
                <div>剛拒絕「{rejectedTitle}」— 可直接輸入新時間接續調整</div>
              )}
              {compactForm}
            </div>

            <motion.div
              key="ai-orb-shell"
              layoutId="ai-orb-morph-shell"
              transition={LIQUID_SPRING_MORPH}
              transformTemplate={(_, generated) =>
                generated && generated !== 'none'
                  ? `${generated} translateZ(0)`
                  : 'translateZ(0)'
              }
              style={{
                borderRadius: isExpanded ? 28 : 9999,
                contain: 'layout style',
                boxShadow: 'var(--glass-orb-shadow)',
              }}
              className="relative h-14 w-14 overflow-hidden sm:h-15 sm:w-15"
            >
              <span
                aria-hidden="true"
                className="liquid-ai-orb pointer-events-none absolute inset-0 z-0 rounded-[inherit]"
                style={{
                  boxShadow:
                    'inset 0 1.5px 2px rgba(255, 255, 255, 0.8), inset 0 -4px 10px rgba(15, 23, 42, 0.18)',
                  transform: 'translateZ(0)',
                }}
              />
              <motion.button
                type="button"
                aria-label="展開對話"
                aria-expanded={false}
                onClick={handleExpand}
                whileHover={{ scale: 1.06 }}
                whileTap={{ scale: 0.92 }}
                transition={LIQUID_SPRING_BOUNCY}
                className="group relative flex h-full w-full items-center justify-center rounded-full text-[var(--color-accent-primary)] focus-visible:outline-none"
                title="開啟 AI 學習規劃助手"
              >
                {/* 1. Inner Aurora Core Breathing Glow */}
                <motion.span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-1.5 rounded-full"
                  style={{
                    background:
                      'radial-gradient(circle at 46% 44%, rgba(251, 191, 134, 0.48) 0%, rgba(96, 165, 250, 0.34) 54%, transparent 78%)',
                  }}
                  animate={
                    isTestEnv
                      ? undefined
                      : {
                          opacity: [0.65, 0.95, 0.65],
                          scale: [0.94, 1.06, 0.94],
                        }
                  }
                  transition={
                    isTestEnv
                      ? undefined
                      : {
                          duration: 4.2,
                          repeat: Infinity,
                          ease: 'easeInOut',
                        }
                  }
                />

                {/* 2. Top-Left Crescent Specular Catchlight & Bottom-Right Caustic Rim */}
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute left-1.5 top-1 h-4 w-7 -rotate-24 rounded-full blur-[0.5px]"
                  style={{
                    background:
                      'linear-gradient(155deg, rgba(255, 255, 255, 0.9) 0%, rgba(255, 255, 255, 0.34) 48%, transparent 80%)',
                  }}
                />
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute bottom-1.5 right-2 h-2.5 w-4 -rotate-24 rounded-full bg-white/30 blur-[1px]"
                />

                <Lightbulb
                  className={`relative z-10 h-6 w-6 transition-transform duration-200 group-hover:scale-110 ${
                    isGenerating ? 'animate-pulse text-[var(--color-deadline-accent)]' : ''
                  }`}
                  aria-hidden="true"
                />

                {isLocked && (
                  <span
                    aria-hidden="true"
                    className="absolute right-0.5 top-0.5 z-20 flex h-4.5 w-4.5 items-center justify-center rounded-full border border-white/80 bg-[var(--color-deadline-accent)] text-white shadow-sm"
                  >
                    <KeyRound className="h-2.5 w-2.5" />
                  </span>
                )}
              </motion.button>
            </motion.div>
          </div>
        ) : (
          /* Expanded State: Critically Damped Shared-Element Container Transform into Layer-3 Glass Sheet */
          <motion.div
            key="ai-chat-panel"
            layoutId="ai-orb-morph-shell"
            transition={LIQUID_SPRING_MORPH}
            transformTemplate={(_, generated) =>
              generated && generated !== 'none'
                ? `${generated} translateZ(0)`
                : 'translateZ(0)'
            }
            style={{
              borderRadius: isExpanded ? 28 : 9999,
              contain: 'layout style',
              boxShadow: 'var(--glass-layer-3-shadow)',
            }}
            className={`relative overflow-hidden ${
              isLocked ? 'text-[var(--color-text-muted)]' : ''
            }`}
          >
            <div
              aria-hidden="true"
              className="glass-layer-3 pointer-events-none absolute inset-0 z-0 rounded-[inherit]"
              style={{ boxShadow: 'none', transform: 'translateZ(0)' }}
            />
            {/* Anti-Stretch Crossfade: 60ms delayed fade-in on expand, 80ms fast fade-out on collapse */}
            <motion.div
              initial={isTestEnv ? false : { opacity: 0 }}
              animate={{ opacity: isContentFadingOut ? 0 : 1 }}
              transition={
                isTestEnv
                  ? { duration: 0 }
                  : isContentFadingOut
                    ? { duration: 0.08, ease: [0.4, 0, 1, 1] }
                    : { delay: 0.06, duration: 0.18, ease: [0.16, 1, 0.3, 1] }
              }
              className="relative z-10"
            >
              {lockedBanner}

            <div
              data-testid="ai-chat-expanded-body"
              className="border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)]/55 px-4 py-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[length:var(--text-xs)] font-bold text-[var(--color-text-secondary)]">
                  AI 學習規劃助手（{providerLabel} · 僅產生待確認提案）
                </span>
                <div className="flex shrink-0 items-center gap-1">
                  {onClearChat && (
                    <LiquidButton
                      glassLayer={1}
                      disabled={messages.length === 0 && !lastRejectedProposal}
                      onClick={() => {
                        setAttachments([]);
                        setAttachmentError(null);
                        onClearChat();
                      }}
                      className="inline-flex min-h-[34px] items-center gap-1 rounded-[var(--radius-sm)] px-2.5 text-[length:var(--text-xs)] font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      <Trash2 className="relative z-10 h-3.5 w-3.5" aria-hidden="true" />
                      <span className="relative z-10">清空對話</span>
                    </LiquidButton>
                  )}
                  <button
                    type="button"
                    aria-label="收合對話視窗"
                    onClick={handleCollapse}
                    className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]"
                  >
                    <ChevronDown className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </div>

              {/* Recent Messages */}
              {messages.length > 0 && (
                <div className="mt-2.5 max-h-[45dvh] space-y-2 overflow-y-auto pr-1 sm:max-h-64">
                  {messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`rounded-[var(--radius-md)] px-3 py-2 text-[length:var(--text-sm)] [overflow-wrap:anywhere] [word-break:break-word] ${
                        msg.role === 'user'
                          ? 'ml-4 bg-[var(--color-accent-primary)] font-medium text-[var(--color-text-inverse)] shadow-sm sm:ml-8'
                          : 'glass-layer-2 mr-2 text-[var(--color-text-primary)] sm:mr-8'
                      }`}
                    >
                      <p className="whitespace-pre-wrap [overflow-wrap:anywhere] [word-break:break-word]">
                        {msg.content}
                      </p>
                      {msg.attachments && msg.attachments.length > 0 && (
                        <p className="mt-1 text-[length:var(--text-xs)] opacity-85 [overflow-wrap:anywhere]">
                          附件：{msg.attachments.map((a) => a.name).join('、')}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Quick Sample Prompt Chips */}
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {SAMPLE_PROMPTS.map((sample) => (
                  <LiquidButton
                    key={sample}
                    glassLayer={1}
                    disabled={isLocked || isGenerating}
                    onClick={() => void submitPrompt(sample)}
                    className="min-h-[36px] rounded-[var(--radius-sm)] px-2.5 text-[length:var(--text-xs)] font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap"
                  >
                    <span className="relative z-10">{sample}</span>
                  </LiquidButton>
                ))}
              </div>
            </div>

            {/* Attachment Validation Error Banner */}
            {attachmentError && (
              <div
                role="alert"
                data-testid="chat-attachment-error"
                className="flex items-center justify-between gap-2 border-b border-[var(--color-danger-border)] bg-[var(--color-danger-surface)] px-3.5 py-2 text-[length:var(--text-xs)] font-semibold text-[var(--color-danger-text)]"
              >
                <div className="flex min-w-0 flex-1 items-start gap-1.5">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 flex-1 [overflow-wrap:anywhere] [word-break:break-word]">
                    {attachmentError}
                  </span>
                </div>
                <button
                  type="button"
                  aria-label="關閉附件錯誤訊息"
                  onClick={() => setAttachmentError(null)}
                  className="shrink-0"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            )}

            {/* Attachment Preview Chips */}
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-1.5 border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] px-3.5 py-2">
                {attachments.map((att) => (
                  <span
                    key={att.id}
                    className="glass-layer-1 inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-1 text-[length:var(--text-xs)] font-semibold text-[var(--color-text-primary)]"
                  >
                    <span className="max-w-[140px] truncate">{att.name}</span>
                    <button
                      type="button"
                      aria-label={`移除附件 ${att.name}`}
                      onClick={() =>
                        setAttachments((prev) => prev.filter((a) => a.id !== att.id))
                      }
                      className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* Subtle continuity hint right after pressing × */}
            {rejectedTitle && !isLocked && (
              <div className="border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] px-3.5 py-1.5 text-[length:var(--text-xs)] font-medium text-[var(--color-text-secondary)]">
                剛拒絕「{rejectedTitle}」— 可直接輸入新時間接續調整
              </div>
            )}

              {compactForm}
            </motion.div>
          </motion.div>
        )}
      </aside>
    </LayoutGroup>
  );
}
