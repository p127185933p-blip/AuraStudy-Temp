import {
  filterItemsInDateRange,
  type DateRange,
} from '@/domain/planning';
import {
  isDeadline,
  isSchedule,
  type CalendarItem,
  type Deadline,
  type Schedule,
} from '@/domain/schedule';
import type { CalendarRepository } from './CalendarRepository';
import { fail, ok, type ApplicationResult } from './types';

export interface ListCalendarItemsQuery {
  userId: string;
  range?: DateRange;
  type?: CalendarItem['type'];
}

export interface ListCalendarItemsResult {
  items: CalendarItem[];
  deadlines: Deadline[];
  schedules: Schedule[];
}

export async function listCalendarItems(
  repository: CalendarRepository,
  query: ListCalendarItemsQuery,
): Promise<ApplicationResult<ListCalendarItemsResult>> {
  if (!query.userId || query.userId.trim().length === 0) {
    return fail({
      code: 'VALIDATION_ERROR',
      message: 'userId is required to list calendar items',
    });
  }

  const allUserItems = await repository.listByUser(query.userId);
  const typeFiltered =
    query.type !== undefined
      ? allUserItems.filter((item) => item.type === query.type)
      : allUserItems;

  if (query.range) {
    const ranged = filterItemsInDateRange(typeFiltered, query.range);
    return ok({
      items: ranged.items,
      deadlines: ranged.deadlines,
      schedules: ranged.schedules,
    });
  }

  const deadlines = typeFiltered
    .filter(isDeadline)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const schedules = typeFiltered
    .filter(isSchedule)
    .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));

  return ok({
    items: [...deadlines, ...schedules],
    deadlines,
    schedules,
  });
}
