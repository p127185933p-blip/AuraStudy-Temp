import type { TagRepository } from '@/application/services';
import type { CalendarTag } from '@/domain/schedule';

export class InMemoryTagRepository implements TagRepository {
  private readonly store = new Map<string, CalendarTag>();

  constructor(initialTags: readonly CalendarTag[] = []) {
    for (const tag of initialTags) {
      this.store.set(tag.id, { ...tag });
    }
  }

  async findById(id: string): Promise<CalendarTag | null> {
    const found = this.store.get(id);
    return found ? { ...found } : null;
  }

  async listByUser(userId: string): Promise<CalendarTag[]> {
    return Array.from(this.store.values())
      .filter((tag) => tag.userId === userId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((tag) => ({ ...tag }));
  }

  async save(tag: CalendarTag): Promise<CalendarTag> {
    const cloned = { ...tag };
    this.store.set(cloned.id, cloned);
    return { ...cloned };
  }

  async delete(id: string): Promise<boolean> {
    return this.store.delete(id);
  }

  async deleteAllByUser(userId: string): Promise<void> {
    for (const [id, tag] of this.store.entries()) {
      if (tag.userId === userId) {
        this.store.delete(id);
      }
    }
  }
}
