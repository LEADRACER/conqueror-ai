import { randomUUID } from "node:crypto";
import { MemoryStore } from "./store.js";
export class MemoryManager {
    memoryStore;
    constructor(filePath) {
        this.memoryStore = new MemoryStore(filePath);
    }
    async store(content, type = "episodic", opts = {}) {
        const now = new Date().toISOString();
        const entry = {
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
    async retrieve(id) {
        return this.memoryStore.retrieve(id);
    }
    async search(query) {
        return this.memoryStore.search(query);
    }
    async searchByContent(text, query = {}) {
        return this.memoryStore.searchByContent(text, query);
    }
    async forget(id) {
        return this.memoryStore.delete(id);
    }
    async summarizeSession(sessionId) {
        const results = await this.search({ sessionId, types: ["episodic"], limit: 20 });
        return results
            .sort((a, b) => b.entry.importance - a.entry.importance)
            .map((r) => r.entry.content)
            .join("\n\n");
    }
    count() {
        return this.memoryStore.count();
    }
    getAll() {
        return this.memoryStore.getAll();
    }
}
//# sourceMappingURL=memory.js.map