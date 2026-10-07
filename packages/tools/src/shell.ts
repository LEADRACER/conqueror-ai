import { defineTool, schema } from "@alex-ai/core";
import type { ToolDefinition } from "@alex-ai/core";
import { spawn } from "node:child_process";

const z = schema;

export function runShell(
  command: string,
  cwd?: string,
  timeoutMs: number = 30000,
  abort?: AbortSignal
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
    if (abort) {
      abort.addEventListener("abort", () => controller.abort(), { once: true });
    }

    let stdout = "";
    let stderr = "";

    const child = spawn(command, {
      shell: "/bin/bash",
      cwd: cwd ?? process.cwd(),
      signal: controller.signal as any,
      env: { ...process.env },
    });

    child.stdout?.on("data", (d) => (stdout += d.toString()));
    child.stderr?.on("data", (d) => (stderr += d.toString()));

    child.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timeoutHandle);
      if (err.name === "AbortError") {
        resolve({ stdout, stderr: `Timed out after ${timeoutMs}ms`, exitCode: -1 });
      } else {
        reject(err);
      }
    });

    child.on("close", (code) => {
      clearTimeout(timeoutHandle);
      resolve({ stdout, stderr, exitCode: code ?? 0 });
    });
  });
}

export const ShellTools: ToolDefinition[] = [
  defineTool({
    name: "shell",
    description:
      "Execute a shell command in the working directory and return its stdout. " +
      "Use this for CLI operations, builds, git commands, or system tasks.",
    args: {
      command: z.string().describe("The shell command to execute"),
      cwd: z.string().optional().describe("Working directory (defaults to project directory)"),
      timeout: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("Timeout in milliseconds (default 30000)"),
    },
    async handler(args, ctx) {
      const r = await runShell(args.command, args.cwd, args.timeout ?? 30000, ctx.abort);
      if (r.exitCode !== 0 && r.stderr) {
        return { output: r.stdout, metadata: { stderr: r.stderr, exitCode: r.exitCode } };
      }
      return r.stdout;
    },
  }),
];
