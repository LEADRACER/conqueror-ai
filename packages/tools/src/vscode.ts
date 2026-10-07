import { defineTool, schema } from "@alex-ai/core";
import type { ToolDefinition } from "@alex-ai/core";
import { runShell } from "./shell.js";

const z = schema;

export const VscodeListInstalledTool: ToolDefinition = defineTool({
  name: "vscode_list_installed",
  description:
    "List all installed VS Code extensions. Returns a JSON array of " +
    "{ id, name, version } objects.",
  args: {
    codePath: z.string().optional().describe("Path to the 'code' CLI binary (default: 'code')"),
  },
  async handler(args, ctx) {
    const binary = args.codePath ?? "code";
    const r = await runShell(
      `${binary} --list-extensions --show-versions`,
      ctx.directory,
      15000,
      ctx.abort
    );
    if (r.exitCode !== 0) {
      return { output: r.stderr || r.stdout || "Failed to list extensions", metadata: { exitCode: r.exitCode } };
    }
    const lines = r.stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const extensions = lines.map((line) => {
      const parts = line.split("@");
      const id = parts[0] ?? "";
      const version = parts.slice(1).join("@") ?? "";
      const name = id.split(".").pop() ?? id;
      return { id, name, version };
    });
    return { output: JSON.stringify(extensions, null, 2), metadata: { count: extensions.length } };
  },
});

export const VscodeInstallTool: ToolDefinition = defineTool({
  name: "vscode_install",
  description:
    "Install a VS Code extension from the marketplace by extension ID " +
    "(e.g. 'ms-python.python'). Can also install from a .vsix file path.",
  args: {
    extensionId: z.string().describe("Extension ID (e.g. 'ms-python.python') or path to .vsix file"),
    codePath: z.string().optional().describe("Path to the 'code' CLI binary (default: 'code')"),
    force: z.boolean().optional().describe("Reinstall even if already installed"),
    timeout: z.number().int().min(1).optional().default(120000).describe("Timeout in ms (default 120000)"),
  },
  async handler(args, ctx) {
    const binary = args.codePath ?? "code";
    const parts = [binary, "--install-extension", JSON.stringify(args.extensionId)];
    if (args.force) parts.push("--force");
    const command = parts.join(" ");
    const r = await runShell(command, ctx.directory, args.timeout, ctx.abort);
    const output = r.stdout || r.stderr;
    if (r.exitCode !== 0) {
      return { output, metadata: { exitCode: r.exitCode, success: false } };
    }
    return { output, metadata: { exitCode: r.exitCode, success: true } };
  },
});

export const VscodeUninstallTool: ToolDefinition = defineTool({
  name: "vscode_uninstall",
  description:
    "Uninstall a VS Code extension by extension ID (e.g. 'ms-python.python').",
  args: {
    extensionId: z.string().describe("Extension ID to uninstall"),
    codePath: z.string().optional().describe("Path to the 'code' CLI binary (default: 'code')"),
  },
  async handler(args, ctx) {
    const binary = args.codePath ?? "code";
    const command = `${binary} --uninstall-extension ${JSON.stringify(args.extensionId)}`;
    const r = await runShell(command, ctx.directory, 30000, ctx.abort);
    const output = r.stdout || r.stderr;
    if (r.exitCode !== 0) {
      return { output, metadata: { exitCode: r.exitCode, success: false } };
    }
    return { output, metadata: { exitCode: r.exitCode, success: true } };
  },
});

export const VscodeSearchMarketplaceTool: ToolDefinition = defineTool({
  name: "vscode_search_marketplace",
  description:
    "Search for VS Code extensions by keyword. " +
    "Returns a JSON array of { id, name, description, version }.",
  args: {
    query: z.string().describe("Search query (e.g. 'python', 'git')"),
  },
  async handler(args) {
    const encoded = encodeURIComponent(args.query);
    const url = `https://registry.npmjs.org/-/v1/search?text=${encoded}&keywords=vscode&size=10`;
    const resp = await fetch(url);
    if (!resp.ok) {
      return `Error: HTTP ${resp.status} ${resp.statusText}`;
    }
    const data = (await resp.json()) as {
      objects?: Array<{
        package: {
          name: string;
          description: string;
          version: string;
        };
      }>;
    };
    const results = (data.objects ?? []).map((obj) => ({
      id: obj.package.name,
      name: obj.package.name,
      description: obj.package.description ?? "",
      version: obj.package.version,
    }));
    return JSON.stringify(results, null, 2);
  },
});

export const VscodeCommandTool: ToolDefinition = defineTool({
  name: "vscode_command",
  description:
    "Execute a VS Code command (e.g. 'editor.action.formatDocument', " +
    "'workbench.action.files.saveAll'). Only available when running inside " +
    "a VS Code host (e.g. Kilo extension). Returns the command output.",
  args: {
    command: z.string().describe("VS Code command ID to execute"),
    args: z.array(z.any()).optional().describe("Arguments to pass to the command"),
  },
  async handler(_args, ctx) {
    if (ctx.metadata) {
      ctx.metadata({ title: `VS Code: ${_args.command}` });
    }
    return {
      output: `Command "${_args.command}" was signaled but the VS Code host bridge must intercept this and route to the extension host.`,
      metadata: { pending: true },
    };
  },
});

export const VscodeTools: ToolDefinition[] = [
  VscodeListInstalledTool,
  VscodeInstallTool,
  VscodeUninstallTool,
  VscodeSearchMarketplaceTool,
  VscodeCommandTool,
];
