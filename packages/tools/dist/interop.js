import { defineTool, schema } from "@alex-ai/core";
import { runShell } from "./shell.js";
const z = schema;
function escapeShellArg(str) {
    return "'" + str.replace(/'/g, "'\\''") + "'";
}
export const OpencodeRunTool = defineTool({
    name: "opencode_run",
    description: "Invoke the OpenCode CLI to run a prompt in a separate OpenCode session. " +
        "This lets Alex leverage OpenCode's own agent loop, tools, and context. " +
        "The OpenCode process runs to completion and returns its final answer. " +
        "Use this to delegate tasks to OpenCode when its tooling or context is more suitable.",
    args: {
        prompt: z.string().describe("The task or prompt to send to OpenCode"),
        cwd: z.string().optional().describe("Working directory for the OpenCode session (defaults to current directory)"),
        timeout: z
            .number()
            .int()
            .min(1)
            .optional()
            .default(60000)
            .describe("Timeout in milliseconds (default 60000)"),
        model: z.string().optional().describe("Optional model override to pass to OpenCode via --model"),
        provider: z.string().optional().describe("Optional provider override to pass to OpenCode via --provider"),
    },
    async handler(args, ctx) {
        const parts = ["npx", "-y", "@opencode-ai/cli", "-p"];
        if (args.provider !== undefined) {
            parts.push("--provider", escapeShellArg(args.provider));
        }
        if (args.model !== undefined) {
            parts.push("--model", escapeShellArg(args.model));
        }
        parts.push(escapeShellArg(args.prompt));
        const command = parts.join(" ");
        const r = await runShell(command, args.cwd ?? ctx.directory, args.timeout, ctx.abort);
        if (r.exitCode !== 0 && r.stderr) {
            return { output: r.stdout, metadata: { stderr: r.stderr, exitCode: r.exitCode } };
        }
        return r.stdout.trim();
    },
});
export const InteropTools = [OpencodeRunTool];
//# sourceMappingURL=interop.js.map