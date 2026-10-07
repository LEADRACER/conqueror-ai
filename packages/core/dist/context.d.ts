import { ToolRegistry, ProviderRegistry, SkillRegistry } from "./registry.js";
import type { ToolContext, ToolOutput } from "./types.js";
export declare class Memory {
    private store;
    set(key: string, value: unknown): void;
    get<T = unknown>(key: string): T | undefined;
    has(key: string): boolean;
    delete(key: string): boolean;
    keys(): string[];
    clear(): void;
}
export declare class AlexContext {
    readonly directory: string;
    readonly worktree: string;
    readonly sessionID: string;
    readonly abort: AbortSignal;
    readonly env: Record<string, string>;
    readonly tools: ToolRegistry;
    readonly providers: ProviderRegistry;
    readonly skills: SkillRegistry;
    readonly memory: Memory;
    constructor(directory: string, worktree: string, sessionID?: string, abort?: AbortSignal, env?: Record<string, string>);
    callTool(name: string, args: Record<string, unknown>): Promise<ToolOutput>;
    createToolContext(): ToolContext;
    listTools(): ReturnType<ToolRegistry["list"]>;
    systemPrompt(): string;
}
//# sourceMappingURL=context.d.ts.map