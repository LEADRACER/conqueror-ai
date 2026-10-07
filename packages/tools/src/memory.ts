import { z } from "zod";
import { defineTool } from "@alex-ai/core";
import type { ToolDefinition } from "@alex-ai/core";
import { MemoryManager } from "@alex-ai/experience";
import type { MemoryQuery } from "@alex-ai/experience";

let memoryManager: MemoryManager | null = null;

export function setMemoryManager(manager: MemoryManager): void {
  memoryManager = manager;
}

export function getMemoryManager(): MemoryManager | null {
  return memoryManager;
}

export const MemoryTools: ToolDefinition[] = [
  defineTool({
    name: "memory_store",
    description:
      "Store a piece of information as a memory. Memories persist across " +
      "conversations. Use this to remember facts about the user, project " +
      "context, code patterns, or task outcomes.",
    args: {
      content: z.string().describe("The information to remember"),
      type: z
        .enum(["episodic", "semantic", "procedural"])
        .optional()
        .describe("Memory type: episodic (events), semantic (facts), procedural (how-to)"),
      tags: z.array(z.string()).optional().describe("Tags for categorization"),
      importance: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe("Importance score 0-1 (higher = more important)"),
    },
    async handler(args, ctx) {
      const manager = getMemoryManager();
      if (!manager) {
        return `No memory manager available.`;
      }
      const storeOpts: { tags?: string[]; importance?: number; sessionId?: string } = {
        sessionId: ctx.sessionID,
      };
      if (args.tags !== undefined) {
        storeOpts.tags = args.tags;
      }
      if (args.importance !== undefined) {
        storeOpts.importance = args.importance;
      }
      const entry = await manager.store(args.content, args.type ?? "episodic", storeOpts);
      return `Stored memory [${entry.type}] id=${entry.id}. Tags: ${entry.tags?.join(", ") ?? "none"}.`;
    },
  }),

  defineTool({
    name: "memory_search",
    description:
      "Search stored memories by content or tags. Returns relevant memories " +
      "with relevance scores.",
    args: {
      query: z
        .string()
        .describe("What to search for (keywords or partial content)"),
      types: z
        .array(z.enum(["episodic", "semantic", "procedural"]))
        .optional()
        .describe("Filter by memory type"),
      tags: z.array(z.string()).optional().describe("Filter by tag"),
      limit: z.number().int().min(1).max(50).optional().describe("Max results (default 10)"),
    },
    async handler(args, _ctx) {
      const manager = getMemoryManager();
      if (!manager) {
        return `No memory manager available.`;
      }
      const limit = args.limit ?? 10;
      const searchQuery: Omit<MemoryQuery, "limit"> = {};
      if (args.types !== undefined) {
        searchQuery.types = args.types;
      }
      if (args.tags !== undefined) {
        searchQuery.tags = args.tags;
      }
      const results = (await manager.searchByContent(args.query, searchQuery)).slice(0, limit);
      if (results.length === 0) {
        return `No memories found matching "${args.query}".`;
      }
      const output = results
        .map(
          (r) =>
            `[${r.entry.type}] score=${r.score.toFixed(1)} | ${r.entry.content.slice(0, 200)}` +
            `${r.entry.tags && r.entry.tags.length > 0 ? ` | tags: ${r.entry.tags.join(", ")}` : ""}`
        )
        .join("\n\n");
      return `Found ${results.length} memory(ies) (limit: ${limit}):\n${output}`;
    },
  }),

  defineTool({
    name: "memory_forget",
    description:
      "Delete a stored memory by ID. Use this to remove outdated or incorrect information.",
    args: {
      id: z.string().uuid().describe("The memory ID to delete (from memory_search results)"),
    },
    async handler(args, _ctx) {
      const manager = getMemoryManager();
      if (!manager) {
        return `No memory manager available.`;
      }
      const deleted = await manager.forget(args.id);
      if (deleted) {
        return `Memory ${args.id} deleted.`;
      }
      return `Memory ${args.id} not found.`;
    },
  }),

  defineTool({
    name: "memory_summary",
    description:
      "Summarize memories from the current session. Returns a condensed view " +
      "of episodic memories recorded during this conversation.",
    args: {},
    async handler(_args, ctx) {
      const manager = getMemoryManager();
      if (!manager) {
        return `No memory manager available.`;
      }
      const summary = await manager.summarizeSession(ctx.sessionID);
      if (!summary) {
        return `No memories stored for this session.`;
      }
      return `Session memory summary:\n${summary}`;
    },
  }),
];
