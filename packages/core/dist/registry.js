export class RegistryError extends Error {
    constructor(message) {
        super(message);
        this.name = "RegistryError";
    }
}
export class ToolRegistry {
    tools = new Map();
    register(tool) {
        if (this.tools.has(tool.name)) {
            throw new RegistryError(`Tool "${tool.name}" is already registered`);
        }
        this.tools.set(tool.name, tool);
    }
    get(name) {
        return this.tools.get(name);
    }
    has(name) {
        return this.tools.has(name);
    }
    list() {
        return Array.from(this.tools.values());
    }
    get all() {
        return this.list();
    }
    clear() {
        this.tools.clear();
    }
    get size() {
        return this.tools.size;
    }
}
export class ProviderRegistry {
    providers = new Map();
    register(provider) {
        if (this.providers.has(provider.id)) {
            throw new RegistryError(`Provider "${provider.id}" is already registered`);
        }
        this.providers.set(provider.id, provider);
    }
    get(id) {
        return this.providers.get(id);
    }
    has(id) {
        return this.providers.has(id);
    }
    list() {
        return Array.from(this.providers.values());
    }
    clear() {
        this.providers.clear();
    }
    get size() {
        return this.providers.size;
    }
}
export class SkillRegistry {
    skills = new Map();
    register(skill) {
        if (this.skills.has(skill.id)) {
            throw new RegistryError(`Skill "${skill.id}" is already registered`);
        }
        this.skills.set(skill.id, skill);
    }
    get(id) {
        return this.skills.get(id);
    }
    has(id) {
        return this.skills.has(id);
    }
    list() {
        return Array.from(this.skills.values());
    }
    clear() {
        this.skills.clear();
    }
    get size() {
        return this.skills.size;
    }
    allTools() {
        const seen = new Set();
        const result = [];
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
//# sourceMappingURL=registry.js.map