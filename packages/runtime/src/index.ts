import type {
  AgentConfig,
  Message,
  ToolCall,
  ToolDefinition,
  ToolOutput,
} from "@alex-ai/core";
import { AlexContext } from "@alex-ai/core";
import { OpenCodeProvider, OmnirouteProvider } from "@alex-ai/providers";
import { allSkills } from "@alex-ai/skills";
import { allTools } from "@alex-ai/tools";
import { MemoryManager } from "@alex-ai/experience";
import { setMemoryManager } from "@alex-ai/tools";

export class ToolDispatcher {
  constructor(readonly ctx: AlexContext) {}

  async execute(call: ToolCall): Promise<ToolOutput> {
    const tool = this.ctx.tools.get(call.name);
    if (!tool) {
      return {
        output: `Tool "${call.name}" not found. Available: ${this.ctx.tools.list().map((t) => t.name).join(", ")}`,
        metadata: { error: "tool_not_found" },
      };
    }
    try {
      return await tool.handler(call.arguments, this.ctx.createToolContext());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { output: `Error: ${msg}`, metadata: { error: "handler_error" } };
    }
  }

  async executeAll(calls: ToolCall[]): Promise<ToolOutput[]> {
    return Promise.all(calls.map((c) => this.execute(c)));
  }
}

export class AgentLoop {
  readonly dispatcher: ToolDispatcher;
  private lastHistory: Message[] = [];
  private memoryManager: MemoryManager | null = null;

  constructor(readonly ctx: AlexContext, readonly config: AgentConfig, dispatcher?: ToolDispatcher) {
    this.dispatcher = dispatcher ?? new ToolDispatcher(ctx);
  }

  get memory(): MemoryManager | null {
    return this.memoryManager;
  }

  static async createDefault(
    directory: string,
    config: Partial<AgentConfig> = {},
    opts: { extraTools?: ToolDefinition[] } = {}
  ): Promise<{ ctx: AlexContext; agent: AgentLoop }> {
    const ctx = new AlexContext(directory, directory);

    const merged: AgentConfig = {
      provider: config.provider ?? "opencode",
      model: config.model ?? "gpt-4o",
      maxSteps: config.maxSteps ?? 50,
      maxRetries: config.maxRetries ?? 3,
    };
    if (config.temperature !== undefined) merged.temperature = config.temperature;
    if (config.topP !== undefined) merged.topP = config.topP;
    if (config.maxOutputTokens !== undefined) merged.maxOutputTokens = config.maxOutputTokens;
    if (config.baseURL !== undefined) merged.baseURL = config.baseURL;
    if (config.apiKey !== undefined) merged.apiKey = config.apiKey;
    if (config.skills !== undefined) merged.skills = config.skills;

    const providerOpts: { baseURL?: string; apiKey?: string } = {};
    if (merged.baseURL) {
      providerOpts.baseURL = merged.baseURL;
    }
    if (merged.apiKey) {
      providerOpts.apiKey = merged.apiKey;
    }
    const provider = new OpenCodeProvider(providerOpts);
    ctx.providers.register(provider);

    if (merged.provider === "omniroute") {
      ctx.providers.register(
        new OmnirouteProvider({ baseURL: merged.baseURL ?? "http://localhost:3000", ...(merged.apiKey !== undefined ? { apiKey: merged.apiKey } : {}) })
      );
    }

    for (const skill of allSkills) {
      if (!merged.skills || merged.skills.includes(skill.id)) {
        ctx.skills.register(skill);
      }
    }
    for (const tool of allTools) {
      ctx.tools.register(tool);
    }
    for (const tool of opts.extraTools ?? []) {
      ctx.tools.register(tool);
    }

    const memoryManager = new MemoryManager();
    setMemoryManager(memoryManager);

    const agent = new AgentLoop(ctx, merged);
    agent.memoryManager = memoryManager;
    return { ctx, agent };
  }

  async run(
    request: string,
    onProgress?: (msg: Message) => void,
    opts?: {
      stream?: boolean;
      timeout?: number;
      signal?: AbortSignal;
      provider?: string;
      model?: string;
      onChunk?: (delta: { content?: string; reasoning?: string; toolCall?: ToolCall }) => void;
    }
  ): Promise<Message[]> {
    const providerID = opts?.provider ?? this.config.provider;
    const model = opts?.model ?? this.config.model;
    const provider = this.ctx.providers.get(providerID);
    if (!provider) {
      throw new Error(`Provider "${providerID}" not registered`);
    }

    const history: Message[] = [];
    history.push({ role: "system", content: this.ctx.systemPrompt() });
    history.push({ role: "user", content: request });

    if (this.memoryManager) {
      const relevant = await this.memoryManager.searchByContent(request, {
        minImportance: 0.3,
      });
      if (relevant.length > 0) {
        const memContext = relevant
          .slice(0, 5)
          .map(
            (r) =>
              `[${r.entry.type}] ${r.entry.content} (importance: ${r.entry.importance.toFixed(1)})`
          )
          .join("\n");
        history.splice(1, 0, {
          role: "system",
          content: `## Relevant memories from past sessions:\n${memContext}`,
        });
      }
    }

    const toolDefs: ToolDefinition[] = this.ctx.listTools();
    let steps = 0;
    const maxSteps = this.config.maxSteps ?? 50;
    let usageTotal: { input: number; output: number } | undefined;

    const controller = new AbortController();
    const timeoutVal = opts?.timeout ?? 120000;
    const timeoutId = setTimeout(() => controller.abort(), timeoutVal);
    const externalAbort = () => controller.abort();
    if (opts?.signal) {
      if (opts.signal.aborted) {
        controller.abort();
      } else {
        opts.signal.addEventListener("abort", externalAbort);
      }
    }

    try {
      while (steps < maxSteps) {
        if (controller.signal.aborted) {
          throw new Error("Run aborted");
        }
        steps++;
        const chatOpts: {
          model: string;
          tools: ToolDefinition[];
          stream?: boolean;
          signal?: AbortSignal;
          onChunk?: (delta: { content?: string; reasoning?: string; toolCall?: ToolCall }) => void;
          temperature?: number;
          topP?: number;
          maxOutputTokens?: number;
        } = {
          model,
          tools: toolDefs,
          signal: controller.signal,
        };
        if (opts?.stream) {
          chatOpts.stream = true;
          if (opts.onChunk) {
            chatOpts.onChunk = opts.onChunk;
          }
        }
        if (this.config.temperature !== undefined) chatOpts.temperature = this.config.temperature;
        if (this.config.topP !== undefined) chatOpts.topP = this.config.topP;
        if (this.config.maxOutputTokens !== undefined) chatOpts.maxOutputTokens = this.config.maxOutputTokens;

        const resp = await provider.chat(history, chatOpts);

        if (resp.usage) {
          usageTotal = usageTotal
            ? {
                input: usageTotal.input + resp.usage.input,
                output: usageTotal.output + resp.usage.output,
              }
            : { input: resp.usage.input, output: resp.usage.output };
        }

        const assistantMsg: Message = {
          role: "assistant",
          content: resp.content ?? "",
        };
        if (resp.toolCalls && resp.toolCalls.length > 0) {
          assistantMsg.toolCalls = resp.toolCalls;
        }
        history.push(assistantMsg);
        onProgress?.(assistantMsg);

        if (resp.toolCalls && resp.toolCalls.length > 0) {
          for (const call of resp.toolCalls) {
            const result = await this.dispatcher.execute(call);
            const content = typeof result === "string" ? result : result.output;
            const toolMsg: Message = {
              role: "tool",
              content,
              metadata: {
                toolCallId: call.id,
                ...(typeof result === "object" ? result.metadata ?? {} : {}),
              },
            };
            history.push(toolMsg);
            onProgress?.(toolMsg);
          }
          continue;
        }

        if (resp.finishReason === "stop" || resp.finishReason === "length") {
          break;
        }
      }
    } finally {
      clearTimeout(timeoutId);
      if (opts?.signal) {
        opts.signal.removeEventListener("abort", externalAbort);
      }
    }

    this.lastHistory = history;

    const lastAssistant = [...history].reverse().find((m) => m.role === "assistant");
    if (lastAssistant && usageTotal) {
      lastAssistant.metadata = {
        ...(lastAssistant.metadata ?? {}),
        usage: usageTotal,
      };
    }

    if (this.memoryManager) {
      const finalAnswer = this.lastHistory.at(-1)?.content;
      if (finalAnswer && finalAnswer.length > 20 && finalAnswer.length < 2000) {
        await this.memoryManager.store(
          `Task: ${request}\nResult: ${finalAnswer}`,
          "episodic",
          {
            tags: ["task-completion", "auto"],
            importance: 0.4,
            sessionId: this.ctx.sessionID,
          }
        );
      }
    }

    return history;
  }

  get finalAnswer(): string {
    const last = this.lastHistory.at(-1);
    return last?.content ?? "";
  }
}

export { OmnirouteService, REMOTE_OMNIROUTE_URL } from "./service.js";
export type { OmnirouteServiceOptions } from "./service.js";
