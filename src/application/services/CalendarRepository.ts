import type { CalendarItem } from '@/domain/schedule';

export interface CalendarRepository {
  findById(id: string): Promise<CalendarItem | null>;
  listByUser(userId: string): Promise<CalendarItem[]>;
  save(item: CalendarItem): Promise<CalendarItem>;
  delete(id: string): Promise<boolean>;
  syncSnapshot?(userId: string, items: readonly CalendarItem[]): Promise<void>;
}
