import type { TagRepository } from '@/application/services';
import type { CalendarTag } from '@/domain/schedule';
import { CalendarTagSchema } from '@/shared/schemas';
import {
  getSafeLocalStorage,
  readLocalJsonArray,
  writeLocalJson,
} from './localStorageUtils';

export const DEFAULT_TAG_STORAGE_KEY = 'aurastudy.v1.tags';
export const DEFAULT_TAG_SEEDED_KEY = 'aurastudy.v1.tagsSeeded';

export function isTagSeedCompleted(): boolean {
  const storage = getSafeLocalStorage();
  if (!storage) return false;
  try {
    return storage.getItem(DEFAULT_TAG_SEEDED_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setTagSeedCompleted(completed: boolean): void {
  const storage = getSafeLocalStorage();
  if (!storage) return;
  try {
    if (completed) {
      storage.setItem(DEFAULT_TAG_SEEDED_KEY, 'true');
    } else {
      storage.removeItem(DEFAULT_TAG_SEEDED_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

export interface LocalStorageTagRepositoryOptions {
  storageKey?: string;
}

export class LocalStorageTagRepository implements TagRepository {
  private readonly storageKey: string;
  private readonly fallbackMemory = new Map<string, CalendarTag>();

  constructor(options: LocalStorageTagRepositoryOptions = {}) {
    this.storageKey = options.storageKey ?? DEFAULT_TAG_STORAGE_KEY;
    const initial = this.readAllFromStorage();
    for (const tag of initial) {
      this.fallbackMemory.set(tag.id, { ...tag });
    }
  }

  private readAllFromStorage(): CalendarTag[] {
    const res = readLocalJsonArray<CalendarTag>(this.storageKey, (raw) => {
      const parsed = CalendarTagSchema.safeParse(raw);
      return parsed.success ? parsed.data : null;
    });
    if (res.ok) {
      return res.items;
    }
    return Array.from(this.fallbackMemory.values()).map((tag) => ({ ...tag }));
  }

  private persistAll(tags: readonly CalendarTag[]): void {
    this.fallbackMemory.clear();
    for (const tag of tags) {
      this.fallbackMemory.set(tag.id, { ...tag });
    }
    writeLocalJson(this.storageKey, tags);
  }

  async findById(id: string): Promise<CalendarTag | null> {
    const found = this.readAllFromStorage().find((tag) => tag.id === id);
    return found ? { ...found } : null;
  }

  async listByUser(userId: string): Promise<CalendarTag[]> {
    return this.readAllFromStorage()
      .filter((tag) => tag.userId === userId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((tag) => ({ ...tag }));
  }

  async save(tag: CalendarTag): Promise<CalendarTag> {
    const stored = { ...tag };
    const all = this.readAllFromStorage();
    const index = all.findIndex((entry) => entry.id === stored.id);
    if (index >= 0) {
      all[index] = stored;
    } else {
      all.push(stored);
    }
    this.persistAll(all);
    return { ...stored };
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

  async deleteAllByUser(userId: string): Promise<void> {
    const all = this.readAllFromStorage();
    const next = all.filter((entry) => entry.userId !== userId);
    this.persistAll(next);
  }
}
