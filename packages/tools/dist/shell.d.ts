import type { ToolDefinition } from "@alex-ai/core";
export declare function runShell(command: string, cwd?: string, timeoutMs?: number, abort?: AbortSignal): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
}>;
export declare const ShellTools: ToolDefinition[];
//# sourceMappingURL=shell.d.ts.map