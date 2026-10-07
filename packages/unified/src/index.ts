import type { AlexContext, AgentConfig, ToolDefinition, Provider, Message } from "@alex-ai/core";
import { AlexContext as AlexContextImpl } from "@alex-ai/core";
import { OmnirouteProvider, OpenCodeProvider, OpenAICompatibleProvider } from "@alex-ai/providers";
import { AgentLoop } from "@alex-ai/runtime";
import { allSkills } from "@alex-ai/skills";
import { allTools, InteropTools } from "@alex-ai/tools";

export interface UnifiedOptions {
  directory?: string;
  baseURL?: string;
  apiKey?: string;
  provider?: string;
  model?: string;
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
  skills?: string[];
  maxSteps?: number;
  maxRetries?: number;
  extraTools?: ToolDefinition[];
  extraProviders?: Provider[];
  includeInterop?: boolean;
}

export function createUnifiedContext(opts: UnifiedOptions = {}): AlexContext {
  const directory = opts.directory ?? process.cwd();
  const ctx = new AlexContextImpl(directory, directory);

  for (const tool of InteropTools) {
    ctx.tools.register(tool);
  }
  for (const tool of allTools) {
    ctx.tools.register(tool);
  }
  for (const tool of opts.extraTools ?? []) {
    ctx.tools.register(tool);
  }

  if (opts.includeInterop !== false) {
    const omniOpts: {
      baseURL: string;
      models: string[];
      apiKey?: string;
    } = {
      baseURL: opts.baseURL ?? "http://localhost:3000",
      models: opts.model ? [opts.model] : ["gpt-4o", "claude-3-5-sonnet-20241022"],
    };
    if (opts.apiKey) {
      omniOpts.apiKey = opts.apiKey;
    }
    ctx.providers.register(new OmnirouteProvider(omniOpts));

    const ocOpts: { baseURL?: string } = {};
    if (opts.baseURL) {
      ocOpts.baseURL = opts.baseURL.replace(/\/v1$/, "");
    }
    const ocProvider = new OpenCodeProvider(ocOpts);
    if (!ctx.providers.has("opencode")) {
      ctx.providers.register(ocProvider);
    }
  }

  for (const provider of opts.extraProviders ?? []) {
    ctx.providers.register(provider);
  }

  for (const skill of allSkills) {
    if (!opts.skills || opts.skills.includes(skill.id)) {
      ctx.skills.register(skill);
    }
  }

  return ctx;
}

export interface UnifiedAgentResult {
  ctx: AlexContext;
  agent: AgentLoop;
  history: Message[];
}

export async function runUnifiedAgent(
  request: string,
  opts: UnifiedOptions = {}
): Promise<UnifiedAgentResult> {
  const ctx = createUnifiedContext(opts);

  const config: AgentConfig = {
    provider: opts.provider ?? "omniroute",
    model: opts.model ?? "gpt-4o",
    maxSteps: opts.maxSteps ?? 50,
    maxRetries: opts.maxRetries ?? 3,
  };
  if (opts.temperature !== undefined) config.temperature = opts.temperature;
  if (opts.topP !== undefined) config.topP = opts.topP;
  if (opts.maxOutputTokens !== undefined) config.maxOutputTokens = opts.maxOutputTokens;
  if (opts.skills !== undefined) config.skills = opts.skills;

  const agent = new AgentLoop(ctx, config);
  const history = await agent.run(request);

  return { ctx, agent, history };
}

export function createOpenAICompatibleProvider(
  id: string,
  name: string,
  options: { baseURL: string; apiKey?: string; models: string[]; modelMap?: Record<string, string> }
): Provider {
  return new OpenAICompatibleProvider(id, name, options);
}

export { OmnirouteProvider, OpenCodeProvider, OpenAICompatibleProvider } from "@alex-ai/providers";
export type { Provider } from "@alex-ai/core";
export { allTools, InteropTools, OpencodeRunTool, allToolsWithInterop } from "@alex-ai/tools";
export type { ToolDefinition, AlexContext, AgentConfig, Message, ToolCall, ToolOutput } from "@alex-ai/core";
export { AgentLoop } from "@alex-ai/runtime";
