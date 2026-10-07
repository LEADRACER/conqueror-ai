import { z } from "zod";
export const MemoryType = z.enum(["episodic", "semantic", "procedural"]);
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
//# sourceMappingURL=types.js.map