import { ToolRegistry, ProviderRegistry, SkillRegistry } from "./registry.js";
import type { ToolContext, ToolCall, ToolOutput } from "./types.js";
import { generateID } from "./taskgraph.js";

export class Memory {
  private store: Record<string, unknown> = {};

  set(key: string, value: unknown): void {
    this.store[key] = value;
  }

  get<T = unknown>(key: string): T | undefined {
    return this.store[key] as T | undefined;
  }

  has(key: string): boolean {
    return key in this.store;
  }

  delete(key: string): boolean {
    return delete this.store[key];
  }

  keys(): string[] {
    return Object.keys(this.store);
  }

  clear(): void {
    this.store = {};
  }
}

export class AlexContext {
  readonly tools = new ToolRegistry();
  readonly providers = new ProviderRegistry();
  readonly skills = new SkillRegistry();
  readonly memory = new Memory();

  constructor(
    readonly directory: string,
    readonly worktree: string,
    readonly sessionID: string = generateID(),
    readonly abort: AbortSignal = new AbortController().signal,
    readonly env: Record<string, string> = {}
  ) {}

  async callTool(name: string, args: Record<string, unknown>): Promise<ToolOutput> {
    const tool = this.tools.get(name);
    if (!tool) {
      const available = this.tools.list().map((t) => t.name).join(", ");
      return { output: `Tool "${name}" not found. Available: ${available}` };
    }
    try {
      return await tool.handler(args, this.createToolContext());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { output: `Error executing tool "${name}": ${msg}` };
    }
  }

  createToolContext(): ToolContext {
    const self = this;
    return {
      sessionID: this.sessionID,
      messageID: generateID(),
      directory: this.directory,
      worktree: this.worktree,
      abort: this.abort,
      env: this.env,
      callTool: async (call: ToolCall): Promise<ToolOutput> =>
        self.callTool(call.name, call.arguments),
      ask: async () => {
        throw new Error("ask() not supported in CLI context");
      },
      metadata: () => {},
    };
  }

  listTools(): ReturnType<ToolRegistry["list"]> {
    return this.tools.list();
  }

  systemPrompt(): string {
    const skillPrompts = this.skills
      .list()
      .map((s) => `## ${s.name}\n${s.systemPrompt}`)
      .join("\n\n");
    return `You are Alex, a multihanded universal agent. You can perform any task using the available tools.\n${
      skillPrompts ? "\n" + skillPrompts : ""
    }`;
  }
}
