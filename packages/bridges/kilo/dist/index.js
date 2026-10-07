import { tool } from "@kilocode/plugin";
import { AlexContext, generateID } from "@alex-ai/core";
import { allTools, InteropTools } from "@alex-ai/tools";
function buildEnv() {
    const env = {};
    for (const [k, v] of Object.entries(process.env)) {
        if (v !== undefined) {
            env[k] = v;
        }
    }
    return env;
}
const sharedEnv = buildEnv();
function createAlexContext(input) {
    const ctx = new AlexContext(input.directory, input.worktree, generateID());
    for (const t of allTools) {
        ctx.tools.register(t);
    }
    return ctx;
}
function makeAlexToolContext(kctx, alexCtx) {
    return {
        sessionID: kctx.sessionID,
        messageID: kctx.messageID,
        directory: kctx.directory,
        worktree: kctx.worktree,
        abort: kctx.abort,
        env: sharedEnv,
        callTool: async (call) => alexCtx.callTool(call.name, call.arguments),
        ask: async () => {
            throw new Error("ask() not supported in Kilo bridge");
        },
        metadata: (input) => kctx.metadata(input),
    };
}
const AlexPlugin = async (input, _options) => {
    const alexCtx = createAlexContext(input);
    for (const t of InteropTools) {
        alexCtx.tools.register(t);
    }
    const kiloTools = {};
    for (const alexTool of alexCtx.tools.list()) {
        kiloTools[alexTool.name] = tool({
            description: alexTool.description,
            args: alexTool.args,
            async execute(args, kctx) {
                const ctx = makeAlexToolContext(kctx, alexCtx);
                const result = await alexTool.handler(args, ctx);
                return result;
            },
        });
    }
    return {
        tool: kiloTools,
        auth: {
            provider: "omniroute",
            methods: [
                {
                    type: "api",
                    label: "Omniroute API",
                    prompts: [
                        {
                            type: "text",
                            key: "apiKey",
                            message: "Enter your Omniroute API key",
                            placeholder: "sk-...",
                        },
                    ],
                    async authorize(inputs) {
                        const key = inputs?.apiKey;
                        if (!key) {
                            return { type: "failed" };
                        }
                        return { type: "success", key, provider: "omniroute" };
                    },
                },
            ],
        },
        provider: {
            id: "omniroute",
        },
    };
};
export default AlexPlugin;
export { AlexPlugin };
//# sourceMappingURL=index.js.map