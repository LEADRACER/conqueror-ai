import type { AlexContext, ToolDefinition, Provider, Message } from "@alex-ai/core";
import { AgentLoop } from "@alex-ai/runtime";
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
export declare function createUnifiedContext(opts?: UnifiedOptions): AlexContext;
export interface UnifiedAgentResult {
    ctx: AlexContext;
    agent: AgentLoop;
    history: Message[];
}
export declare function runUnifiedAgent(request: string, opts?: UnifiedOptions): Promise<UnifiedAgentResult>;
export declare function createOpenAICompatibleProvider(id: string, name: string, options: {
    baseURL: string;
    apiKey?: string;
    models: string[];
    modelMap?: Record<string, string>;
}): Provider;
export { OmnirouteProvider, OpenCodeProvider, OpenAICompatibleProvider } from "@alex-ai/providers";
export type { Provider } from "@alex-ai/core";
export { allTools, InteropTools, OpencodeRunTool, allToolsWithInterop } from "@alex-ai/tools";
export type { ToolDefinition, AlexContext, AgentConfig, Message, ToolCall, ToolOutput } from "@alex-ai/core";
export { AgentLoop } from "@alex-ai/runtime";
//# sourceMappingURL=index.d.ts.map