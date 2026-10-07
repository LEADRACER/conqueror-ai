import { ToolRegistry, ProviderRegistry, SkillRegistry } from "./registry.js";
import { generateID } from "./taskgraph.js";
export class Memory {
    store = {};
    set(key, value) {
        this.store[key] = value;
    }
    get(key) {
        return this.store[key];
    }
    has(key) {
        return key in this.store;
    }
    delete(key) {
        return delete this.store[key];
    }
    keys() {
        return Object.keys(this.store);
    }
    clear() {
        this.store = {};
    }
}
export class AlexContext {
    directory;
    worktree;
    sessionID;
    abort;
    env;
    tools = new ToolRegistry();
    providers = new ProviderRegistry();
    skills = new SkillRegistry();
    memory = new Memory();
    constructor(directory, worktree, sessionID = generateID(), abort = new AbortController().signal, env = {}) {
        this.directory = directory;
        this.worktree = worktree;
        this.sessionID = sessionID;
        this.abort = abort;
        this.env = env;
    }
    async callTool(name, args) {
        const tool = this.tools.get(name);
        if (!tool) {
            const available = this.tools.list().map((t) => t.name).join(", ");
            return { output: `Tool "${name}" not found. Available: ${available}` };
        }
        try {
            return await tool.handler(args, this.createToolContext());
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { output: `Error executing tool "${name}": ${msg}` };
        }
    }
    createToolContext() {
        const self = this;
        return {
            sessionID: this.sessionID,
            messageID: generateID(),
            directory: this.directory,
            worktree: this.worktree,
            abort: this.abort,
            env: this.env,
            callTool: async (call) => self.callTool(call.name, call.arguments),
            ask: async () => {
                throw new Error("ask() not supported in CLI context");
            },
            metadata: () => { },
        };
    }
    listTools() {
        return this.tools.list();
    }
    systemPrompt() {
        const skillPrompts = this.skills
            .list()
            .map((s) => `## ${s.name}\n${s.systemPrompt}`)
            .join("\n\n");
        return `You are Alex, a multihanded universal agent. You can perform any task using the available tools.\n${skillPrompts ? "\n" + skillPrompts : ""}`;
    }
}
//# sourceMappingURL=context.js.map