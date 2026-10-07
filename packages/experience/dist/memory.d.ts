import type { MemoryEntry, MemoryType, MemoryQuery, MemorySearchResult } from "./types.js";
export declare class MemoryManager {
    private memoryStore;
    constructor(filePath?: string);
    store(content: string, type?: MemoryType, opts?: {
        tags?: string[];
        importance?: number;
        sessionId?: string;
    }): Promise<MemoryEntry>;
    retrieve(id: string): Promise<MemoryEntry | undefined>;
    search(query: MemoryQuery): Promise<MemorySearchResult[]>;
    searchByContent(text: string, query?: Omit<MemoryQuery, "limit">): Promise<MemorySearchResult[]>;
    forget(id: string): Promise<boolean>;
    summarizeSession(sessionId: string): Promise<string>;
    count(): number;
    getAll(): MemoryEntry[];
}
//# sourceMappingURL=memory.d.ts.map