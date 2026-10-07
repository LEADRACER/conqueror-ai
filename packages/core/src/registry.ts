import type { ToolDefinition, Provider, Skill } from "./types.js";

export class RegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegistryError";
  }
}

export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();

  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      throw new RegistryError(`Tool "${tool.name}" is already registered`);
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  list(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  get all(): ToolDefinition[] {
    return this.list();
  }

  clear(): void {
    this.tools.clear();
  }

  get size(): number {
    return this.tools.size;
  }
}

export class ProviderRegistry {
  private providers: Map<string, Provider> = new Map();

  register(provider: Provider): void {
    if (this.providers.has(provider.id)) {
      throw new RegistryError(`Provider "${provider.id}" is already registered`);
    }
    this.providers.set(provider.id, provider);
  }

  get(id: string): Provider | undefined {
    return this.providers.get(id);
  }

  has(id: string): boolean {
    return this.providers.has(id);
  }

  list(): Provider[] {
    return Array.from(this.providers.values());
  }

  clear(): void {
    this.providers.clear();
  }

  get size(): number {
    return this.providers.size;
  }
}

export class SkillRegistry {
  private skills: Map<string, Skill> = new Map();

  register(skill: Skill): void {
    if (this.skills.has(skill.id)) {
      throw new RegistryError(`Skill "${skill.id}" is already registered`);
    }
    this.skills.set(skill.id, skill);
  }

  get(id: string): Skill | undefined {
    return this.skills.get(id);
  }

  has(id: string): boolean {
    return this.skills.has(id);
  }

  list(): Skill[] {
    return Array.from(this.skills.values());
  }

  clear(): void {
    this.skills.clear();
  }

  get size(): number {
    return this.skills.size;
  }

  allTools(): ToolDefinition[] {
    const seen = new Set<string>();
    const result: ToolDefinition[] = [];
    for (const skill of this.skills.values()) {
      for (const tool of skill.tools) {
        if (!seen.has(tool.name)) {
          seen.add(tool.name);
          result.push(tool);
        }
      }
    }
    return result;
  }
}
