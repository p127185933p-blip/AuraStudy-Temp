import type { CalendarRepository } from '@/application/services';
import type { CalendarItem } from '@/domain/schedule';
import { CalendarItemSchema } from '@/shared/schemas';
import { readLocalJsonArray, writeLocalJson } from './localStorageUtils';

export const DEFAULT_CALENDAR_STORAGE_KEY = 'aurastudy.v1.calendarItems';

function cloneItem(item: CalendarItem): CalendarItem {
  return { ...item };
}

export interface LocalStorageCalendarRepositoryOptions {
  storageKey?: string;
}

export class LocalStorageCalendarRepository implements CalendarRepository {
  private readonly storageKey: string;
  private readonly fallbackMemory = new Map<string, CalendarItem>();

  constructor(options: LocalStorageCalendarRepositoryOptions = {}) {
    this.storageKey = options.storageKey ?? DEFAULT_CALENDAR_STORAGE_KEY;
    const initial = this.readAllFromStorage();
    for (const item of initial) {
      this.fallbackMemory.set(item.id, cloneItem(item));
    }
  }

  private readAllFromStorage(): CalendarItem[] {
    const res = readLocalJsonArray<CalendarItem>(this.storageKey, (raw) => {
      const parsed = CalendarItemSchema.safeParse(raw);
      return parsed.success ? parsed.data : null;
    });
    if (res.ok) {
      return res.items;
    }
    return Array.from(this.fallbackMemory.values()).map(cloneItem);
  }

  private persistAll(items: readonly CalendarItem[]): void {
    this.fallbackMemory.clear();
    for (const item of items) {
      this.fallbackMemory.set(item.id, cloneItem(item));
    }
    writeLocalJson(this.storageKey, items);
  }

  async findById(id: string): Promise<CalendarItem | null> {
    const all = this.readAllFromStorage();
    const found = all.find((item) => item.id === id);
    return found ? cloneItem(found) : null;
  }

  async listByUser(userId: string): Promise<CalendarItem[]> {
    return this.readAllFromStorage()
      .filter((item) => item.userId === userId)
      .map(cloneItem);
  }

  async save(item: CalendarItem): Promise<CalendarItem> {
    const stored = cloneItem(item);
    const all = this.readAllFromStorage();
    const existingIndex = all.findIndex((entry) => entry.id === stored.id);
    if (existingIndex >= 0) {
      all[existingIndex] = stored;
    } else {
      all.push(stored);
    }
    this.persistAll(all);
    return cloneItem(stored);
  }

  async delete(id: string): Promise<boolean> {
    const all = this.readAllFromStorage();
    const next = all.filter((entry) => entry.id !== id);
    if (next.length === all.length) {
      return false;
    }
    this.persistAll(next);
    return true;
  }

  async clearByUser(userId: string): Promise<void> {
    const all = this.readAllFromStorage();
    const next = all.filter((entry) => entry.userId !== userId);
    this.persistAll(next);
  }
}
