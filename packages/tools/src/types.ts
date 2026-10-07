import type { ToolDefinition, ToolContext, ToolOutput, ToolResult } from "@alex-ai/core";

export interface ToolFactory {
  create(context: ToolContext): ToolDefinition;
}

export type { ToolDefinition, ToolContext, ToolResult, ToolOutput };
