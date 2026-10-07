import type { Plugin, PluginInput } from "@kilocode/plugin";
import { tool } from "@kilocode/plugin";
import type { ToolContext as KiloToolContext, ToolResult } from "@kilocode/plugin";
import type { ToolContext as AlexToolContext } from "@alex-ai/core";
import { AlexContext, generateID } from "@alex-ai/core";
import { allTools, InteropTools } from "@alex-ai/tools";
import type { AnyTool } from "@alex-ai/core";

function buildEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) {
      env[k] = v;
    }
  }
  return env;
}

const sharedEnv = buildEnv();

function createAlexContext(input: PluginInput): AlexContext {
  const ctx = new AlexContext(input.directory, input.worktree, generateID());
  for (const t of allTools) {
    ctx.tools.register(t);
  }
  return ctx;
}

function makeAlexToolContext(kctx: KiloToolContext, alexCtx: AlexContext): AlexToolContext {
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

const AlexPlugin: Plugin = async (input: PluginInput, _options) => {
  const alexCtx = createAlexContext(input);
  for (const t of InteropTools) {
    alexCtx.tools.register(t);
  }

  const kiloTools: Record<string, ReturnType<typeof tool>> = {};

  for (const alexTool of alexCtx.tools.list() as AnyTool[]) {
    kiloTools[alexTool.name] = tool({
      description: alexTool.description,
      args: alexTool.args as any,
      async execute(args, kctx) {
        const ctx = makeAlexToolContext(kctx, alexCtx);
        const result = await alexTool.handler(args as any, ctx);
        return result as ToolResult;
      },
    });
  }

  return {
    tool: kiloTools,
    auth: {
      provider: "omniroute",
      methods: [
        {
          type: "api" as const,
          label: "Omniroute API",
          prompts: [
            {
              type: "text",
              key: "apiKey",
              message: "Enter your Omniroute API key",
              placeholder: "sk-...",
            },
          ],
          async authorize(inputs?: Record<string, string>) {
            const key = inputs?.apiKey;
            if (!key) {
              return { type: "failed" as const };
            }
            return { type: "success" as const, key, provider: "omniroute" };
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
