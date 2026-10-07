import { MemoryTools } from "@alex-ai/tools";
export const memorySkill = {
    id: "memory",
    name: "Memory",
    description: "Persistent memory layer for storing and recalling information across " +
        "sessions. Store facts, episodic experiences, and procedural knowledge. " +
        "Memories are auto-injected into relevant future conversations.",
    systemPrompt: `## Memory Skill

You have persistent memory that survives across sessions. You can:
- Store memories (facts, experiences, how-to knowledge)
- Search memories by keyword or tag
- Forget outdated or incorrect memories
- Summarize session memories

Memory is stored on disk at ~/.config/alex/memory.json

Guidelines:
- Store important user preferences, project context, and task outcomes
- Use appropriate types: episodic (events), semantic (facts), procedural (how-to)
- Tag memories for easy categorization
- Set importance: 1.0 = critical, 0.5 = default, 0.0 = low priority
- Search before storing duplicates
- Forget memories that are outdated or incorrect
- Relevant memories are auto-injected into your context at the start of each task`,
    tools: [...MemoryTools],
};
//# sourceMappingURL=index.js.map