import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { MemoryEntrySchema } from "./types.js";
import type { MemoryEntry, MemoryQuery, MemorySearchResult } from "./types.js";

const STORAGE_FILE = ".kilo/memory.json";
const MAX_ENTRIES = 5000;

export class MemoryStore {
  private entries: Map<string, MemoryEntry> = new Map();
  private readonly filePath: string;

  constructor(filePath?: string) {
    this.filePath = filePath ?? STORAGE_FILE;
    this.load();
  }

  private load(): void {
    const resolved = resolvePath(this.filePath);
    if (existsSync(resolved)) {
      try {
        const raw = readFileSync(resolved, "utf-8");
        const data = JSON.parse(raw);
        if (Array.isArray(data)) {
          for (const entry of data) {
            const parsed = MemoryEntrySchemaSafeParse(entry);
            if (parsed) {
              this.entries.set(parsed.id, parsed);
            }
          }
        }
      } catch {
      }
    }
  }

  private save(): void {
    const resolved = resolvePath(this.filePath);
    const dir = dirname(resolved);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const data = Array.from(this.entries.values());
    writeFileSync(resolved, JSON.stringify(data, null, 2), "utf-8");
  }

  store(entry: MemoryEntry): void {
    if (this.entries.size >= MAX_ENTRIES) {
      const oldest = this.getOldest();
      if (oldest) {
        this.entries.delete(oldest);
      }
    }
    this.entries.set(entry.id, entry);
    this.save();
  }

  retrieve(id: string): MemoryEntry | undefined {
    return this.entries.get(id);
  }

  delete(id: string): boolean {
    const existed = this.entries.delete(id);
    if (existed) {
      this.save();
    }
    return existed;
  }

  search(query: MemoryQuery): MemorySearchResult[] {
    let results: MemoryEntry[] = Array.from(this.entries.values());

    if (query.types && query.types.length > 0) {
      results = results.filter((e) => query.types!.includes(e.type));
    }
    if (query.tags && query.tags.length > 0) {
      results = results.filter((e) =>
        query.tags!.some((tag) => e.tags?.some((t) => t.toLowerCase() === tag.toLowerCase()))
      );
    }
    if (query.sessionId !== undefined) {
      results = results.filter((e) => e.sessionId === query.sessionId);
    }
    if (query.minImportance !== undefined) {
      results = results.filter((e) => e.importance >= query.minImportance!);
    }
    if (query.since !== undefined) {
      const since = new Date(query.since).getTime();
      results = results.filter((e) => new Date(e.createdAt).getTime() >= since);
    }

    const limit = query.limit ?? 10;
    return results
      .map((e) => ({ entry: e, score: 1, matches: [] }))
      .sort((a, b) => b.entry.importance - a.entry.importance)
      .slice(0, limit);
  }

  searchByContent(
    text: string,
    query: Omit<MemoryQuery, "limit"> = {}
  ): MemorySearchResult[] {
    const terms = tokenize(text.toLowerCase());
    let results: MemoryEntry[] = Array.from(this.entries.values());

    if (query.types && query.types.length > 0) {
      results = results.filter((e) => query.types!.includes(e.type));
    }
    if (query.tags && query.tags.length > 0) {
      results = results.filter((e) =>
        query.tags!.some((tag) => e.tags?.some((t) => t.toLowerCase() === tag.toLowerCase()))
      );
    }
    if (query.sessionId !== undefined) {
      results = results.filter((e) => e.sessionId === query.sessionId);
    }
    if (query.minImportance !== undefined) {
      results = results.filter((e) => e.importance >= query.minImportance!);
    }
    if (query.since !== undefined) {
      const since = new Date(query.since).getTime();
      results = results.filter((e) => new Date(e.createdAt).getTime() >= since);
    }

    const scored: MemorySearchResult[] = results.map((entry) => {
      const contentLower = entry.content.toLowerCase();
      const matched: string[] = [];
      let score = 0;

      for (const term of terms) {
        const regex = new RegExp(term, "gi");
        const matches = contentLower.match(regex);
        if (matches && matches.length > 0) {
          score += matches.length;
          matched.push(...matches.map((m) => m.toLowerCase()));
        }
        entry.tags?.forEach((tag) => {
          if (tag.toLowerCase().includes(term)) {
            score += 0.5;
            matched.push(tag);
          }
        });
      }

      return { entry, score, matches: matched };
    });

    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
  }

  private getOldest(): string | undefined {
    let oldest: MemoryEntry | undefined;
    for (const entry of this.entries.values()) {
      if (!oldest || new Date(entry.createdAt).getTime() < new Date(oldest.createdAt).getTime()) {
        oldest = entry;
      }
    }
    return oldest?.id;
  }

  getAll(): MemoryEntry[] {
    return Array.from(this.entries.values());
  }

  count(): number {
    return this.entries.size;
  }
}

function resolvePath(path: string): string {
  if (path.startsWith("/") || path.includes(":")) {
    return path;
  }
  const home = process.env.HOME ?? process.env.USERPROFILE ?? process.cwd();
  return `${home}/${path}`;
}

function tokenize(text: string): string[] {
  return text.split(/\W+/).filter((t) => t.length > 1);
}

function MemoryEntrySchemaSafeParse(data: unknown): MemoryEntry | null {
  const parsed = MemoryEntrySchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}
