import { randomUUID } from "node:crypto";
import { MemoryStore } from "./store.js";
import type { MemoryEntry, MemoryType, MemoryQuery, MemorySearchResult } from "./types.js";

export class MemoryManager {
  private memoryStore: MemoryStore;

  constructor(filePath?: string) {
    this.memoryStore = new MemoryStore(filePath);
  }

  async store(
    content: string,
    type: MemoryType = "episodic",
    opts: { tags?: string[]; importance?: number; sessionId?: string } = {}
  ): Promise<MemoryEntry> {
    const now = new Date().toISOString();
    const entry: MemoryEntry = {
      id: randomUUID(),
      content,
      type,
      importance: opts.importance ?? 0.5,
      createdAt: now,
      updatedAt: now,
    };
    if (opts.tags && opts.tags.length > 0) {
      entry.tags = opts.tags;
    }
    if (opts.sessionId) {
      entry.sessionId = opts.sessionId;
    }
    this.memoryStore.store(entry);
    return entry;
  }

  async retrieve(id: string): Promise<MemoryEntry | undefined> {
    return this.memoryStore.retrieve(id);
  }

  async search(query: MemoryQuery): Promise<MemorySearchResult[]> {
    return this.memoryStore.search(query);
  }

  async searchByContent(
    text: string,
    query: Omit<MemoryQuery, "limit"> = {}
  ): Promise<MemorySearchResult[]> {
    return this.memoryStore.searchByContent(text, query);
  }

  async forget(id: string): Promise<boolean> {
    return this.memoryStore.delete(id);
  }

  async summarizeSession(sessionId: string): Promise<string> {
    const results = await this.search({ sessionId, types: ["episodic"], limit: 20 });
    return results
      .sort((a, b) => b.entry.importance - a.entry.importance)
      .map((r) => r.entry.content)
      .join("\n\n");
  }

  count(): number {
    return this.memoryStore.count();
  }

  getAll(): MemoryEntry[] {
    return this.memoryStore.getAll();
  }
}
