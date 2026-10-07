import { defineTool, schema } from "@alex-ai/core";
import type { ToolDefinition, ToolOutput } from "@alex-ai/core";
import { spawn } from "node:child_process";

const z = schema;

function escapeShellArg(str: string): string {
  return "'" + str.replace(/'/g, "'\\''") + "'";
}

export const SubagentStartTool: ToolDefinition = defineTool({
  name: "subagent_start",
  description:
    "Spawn a new Alex sub-agent to work on a specific task. The sub-agent " +
    "runs in a separate process with its own context, tools, and model " +
    "session. Use this to parallelize complex tasks or delegate " +
    "specialized work. Returns the sub-agent's final answer.",
  args: {
    task: z.string().describe("The task for the sub-agent to work on"),
    cwd: z.string().optional().describe("Working directory for the sub-agent"),
    model: z.string().optional().describe("Model override for the sub-agent"),
    timeout: z
      .number()
      .int()
      .min(1)
      .optional()
      .default(300000)
      .describe("Timeout in ms (default 300000)"),
    skills: z.array(z.string()).optional().describe("Skills to enable for the sub-agent"),
  },
  async handler(args, ctx) {
    const cliPath = process.argv[1] ?? "./packages/cli/dist/cli.js";
    const parts: string[] = [
      "node",
      JSON.stringify(cliPath),
    ];
    if (args.model !== undefined) {
      parts.push("--model", escapeShellArg(args.model));
    }
    if (args.timeout !== undefined) {
      parts.push("--timeout", String(args.timeout));
    }
    parts.push(escapeShellArg(args.task));
    const command = parts.join(" ");

    return new Promise<ToolOutput>((resolve) => {
      let stdout = "";
      let stderr = "";
      const child = spawn(command, {
        shell: "/bin/bash",
        cwd: args.cwd ?? ctx.directory,
        env: { ...ctx.env, ...process.env },
        signal: ctx.abort,
      });

      child.stdout?.on("data", (d) => (stdout += d.toString()));
      child.stderr?.on("data", (d) => (stderr += d.toString()));

      const timer = setTimeout(() => {
        child.kill("SIGKILL");
      }, args.timeout ?? 300000);

      child.on("error", (err: NodeJS.ErrnoException) => {
        clearTimeout(timer);
        resolve({
          output: `Sub-agent failed to start: ${err.message}`,
          metadata: { error: "spawn_error" },
        });
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        const output = stdout.trim() || stderr.trim();
        if (code !== 0 && code !== null) {
          resolve({
            output,
            metadata: { exitCode: code, success: false },
          });
        }
        resolve({ output, metadata: { exitCode: code, success: true } });
      });
    });
  },
});

export const SubagentListTool: ToolDefinition = defineTool({
  name: "subagent_list",
  description:
    "List all currently running sub-agents. Returns a JSON array.",
  args: {},
  async handler() {
    return JSON.stringify([], null, 2);
  },
});

export const SubagentTools: ToolDefinition[] = [SubagentStartTool, SubagentListTool];
