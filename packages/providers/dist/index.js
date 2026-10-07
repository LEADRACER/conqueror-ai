const OMNIROUTE_DEFAULT_URL = "http://localhost:3000";
export class OpenAICompatibleProvider {
    id;
    name;
    models;
    options;
    constructor(id, name, options) {
        this.id = id;
        this.name = name;
        this.models = options.models;
        this.options = options;
    }
    async chat(messages, opts) {
        const modelID = this.options.modelMap?.[opts.model] ?? opts.model;
        const url = new URL("/v1/chat/completions", this.options.baseURL);
        const body = {
            model: modelID,
            messages: this.toOpenAIMessages(messages),
            stream: opts.stream ?? false,
        };
        if (opts.temperature !== undefined)
            body["temperature"] = opts.temperature;
        if (opts.topP !== undefined)
            body["top_p"] = opts.topP;
        if (opts.maxOutputTokens !== undefined)
            body["max_tokens"] = opts.maxOutputTokens;
        const openAITools = this.toOpenAITools(opts.tools);
        if (openAITools.length > 0)
            body["tools"] = openAITools;
        const headers = {
            "Content-Type": "application/json",
        };
        if (this.options.apiKey) {
            headers["Authorization"] = `Bearer ${this.options.apiKey}`;
        }
        if (opts.stream && opts.onChunk) {
            return this.streamChat(url.toString(), headers, body, opts.onChunk);
        }
        const init = {
            method: "POST",
            headers,
            body: JSON.stringify(body),
        };
        const resp = await fetch(url.toString(), init);
        if (!resp.ok) {
            const text = await resp.text();
            throw new Error(`Provider error ${resp.status}: ${text.slice(0, 500)}`);
        }
        const data = (await resp.json());
        const choice = data.choices[0];
        if (!choice) {
            throw new Error("No choices in provider response");
        }
        const content = choice.message?.content;
        const reason = choice.message?.reasoning_content;
        let toolCalls = [];
        if (choice.message?.tool_calls) {
            for (const tc of choice.message.tool_calls) {
                toolCalls.push({
                    id: tc.id,
                    name: tc.function.name,
                    arguments: this.parseArgs(tc.function.arguments),
                });
            }
        }
        const usage = data.usage;
        const result = {
            role: "assistant",
            finishReason: this.mapFinishReason(choice.finish_reason),
        };
        if (content)
            result.content = content;
        if (reason)
            result.reasoning = reason;
        if (toolCalls.length > 0)
            result.toolCalls = toolCalls;
        if (usage) {
            result.usage = {
                input: usage.prompt_tokens ?? 0,
                output: usage.completion_tokens ?? 0,
                ...(usage.reasoning_tokens !== undefined ? { reasoning: usage.reasoning_tokens } : {}),
            };
        }
        return result;
    }
    async streamChat(url, headers, body, onChunk) {
        const init = {
            method: "POST",
            headers,
            body: JSON.stringify(body),
        };
        const resp = await fetch(url, init);
        if (!resp.ok) {
            const text = await resp.text();
            throw new Error(`Provider error ${resp.status}: ${text.slice(0, 500)}`);
        }
        if (!resp.body) {
            throw new Error("Streaming response has no body");
        }
        const reader = resp.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let fullContent = "";
        let fullReasoning = "";
        let toolCallBuffer = {};
        let finishReason = "stop";
        let usage;
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split("\n").filter((l) => l.startsWith("data:"));
            for (const line of lines) {
                const dataStr = line.slice(5).trim();
                if (dataStr === "[DONE]" || dataStr === "")
                    continue;
                try {
                    const data = JSON.parse(dataStr);
                    const choice = data.choices?.[0];
                    if (!choice)
                        continue;
                    if (choice.delta?.content) {
                        fullContent += choice.delta.content;
                        onChunk({ content: choice.delta.content });
                    }
                    if (choice.delta?.reasoning_content) {
                        fullReasoning += choice.delta.reasoning_content;
                        onChunk({ reasoning: choice.delta.reasoning_content });
                    }
                    if (choice.delta?.tool_calls) {
                        for (const tc of choice.delta.tool_calls) {
                            const idx = tc.index;
                            if (!toolCallBuffer[idx]) {
                                toolCallBuffer[idx] = {
                                    id: tc.id ?? `tool-${idx}`,
                                    name: tc.function?.name ?? "",
                                    argString: tc.function?.arguments ?? "",
                                };
                            }
                            else {
                                const existing = toolCallBuffer[idx];
                                if (tc.function?.arguments) {
                                    existing.argString += tc.function.arguments;
                                }
                                if (tc.function?.name)
                                    existing.name = tc.function.name;
                            }
                        }
                    }
                    if (choice.finish_reason) {
                        finishReason = this.mapFinishReason(choice.finish_reason);
                    }
                    if (data.usage) {
                        usage = {
                            input: data.usage.prompt_tokens ?? 0,
                            output: data.usage.completion_tokens ?? 0,
                            ...(data.usage.reasoning_tokens !== undefined
                                ? { reasoning: data.usage.reasoning_tokens }
                                : {}),
                        };
                    }
                }
                catch {
                    continue;
                }
            }
        }
        const allToolCalls = Object.values(toolCallBuffer).map((tc) => ({
            id: tc.id,
            name: tc.name,
            arguments: this.parseArgs(tc.argString),
        }));
        const result = {
            role: "assistant",
            finishReason,
        };
        if (fullContent)
            result.content = fullContent;
        if (fullReasoning)
            result.reasoning = fullReasoning;
        if (allToolCalls.length > 0)
            result.toolCalls = allToolCalls;
        if (usage)
            result.usage = usage;
        return result;
    }
    toOpenAIMessages(messages) {
        const result = [];
        for (const msg of messages) {
            if (msg.role === "system") {
                result.push({ role: "system", content: msg.content ?? "" });
            }
            else if (msg.role === "user") {
                result.push({ role: "user", content: msg.content ?? "" });
            }
            else if (msg.role === "assistant") {
                const m = { role: "assistant" };
                if (msg.content)
                    m.content = msg.content;
                if (msg.toolCalls && msg.toolCalls.length > 0) {
                    m.tool_calls = msg.toolCalls.map((tc) => ({
                        id: tc.id,
                        type: "function",
                        function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
                    }));
                }
                result.push(m);
            }
            else if (msg.role === "tool") {
                const m = {
                    role: "tool",
                    content: msg.content ?? "",
                };
                if (msg.metadata?.toolCallId) {
                    m.tool_call_id = msg.metadata.toolCallId;
                }
                result.push(m);
            }
        }
        return result;
    }
    toOpenAITools(tools) {
        if (!tools || tools.length === 0)
            return [];
        return tools.map((t) => ({
            type: "function",
            function: {
                name: t.name,
                description: t.description,
                parameters: this.zodToSchema(t.args),
            },
        }));
    }
    zodToSchema(shape) {
        const properties = {};
        const required = [];
        for (const [key, schema] of Object.entries(shape)) {
            const entry = this.zodFieldToSchema(schema);
            properties[key] = entry;
            if (!entry.optional) {
                required.push(key);
            }
        }
        const result = {
            type: "object",
            properties,
            additionalProperties: false,
        };
        if (required.length > 0) {
            result.required = required;
        }
        return result;
    }
    zodFieldToSchema(schema) {
        const t = schema._def?.typeName;
        let optional = false;
        let type = "string";
        switch (t) {
            case "ZodString":
                type = "string";
                break;
            case "ZodNumber":
                type = "number";
                break;
            case "ZodBoolean":
                type = "boolean";
                break;
            case "ZodEnum":
                type = "string";
                break;
            case "ZodArray":
                type = "array";
                break;
            case "ZodObject":
                type = "object";
                break;
            default:
                type = "string";
        }
        if (schema._def?.typeName === "ZodOptional" || schema._def?.typeName === "ZodNullable") {
            optional = true;
        }
        return { type, optional };
    }
    parseArgs(raw) {
        if (!raw || raw.trim() === "")
            return {};
        try {
            return JSON.parse(raw);
        }
        catch {
            return { raw };
        }
    }
    mapFinishReason(reason) {
        if (!reason)
            return "stop";
        if (reason === "tool_calls" || reason === "function_call")
            return "tool_calls";
        if (reason === "length")
            return "length";
        if (reason === "error")
            return "error";
        return "stop";
    }
}
export class OmnirouteProvider extends OpenAICompatibleProvider {
    constructor(options) {
        const baseURL = options.baseURL ?? OMNIROUTE_DEFAULT_URL;
        const opts = {
            baseURL,
            models: options.models ?? ["gpt-4o", "claude-3-5-sonnet-20241022"],
        };
        if (options.apiKey) {
            opts.apiKey = options.apiKey;
        }
        super("omniroute", "Omniroute", opts);
    }
}
const OPENCODE_DEFAULT_URL = "http://localhost:4000";
export class OpenCodeProvider extends OpenAICompatibleProvider {
    constructor(options = {}) {
        const baseURL = options.baseURL ?? OPENCODE_DEFAULT_URL;
        const opts = {
            baseURL,
            models: options.models ?? ["claude-3-5-sonnet-20241022", "gpt-4o", "o1-preview"],
        };
        if (options.apiKey) {
            opts.apiKey = options.apiKey;
        }
        if (options.modelMap) {
            opts.modelMap = options.modelMap;
        }
        super("opencode", "OpenCode", opts);
    }
}
//# sourceMappingURL=index.js.map