import type { AgentConfig, Message, ToolCall, ToolDefinition, ToolOutput } from "@alex-ai/core";
import { AlexContext } from "@alex-ai/core";
export declare class ToolDispatcher {
    readonly ctx: AlexContext;
    constructor(ctx: AlexContext);
    execute(call: ToolCall): Promise<ToolOutput>;
    executeAll(calls: ToolCall[]): Promise<ToolOutput[]>;
}
export declare class AgentLoop {
    readonly ctx: AlexContext;
    readonly config: AgentConfig;
    readonly dispatcher: ToolDispatcher;
    private lastHistory;
    private memoryManager;
    constructor(ctx: AlexContext, config: AgentConfig);
    static createDefault(directory: string, config?: Partial<AgentConfig>, opts?: {
        extraTools?: ToolDefinition[];
    }): Promise<{
        ctx: AlexContext;
        agent: AgentLoop;
    }>;
    run(request: string, onProgress?: (msg: Message) => void, opts?: {
        stream?: boolean;
        timeout?: number;
        onChunk?: (delta: {
            content?: string;
            reasoning?: string;
            toolCall?: ToolCall;
        }) => void;
    }): Promise<Message[]>;
    get finalAnswer(): string;
}
export { OmnirouteService, REMOTE_OMNIROUTE_URL } from "./service.js";
export type { OmnirouteServiceOptions } from "./service.js";
//# sourceMappingURL=index.d.ts.map