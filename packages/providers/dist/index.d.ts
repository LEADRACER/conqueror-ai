import type { Provider, ProviderResponse, ToolCall, ToolDefinition, Message } from "@alex-ai/core";
export interface OpenAICompatibleOptions {
    baseURL: string;
    apiKey?: string;
    models: string[];
    modelMap?: Record<string, string>;
}
export declare class OpenAICompatibleProvider implements Provider {
    readonly id: string;
    readonly name: string;
    readonly models: string[];
    private options;
    constructor(id: string, name: string, options: OpenAICompatibleOptions);
    chat(messages: Message[], opts: {
        model: string;
        temperature?: number;
        topP?: number;
        maxOutputTokens?: number;
        tools?: ToolDefinition[];
        stream?: boolean;
        onChunk?: (delta: {
            content?: string;
            reasoning?: string;
            toolCall?: ToolCall;
        }) => void;
    }): Promise<ProviderResponse>;
    private streamChat;
    private toOpenAIMessages;
    private toOpenAITools;
    private zodToSchema;
    private zodFieldToSchema;
    private parseArgs;
    private mapFinishReason;
}
export declare class OmnirouteProvider extends OpenAICompatibleProvider {
    constructor(options: {
        baseURL?: string;
        apiKey?: string;
        models?: string[];
    });
}
export interface OpenCodeProviderOptions {
    baseURL?: string;
    apiKey?: string;
    models?: string[];
    modelMap?: Record<string, string>;
}
export declare class OpenCodeProvider extends OpenAICompatibleProvider {
    constructor(options?: OpenCodeProviderOptions);
}
//# sourceMappingURL=index.d.ts.map