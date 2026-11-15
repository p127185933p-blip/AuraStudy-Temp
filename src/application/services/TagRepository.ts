import type { CalendarTag } from '@/domain/schedule';

export interface TagRepository {
  findById(id: string): Promise<CalendarTag | null>;
  listByUser(userId: string): Promise<CalendarTag[]>;
  save(tag: CalendarTag): Promise<CalendarTag>;
  delete(id: string): Promise<boolean>;
  deleteAllByUser?(userId: string): Promise<void>;
  syncSnapshot?(userId: string, tags: readonly CalendarTag[]): Promise<void>;
}
