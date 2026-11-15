import type { CalendarRepository } from '@/application/services';
import type { CalendarItem } from '@/domain/schedule';

function cloneItem(item: CalendarItem): CalendarItem {
  return { ...item };
}

export class InMemoryCalendarRepository implements CalendarRepository {
  private readonly items = new Map<string, CalendarItem>();

  constructor(initialItems: readonly CalendarItem[] = []) {
    for (const item of initialItems) {
      this.items.set(item.id, cloneItem(item));
    }
  }

  async findById(id: string): Promise<CalendarItem | null> {
    const found = this.items.get(id);
    return found ? cloneItem(found) : null;
  }

  async listByUser(userId: string): Promise<CalendarItem[]> {
    const result: CalendarItem[] = [];
    for (const item of this.items.values()) {
      if (item.userId === userId) {
        result.push(cloneItem(item));
      }
    }
    return result;
  }

  async save(item: CalendarItem): Promise<CalendarItem> {
    const stored = cloneItem(item);
    this.items.set(stored.id, stored);
    return cloneItem(stored);
  }

  async delete(id: string): Promise<boolean> {
    return this.items.delete(id);
  }

  async clearByUser(userId: string): Promise<void> {
    for (const [id, item] of this.items.entries()) {
      if (item.userId === userId) {
        this.items.delete(id);
      }
    }
  }
}
