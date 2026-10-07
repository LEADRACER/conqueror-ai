export { FsTools } from "./fs.js";
export { ShellTools } from "./shell.js";
export { WebTools } from "./web.js";
export { McpTools } from "./mcp.js";
export { ApiTools } from "./api.js";
export { InteropTools, OpencodeRunTool } from "./interop.js";
export { SubagentTools, SubagentStartTool, SubagentListTool } from "./subagent.js";
export { VscodeTools, VscodeInstallTool, VscodeListInstalledTool, VscodeUninstallTool, VscodeSearchMarketplaceTool, VscodeCommandTool } from "./vscode.js";
export { BrowserTools } from "./browser.js";
export { MemoryTools, setMemoryManager, getMemoryManager } from "./memory.js";

import { FsTools } from "./fs.js";
import { ShellTools } from "./shell.js";
import { WebTools } from "./web.js";
import { McpTools } from "./mcp.js";
import { ApiTools } from "./api.js";
import { InteropTools } from "./interop.js";
import { SubagentTools } from "./subagent.js";
import { VscodeTools } from "./vscode.js";
import { BrowserTools } from "./browser.js";
import { MemoryTools } from "./memory.js";
import type { ToolDefinition } from "@alex-ai/core";

export const allTools: ToolDefinition[] = [
  ...FsTools,
  ...ShellTools,
  ...WebTools,
  ...McpTools,
  ...ApiTools,
  ...VscodeTools,
  ...SubagentTools,
  ...BrowserTools,
  ...MemoryTools,
];

export const defaultTools: ToolDefinition[] = [
  ...FsTools,
  ...ShellTools,
  ...WebTools,
  ...ApiTools,
  ...VscodeTools,
  ...SubagentTools,
  ...MemoryTools,
];

export const interopTools: ToolDefinition[] = [
  ...InteropTools,
];

export const allToolsWithInterop: ToolDefinition[] = [
  ...allTools,
  ...InteropTools,
];
