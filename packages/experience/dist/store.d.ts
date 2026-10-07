import type { MemoryEntry, MemoryQuery, MemorySearchResult } from "./types.js";
export declare class MemoryStore {
    private entries;
    private readonly filePath;
    constructor(filePath?: string);
    private load;
    private save;
    store(entry: MemoryEntry): void;
    retrieve(id: string): MemoryEntry | undefined;
    delete(id: string): boolean;
    search(query: MemoryQuery): MemorySearchResult[];
    searchByContent(text: string, query?: Omit<MemoryQuery, "limit">): MemorySearchResult[];
    private getOldest;
    getAll(): MemoryEntry[];
    count(): number;
}
//# sourceMappingURL=store.d.ts.map