import type { z } from "zod";
export type { z };
export interface ToolResult {
    output: string;
    metadata?: Record<string, unknown>;
    attachments?: ToolAttachment[];
}
export interface ToolAttachment {
    type: "file";
    mime: string;
    url: string;
    filename?: string;
}
export type ToolOutput = string | ToolResult;
export interface ToolDefinition<Args extends z.ZodRawShape = z.ZodRawShape> {
    name: string;
    description: string;
    args: Args;
    hidden?: boolean;
    handler: (args: z.infer<z.ZodObject<Args>>, context: ToolContext) => Promise<ToolOutput>;
}
export type AnyTool = ToolDefinition;
export declare function defineTool<Args extends z.ZodRawShape>(input: {
    name: string;
    description: string;
    args: Args;
    hidden?: boolean;
    handler: (args: z.infer<z.ZodObject<Args>>, context: ToolContext) => Promise<ToolOutput>;
}): ToolDefinition;
export interface ToolCall {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
}
export interface ToolContext {
    readonly sessionID: string;
    readonly messageID: string;
    readonly directory: string;
    readonly worktree: string;
    readonly abort: AbortSignal;
    readonly env: Record<string, string>;
    callTool(call: ToolCall): Promise<ToolOutput>;
    ask(input: AskInput): Promise<void>;
    metadata(input: {
        title?: string;
        metadata?: Record<string, unknown>;
    }): void;
}
export interface AskInput {
    permission: string;
    patterns: string[];
    always: string[];
    metadata: Record<string, unknown>;
}
export interface Message {
    role: "user" | "assistant" | "system" | "tool";
    content?: string;
    toolCalls?: ToolCall[];
    toolResult?: ToolOutput;
    metadata?: Record<string, unknown>;
}
export interface ProviderResponse {
    role: "assistant";
    content?: string;
    toolCalls?: ToolCall[];
    finishReason: "stop" | "tool_calls" | "length" | "error";
    usage?: {
        input: number;
        output: number;
        reasoning?: number;
    };
    reasoning?: string;
}
export interface Provider {
    readonly id: string;
    readonly name: string;
    readonly models: string[];
    chat(messages: Message[], options: {
        model: string;
        temperature?: number;
        topP?: number;
        maxOutputTokens?: number;
        tools?: AnyTool[];
        stream?: boolean;
        onChunk?: (delta: {
            content?: string;
            reasoning?: string;
            toolCall?: ToolCall;
        }) => void;
    }): Promise<ProviderResponse>;
}
export interface Skill {
    readonly id: string;
    readonly name: string;
    readonly description: string;
    readonly systemPrompt: string;
    readonly tools: AnyTool[];
    readonly priority?: number;
}
export interface AgentConfig {
    provider: string;
    model: string;
    temperature?: number;
    topP?: number;
    maxOutputTokens?: number;
    baseURL?: string;
    apiKey?: string;
    skills?: string[];
    maxSteps?: number;
    maxRetries?: number;
}
export interface Plan {
    readonly id: string;
    readonly title: string;
    readonly steps: PlanStep[];
    readonly parent?: string | undefined;
}
export interface PlanStep {
    readonly id: string;
    readonly description: string;
    readonly toolCalls?: ToolCall[] | undefined;
    readonly dependsOn: string[];
    status: "pending" | "running" | "done" | "failed";
}
//# sourceMappingURL=types.d.ts.map