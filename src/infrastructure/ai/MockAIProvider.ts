import { detectScheduleConflicts } from '@/domain/planning';
import {
  getProposalEffectiveItem,
  type AIProposedChangeInput,
  type ProposalChange,
} from '@/domain/proposals';
import {
  isDeadline,
  isSchedule,
  type CalendarItem,
  type Schedule,
} from '@/domain/schedule';
import type {
  AIProvider,
  AIProviderResult,
  GenerateProposalContext,
} from '@/application/services';
import {
  buildIsoFromLocalDateTime,
  getDateKeyFromInstant,
  getDayOfWeekFromDateKey,
  getLocalTimeHHmm,
  getMinutesFromMidnight,
  minutesToHHmm,
  shiftDateKey,
} from '@/shared/utils';

let mockIdCounter = 0;

function nextMockItemId(prefix: string): string {
  mockIdCounter += 1;
  return `${prefix}-${Date.now()}-${mockIdCounter}`;
}

function parseTargetDateKey(
  text: string,
  anchorDateKey: string,
): string | null {
  const isoMatch = /(\d{4}-\d{2}-\d{2})/.exec(text);
  if (isoMatch) {
    return isoMatch[1];
  }

  if (text.includes('大後天')) return shiftDateKey(anchorDateKey, 3);
  if (text.includes('後天')) return shiftDateKey(anchorDateKey, 2);
  if (text.includes('明天') || text.includes('明日')) return shiftDateKey(anchorDateKey, 1);
  if (text.includes('今天') || text.includes('今日')) return anchorDateKey;

  const weekdayMap: Record<string, number> = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    日: 0,
    天: 0,
  };
  const weekdayMatch = /(?:下)?(?:週|星期|禮拜)([一二三四五六日天])/.exec(text);
  if (weekdayMatch) {
    const targetDow = weekdayMap[weekdayMatch[1]];
    const currentDow = getDayOfWeekFromDateKey(anchorDateKey);
    const isNextWeek = text.includes(`下${weekdayMatch[0].replace(/^下/, '')}`);
    let delta = (targetDow - currentDow + 7) % 7;
    if (delta === 0 || isNextWeek) {
      delta += 7;
    }
    return shiftDateKey(anchorDateKey, delta);
  }

  return null;
}

function parseTimeWindow(text: string): { startHHmm: string; endHHmm: string } | null {
  // Explicit range like 14:00-16:00 or 14:00 – 16:00
  const rangeMatch = /(\d{1,2}):(\d{2})\s*[-–~到至]\s*(\d{1,2}):(\d{2})/.exec(text);
  if (rangeMatch) {
    const sH = String(Math.min(23, Number(rangeMatch[1]))).padStart(2, '0');
    const sM = String(Math.min(59, Number(rangeMatch[2]))).padStart(2, '0');
    const eH = String(Math.min(23, Number(rangeMatch[3]))).padStart(2, '0');
    const eM = String(Math.min(59, Number(rangeMatch[4]))).padStart(2, '0');
    return { startHHmm: `${sH}:${sM}`, endHHmm: `${eH}:${eM}` };
  }

  // Single HH:mm
  const singleColonMatch = /(\d{1,2}):(\d{2})/.exec(text);
  if (singleColonMatch) {
    let hour = Number(singleColonMatch[1]);
    const minute = Number(singleColonMatch[2]);
    if (text.includes('下午') && hour < 12) hour += 12;
    if (text.includes('晚上') && hour < 12) hour += 12;
    const startMinutes = Math.min(22 * 60, hour * 60 + minute);
    return {
      startHHmm: minutesToHHmm(startMinutes),
      endHHmm: minutesToHHmm(Math.min(23 * 60 + 45, startMinutes + 90)),
    };
  }

  // Chinese hour expression e.g. 下午4點, 早上9點半, 16點
  const zhHourMatch = /(早上|上午|中午|下午|晚上)?\s*(\d{1,2})\s*點(半)?/.exec(text);
  if (zhHourMatch) {
    const period = zhHourMatch[1] ?? '';
    let hour = Number(zhHourMatch[2]);
    const minute = zhHourMatch[3] ? 30 : 0;
    if ((period === '下午' || period === '晚上') && hour < 12) {
      hour += 12;
    } else if (period === '中午' && hour < 11) {
      hour += 12;
    }
    const startMinutes = Math.min(22 * 60, hour * 60 + minute);
    return {
      startHHmm: minutesToHHmm(startMinutes),
      endHHmm: minutesToHHmm(Math.min(23 * 60 + 45, startMinutes + 90)),
    };
  }

  if (text.includes('早上') || text.includes('上午')) {
    return { startHHmm: '09:00', endHHmm: '10:30' };
  }
  if (text.includes('下午')) {
    return { startHHmm: '14:00', endHHmm: '16:00' };
  }
  if (text.includes('晚上')) {
    return { startHHmm: '19:00', endHHmm: '21:00' };
  }

  return null;
}

function findBestMatchingItem(
  text: string,
  items: readonly CalendarItem[],
  timeZone: string,
  preferredDateKey?: string,
): CalendarItem | null {
  const byTitle = items.find((item) => text.includes(item.title));
  if (byTitle) return byTitle;

  const keywords = ['線性代數', '演算法', '計算機', '微積分', '作業', '複習', '練習'];
  for (const kw of keywords) {
    if (text.includes(kw)) {
      const match = items.find((item) => item.title.includes(kw));
      if (match) return match;
    }
  }

  if (preferredDateKey) {
    const onDate = items.find(
      (item) =>
        isSchedule(item) &&
        getDateKeyFromInstant(item.startAt, timeZone) === preferredDateKey,
    );
    if (onDate) return onDate;
  }

  return items.find(isSchedule) ?? items[0] ?? null;
}

function findNonConflictingSlot(
  dateKey: string,
  preferredStartHHmm: string,
  durationMinutes: number,
  currentItems: readonly CalendarItem[],
  timeZone: string,
): { startAt: string; endAt: string } {
  const [hStr, mStr] = preferredStartHHmm.split(':');
  const baseMin = Number(hStr) * 60 + Number(mStr);

  for (let offset = 0; offset <= 8 * 60; offset += 60) {
    const startMin = baseMin + offset;
    const endMin = startMin + durationMinutes;
    if (endMin > 23 * 60 + 30) break;

    const startAt = buildIsoFromLocalDateTime(
      dateKey,
      minutesToHHmm(startMin),
      timeZone,
    );
    const endAt = buildIsoFromLocalDateTime(
      dateKey,
      minutesToHHmm(endMin),
      timeZone,
    );

    const conflicts = detectScheduleConflicts({ startAt, endAt }, currentItems);
    if (!conflicts.hasConflict) {
      return { startAt, endAt };
    }
  }

  const startAt = buildIsoFromLocalDateTime(dateKey, preferredStartHHmm, timeZone);
  const endAt = buildIsoFromLocalDateTime(
    dateKey,
    minutesToHHmm(Math.min(23 * 60 + 45, baseMin + durationMinutes)),
    timeZone,
  );
  return { startAt, endAt };
}

function buildScheduleTitleFromMessage(text: string): string {
  const cleaned = text
    .replace(/^(請|幫我|可以|我要|想|安排|新增|建立)/g, '')
    .replace(/(今天|今日|明天|明日|後天|大後天|早上|上午|下午|晚上|週[一二三四五六日天]|星期[一二三四五六日天])/g, '')
    .replace(/\d{1,2}:\d{2}(\s*[-–~到至]\s*\d{1,2}:\d{2})?/g, '')
    .replace(/\d{1,2}\s*點半?/g, '')
    .trim();

  if (cleaned.length >= 2 && cleaned.length <= 24) {
    return cleaned;
  }
  if (text.includes('英文')) return '英文重點學習';
  if (text.includes('數學') || text.includes('微積分')) return '數學重點複習';
  if (text.includes('演算法')) return '演算法專題練習';
  return '專注讀書時段';
}

function buildDeadlineTitleFromMessage(text: string): string {
  const cleaned = text
    .replace(/^(請|幫我|新增|建立|設定)/g, '')
    .replace(/(今天|今日|明天|明日|後天|大後天|週[一二三四五六日天]|截止)/g, '')
    .trim();

  if (cleaned.length >= 2 && cleaned.length <= 24) {
    return cleaned;
  }
  return '學習任務截止';
}

export class MockAIProvider implements AIProvider {
  async generateProposal(context: GenerateProposalContext): Promise<AIProviderResult> {
    const text = context.userMessage.trim();
    const nowIso = new Date().toISOString();
    const attachmentNote =
      context.attachments && context.attachments.length > 0
        ? `（已參考附件：${context.attachments.map((a) => a.name).join('、')}）`
        : '';

    // 1. Check "Reject-then-discuss" follow-up intent
    const isRejectedFollowUp =
      context.rejectedProposals.length > 0 &&
      /(按叉|拒絕|剛剛|那項|那個|這項|改到|改成|換到|換成)/.test(text);

    if (isRejectedFollowUp) {
      const latestRejected =
        (context.lastRejectedProposalId
          ? context.rejectedProposals.find(
              (p) => p.id === context.lastRejectedProposalId,
            )
          : undefined) ??
        [...context.rejectedProposals].sort((a, b) =>
          b.updatedAt.localeCompare(a.updatedAt),
        )[0];

      const rejectedItem = getProposalEffectiveItem(latestRejected);
      const parsedDate = parseTargetDateKey(text, context.selectedDate);
      const parsedWindow = parseTimeWindow(text);

      if (isSchedule(rejectedItem)) {
        const origDate = getDateKeyFromInstant(rejectedItem.startAt, context.timeZone);
        const targetDate = parsedDate ?? shiftDateKey(origDate, 1);
        const origDuration = Math.max(
          30,
          Math.round(
            (Date.parse(rejectedItem.endAt) - Date.parse(rejectedItem.startAt)) /
              60_000,
          ),
        );

        let startAt: string;
        let endAt: string;
        if (parsedWindow) {
          const startMin = getMinutesFromMidnight(
            buildIsoFromLocalDateTime(targetDate, parsedWindow.startHHmm, context.timeZone),
            context.timeZone,
          );
          startAt = buildIsoFromLocalDateTime(
            targetDate,
            parsedWindow.startHHmm,
            context.timeZone,
          );
          endAt = buildIsoFromLocalDateTime(
            targetDate,
            minutesToHHmm(Math.min(23 * 60 + 45, startMin + origDuration)),
            context.timeZone,
          );
        } else {
          const origStartHHmm = getLocalTimeHHmm(rejectedItem.startAt, context.timeZone);
          const slot = findNonConflictingSlot(
            targetDate,
            origStartHHmm,
            origDuration,
            context.currentItems,
            context.timeZone,
          );
          startAt = slot.startAt;
          endAt = slot.endAt;
        }

        const latestFormal = latestRejected.targetItemId
          ? context.currentItems.find((i) => i.id === latestRejected.targetItemId)
          : undefined;

        const change: AIProposedChangeInput =
          latestRejected.action === 'update' && latestFormal && isSchedule(latestFormal)
            ? {
                action: 'update',
                targetItemId: latestFormal.id,
                baseRevision: latestFormal.revision,
                before: latestFormal,
                after: {
                  ...latestFormal,
                  startAt,
                  endAt,
                  updatedAt: nowIso,
                },
                reason: `依據您剛拒絕的「${rejectedItem.title}」重新調整至 ${targetDate} ${getLocalTimeHHmm(startAt, context.timeZone)}–${getLocalTimeHHmm(endAt, context.timeZone)}。`,
              }
            : {
                action: 'create',
                after: {
                  id: nextMockItemId('ai-sc'),
                  userId: context.userId,
                  type: 'schedule',
                  title: rejectedItem.title,
                  startAt,
                  endAt,
                  tag: rejectedItem.tag,
                  description: rejectedItem.description,
                  status: 'scheduled',
                  revision: 1,
                  createdAt: nowIso,
                  updatedAt: nowIso,
                },
                reason: `接續您剛拒絕的「${rejectedItem.title}」，改為安排於 ${targetDate} ${getLocalTimeHHmm(startAt, context.timeZone)}–${getLocalTimeHHmm(endAt, context.timeZone)}。`,
              };

        return {
          assistantMessage: `已根據您剛拒絕的「${rejectedItem.title}」調整時間，請在時間軸上確認新版提案。${attachmentNote}`,
          rawChanges: [change],
        };
      }

      // Rejected Deadline follow-up
      const targetDueDate =
        parsedDate ??
        shiftDateKey(getDateKeyFromInstant(rejectedItem.dueDate, context.timeZone), 1);
      const change: AIProposedChangeInput = {
        action: 'create',
        after: {
          id: nextMockItemId('ai-dl'),
          userId: context.userId,
          type: 'deadline',
          title: rejectedItem.title,
          dueDate: targetDueDate,
          tag: rejectedItem.tag,
          description: rejectedItem.description,
          status: 'pending',
          revision: 1,
          createdAt: nowIso,
          updatedAt: nowIso,
        },
        reason: `接續您剛拒絕的截止項目「${rejectedItem.title}」，改設於 ${targetDueDate}。`,
      };

      return {
        assistantMessage: `已將「${rejectedItem.title}」改期至 ${targetDueDate}，請確認提案。${attachmentNote}`,
        rawChanges: [change],
      };
    }

    // 2. Check compound multi-change clauses (e.g. "安排明天下午讀書並取消今天行程")
    const clauses = text
      .split(/(?:並且|並|同時|以及|，然後|然後)/)
      .map((c) => c.trim())
      .filter((c) => c.length > 0);

    if (clauses.length > 1) {
      const batchChanges: AIProposedChangeInput[] = [];
      const usedTargetIds = new Set<string>();

      for (const clause of clauses) {
        const remainingItems = context.currentItems.filter(
          (i) => !usedTargetIds.has(i.id),
        );
        const produced = this.buildSingleChange(
          clause,
          { ...context, currentItems: remainingItems },
          nowIso,
        );
        if (produced) {
          if (produced.targetItemId) {
            usedTargetIds.add(produced.targetItemId);
          }
          batchChanges.push(produced);
        }
      }

      if (batchChanges.length > 0) {
        return {
          assistantMessage: `已為您產生 ${batchChanges.length} 項變更提案，您可以逐項點擊 ✓ 接受或 × 拒絕。${attachmentNote}`,
          rawChanges: batchChanges,
        };
      }
    }

    // 3. Single intent fallback
    const single = this.buildSingleChange(text, context, nowIso);
    if (single) {
      return {
        assistantMessage: `已於時間軸產生待確認提案，點擊 ✓ 即可套用，或點擊 💡 查看理由。${attachmentNote}`,
        rawChanges: [single],
      };
    }

    return {
      assistantMessage: `目前找不到符合的行程項目可調整，您可以告訴我想新增的讀書時段或截止日期。${attachmentNote}`,
      rawChanges: [],
    };
  }

  private buildSingleChange(
    clause: string,
    context: GenerateProposalContext,
    nowIso: string,
  ): AIProposedChangeInput | null {
    const parsedDate = parseTargetDateKey(clause, context.selectedDate);
    const parsedTime = parseTimeWindow(clause);

    // Delete intent
    if (/(刪除|取消|移除)/.test(clause)) {
      const target = findBestMatchingItem(
        clause,
        context.currentItems,
        context.timeZone,
        parsedDate ?? context.selectedDate,
      );
      if (!target) {
        return null;
      }
      return {
        action: 'delete',
        targetItemId: target.id,
        baseRevision: target.revision,
        before: target,
        reason: `依您指示建議移除「${target.title}」，以騰出學習時段彈性。`,
      };
    }

    // Update intent
    if (/(調整|改到|延後|順延|提前|修改|改為)/.test(clause)) {
      const target = findBestMatchingItem(
        clause,
        context.currentItems,
        context.timeZone,
        context.selectedDate,
      );
      if (target && isSchedule(target)) {
        const origDate = getDateKeyFromInstant(target.startAt, context.timeZone);
        const targetDate = parsedDate ?? origDate;
        const durationMin = Math.max(
          30,
          Math.round(
            (Date.parse(target.endAt) - Date.parse(target.startAt)) / 60_000,
          ),
        );

        let newStartAt: string;
        let newEndAt: string;
        if (parsedTime) {
          const startMin = getMinutesFromMidnight(
            buildIsoFromLocalDateTime(targetDate, parsedTime.startHHmm, context.timeZone),
            context.timeZone,
          );
          newStartAt = buildIsoFromLocalDateTime(
            targetDate,
            parsedTime.startHHmm,
            context.timeZone,
          );
          newEndAt = buildIsoFromLocalDateTime(
            targetDate,
            minutesToHHmm(Math.min(23 * 60 + 45, startMin + durationMin)),
            context.timeZone,
          );
        } else {
          // Shift by +60 min (or -60 min if 提前)
          const delta = clause.includes('提前') ? -60 : 60;
          const origStartMin = getMinutesFromMidnight(target.startAt, context.timeZone);
          const nextStartMin = Math.max(
            7 * 60,
            Math.min(22 * 60, origStartMin + delta),
          );
          const slot = findNonConflictingSlot(
            targetDate,
            minutesToHHmm(nextStartMin),
            durationMin,
            context.currentItems.filter((i) => i.id !== target.id),
            context.timeZone,
          );
          newStartAt = slot.startAt;
          newEndAt = slot.endAt;
        }

        return {
          action: 'update',
          targetItemId: target.id,
          baseRevision: target.revision,
          before: target,
          after: {
            ...target,
            startAt: newStartAt,
            endAt: newEndAt,
            updatedAt: nowIso,
          },
          reason: `建議將「${target.title}」調整至 ${targetDate} ${getLocalTimeHHmm(newStartAt, context.timeZone)}–${getLocalTimeHHmm(newEndAt, context.timeZone)}，確保時段安排更順暢。`,
        };
      }
    }

    // Create Deadline intent
    if (/(截止|作業|報告|考試|繳交|deadline)/i.test(clause)) {
      const targetDate = parsedDate ?? shiftDateKey(context.selectedDate, 2);
      const title = buildDeadlineTitleFromMessage(clause);
      return {
        action: 'create',
        after: {
          id: nextMockItemId('ai-dl'),
          userId: context.userId,
          type: 'deadline',
          title,
          dueDate: targetDate,
          tag: '學習任務',
          status: 'pending',
          revision: 1,
          createdAt: nowIso,
          updatedAt: nowIso,
        },
        reason: `將「${title}」設為 ${targetDate} 的截止提醒，不佔用排程衝突。`,
      };
    }

    // Default: Create Schedule intent
    const targetDate =
      parsedDate ??
      (clause.includes('讀書') && !clause.includes('今天')
        ? shiftDateKey(context.selectedDate, 1)
        : context.selectedDate);
    const title = buildScheduleTitleFromMessage(clause);
    const window = parsedTime ?? { startHHmm: '14:00', endHHmm: '16:00' };
    const startMin = getMinutesFromMidnight(
      buildIsoFromLocalDateTime(targetDate, window.startHHmm, context.timeZone),
      context.timeZone,
    );
    const endMin = getMinutesFromMidnight(
      buildIsoFromLocalDateTime(targetDate, window.endHHmm, context.timeZone),
      context.timeZone,
    );
    const duration = Math.max(30, endMin - startMin);

    const slot = parsedTime
      ? {
          startAt: buildIsoFromLocalDateTime(targetDate, window.startHHmm, context.timeZone),
          endAt: buildIsoFromLocalDateTime(targetDate, window.endHHmm, context.timeZone),
        }
      : findNonConflictingSlot(
          targetDate,
          window.startHHmm,
          duration,
          context.currentItems,
          context.timeZone,
        );

    const conflicts = detectScheduleConflicts(
      { startAt: slot.startAt, endAt: slot.endAt },
      context.currentItems,
    );

    const conflictHint = conflicts.hasConflict
      ? ` 注意：此時段與「${conflicts.conflictingItems.map((c: Schedule) => c.title).join('、')}」重疊。`
      : ' 與現有排程無時間衝突。';

    return {
      action: 'create',
      after: {
        id: nextMockItemId('ai-sc'),
        userId: context.userId,
        type: 'schedule',
        title,
        startAt: slot.startAt,
        endAt: slot.endAt,
        tag: 'AI 規劃',
        status: 'scheduled',
        revision: 1,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
      reason: `建議於 ${targetDate} ${getLocalTimeHHmm(slot.startAt, context.timeZone)}–${getLocalTimeHHmm(slot.endAt, context.timeZone)} 安排「${title}」。${conflictHint}`,
    };
  }

  async explainProposal(
    change: ProposalChange,
    context: {
      timeZone: string;
      currentItems: readonly CalendarItem[];
    },
  ): Promise<string> {
    if (change.reason) {
      return change.reason;
    }
    const effective = getProposalEffectiveItem(change);
    if (isSchedule(effective)) {
      return `${change.action} 排程「${effective.title}」（${getLocalTimeHHmm(effective.startAt, context.timeZone)}–${getLocalTimeHHmm(effective.endAt, context.timeZone)}）。`;
    }
    return `${change.action} 截止事項「${effective.title}」（${effective.dueDate}）。`;
  }
}
