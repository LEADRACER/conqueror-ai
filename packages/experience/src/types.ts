import { z } from "zod";

export const MemoryType = z.enum(["episodic", "semantic", "procedural"]);
export type MemoryType = z.infer<typeof MemoryType>;

export const MemoryEntrySchema = z.object({
  id: z.string().uuid(),
  content: z.string(),
  type: MemoryType,
  tags: z.array(z.string()).optional(),
  importance: z.number().min(0).max(1).default(0.5),
  sessionId: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type MemoryEntry = z.infer<typeof MemoryEntrySchema>;

export interface MemoryQuery {
  types?: MemoryType[];
  tags?: string[];
  sessionId?: string;
  limit?: number;
  minImportance?: number;
  since?: string;
}

export interface MemorySearchResult {
  entry: MemoryEntry;
  score: number;
  matches: string[];
}
