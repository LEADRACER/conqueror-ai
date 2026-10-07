import type { ToolDefinition, Provider, Skill } from "./types.js";
export declare class RegistryError extends Error {
    constructor(message: string);
}
export declare class ToolRegistry {
    private tools;
    register(tool: ToolDefinition): void;
    get(name: string): ToolDefinition | undefined;
    has(name: string): boolean;
    list(): ToolDefinition[];
    get all(): ToolDefinition[];
    clear(): void;
    get size(): number;
}
export declare class ProviderRegistry {
    private providers;
    register(provider: Provider): void;
    get(id: string): Provider | undefined;
    has(id: string): boolean;
    list(): Provider[];
    clear(): void;
    get size(): number;
}
export declare class SkillRegistry {
    private skills;
    register(skill: Skill): void;
    get(id: string): Skill | undefined;
    has(id: string): boolean;
    list(): Skill[];
    clear(): void;
    get size(): number;
    allTools(): ToolDefinition[];
}
//# sourceMappingURL=registry.d.ts.map