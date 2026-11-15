import type { GenerateProposalContext } from '@/application/services';
import type { ProposalChange } from '@/domain/proposals';
import type { CalendarItem } from '@/domain/schedule';
import { isImageMimeType } from '@/shared/utils';

export function buildProposalSystemInstruction(): string {
  return [
    '你是 AuraStudy 的學習時間規劃助手。你只能產生待使用者確認的結構化提案（ProposalChange），絕對不能假設行程已被寫入。',
    '請務必只回傳單一純 JSON 物件，格式如下：',
    '{ "assistantMessage": "繁體中文簡潔說明", "changes": [ ... ] }',
    '',
    '【嚴格資料模型規範】',
    '1. Deadline（截止事項）與 Schedule（排程時段）嚴格分離，禁止混用欄位：',
    '   - Deadline 必須包含: id (string), userId (string), type: "deadline", title (非空字串), dueDate (YYYY-MM-DD 或含時區 ISO8601), revision: 1, createdAt (ISO8601含時區), updatedAt (ISO8601含時區)；可選 description, tag, status ("pending"|"completed")。不可有 startAt 或 endAt。',
    '   - Schedule 必須包含: id (string), userId (string), type: "schedule", title (非空字串), startAt (ISO8601含時區), endAt (ISO8601含時區且必須 > startAt), revision: 1, createdAt (ISO8601含時區), updatedAt (ISO8601含時區)；可選 description, tag, status ("scheduled"|"completed"|"cancelled")。不可有 dueDate。',
    '2. 每筆 change 必須為以下三種 action 之一：',
    '   - "create": 必須有 after（完整 Deadline 或 Schedule 物件），不可有 targetItemId / before / baseRevision。',
    '   - "update": 必須有 targetItemId, before（從目前行程快照原樣複製）, after（更新後物件，type/id/userId 必須與 before 相同）, baseRevision（必須等於 before.revision）。',
    '   - "delete": 必須有 targetItemId, before（從目前行程快照原樣複製）, baseRevision（必須等於 before.revision），不可有 after。',
    '   - reason (string): 簡潔說明為何提出此變更與衝突考量。',
    '3. 未來時間規範（極為重要）：',
    '   - 嚴禁建議過去的排程時間。所有新增或修改的 Schedule 的 startAt 必須嚴格晚於「目前時間」；所有新增或修改的 Deadline 的 dueDate（於使用者時區）不可早於今天。',
  ].join('\n');
}

export function buildProposalUserPrompt(context: GenerateProposalContext): string {
  const nowIso = new Date().toISOString();
  const textAttachments = (context.attachments ?? [])
    .filter((att) => !isImageMimeType(att.mimeType))
    .map((att) => ({
      name: att.name,
      mimeType: att.mimeType,
      content: att.textContent ? att.textContent.slice(0, 6000) : '[無文字內容預覽]',
    }));

  const recentMessages = context.recentMessages.slice(-8).map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const rejectedSummary = context.rejectedProposals.slice(-5).map((p) => ({
    id: p.id,
    action: p.action,
    targetItemId: p.targetItemId,
    title: (p.after ?? p.before)?.title,
    reason: p.reason,
  }));

  return [
    `目前時間 (UTC ISO): ${nowIso}`,
    `使用者 ID (userId): ${context.userId}`,
    `使用者時區 (timeZone): ${context.timeZone}`,
    `目前時間軸焦點日期 (selectedDate): ${context.selectedDate}`,
    '',
    '目前正式行程 (currentItems):',
    JSON.stringify(context.currentItems),
    '',
    recentMessages.length > 0
      ? `近期對話:\n${JSON.stringify(recentMessages)}\n`
      : '',
    rejectedSummary.length > 0
      ? `使用者最近拒絕的提案 (lastRejectedProposalId=${context.lastRejectedProposalId ?? 'none'}):\n${JSON.stringify(rejectedSummary)}\n`
      : '',
    textAttachments.length > 0
      ? `使用者附加的文字檔案:\n${JSON.stringify(textAttachments)}\n`
      : '',
    `使用者本次請求：${context.userMessage || '請依據附件內容協助規劃學習行程。'}`,
  ]
    .filter(Boolean)
    .join('\n');
}

export function buildExplainProposalPrompt(
  change: ProposalChange,
  context: { timeZone: string; currentItems: readonly CalendarItem[] },
): string {
  return [
    '請以繁體中文在 2 句話內說明此排程提案的調整理由與對現有行程的影響（純文字，不需 JSON）：',
    `時區: ${context.timeZone}`,
    `提案內容: ${JSON.stringify(change)}`,
    `目前正式行程數量: ${context.currentItems.length}`,
  ].join('\n');
}
