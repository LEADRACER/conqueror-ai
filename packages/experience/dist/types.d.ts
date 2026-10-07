import { z } from "zod";
export declare const MemoryType: z.ZodEnum<{
    episodic: "episodic";
    semantic: "semantic";
    procedural: "procedural";
}>;
export type MemoryType = z.infer<typeof MemoryType>;
export declare const MemoryEntrySchema: z.ZodObject<{
    id: z.ZodString;
    content: z.ZodString;
    type: z.ZodEnum<{
        episodic: "episodic";
        semantic: "semantic";
        procedural: "procedural";
    }>;
    tags: z.ZodOptional<z.ZodArray<z.ZodString>>;
    importance: z.ZodDefault<z.ZodNumber>;
    sessionId: z.ZodOptional<z.ZodString>;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
}, z.core.$strip>;
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
//# sourceMappingURL=types.d.ts.map