import { z } from "zod";
import { defineTool } from "@alex-ai/core";
import type { ToolDefinition } from "@alex-ai/core";
import type { ToolContext } from "@alex-ai/core";

interface McpToolDef {
  name: string;
  description?: string;
}

interface McpListResult {
  tools: McpToolDef[];
}

interface McpCallResult {
  content: Array<{ type?: string; text?: string }>;
}

interface MCPClient {
  listTools(): Promise<McpListResult>;
  callTool(name: string, args: Record<string, unknown>): Promise<McpCallResult>;
  close(): Promise<void>;
}

let mcpClient: MCPClient | undefined;

export const McpTools: ToolDefinition[] = [
  defineTool({
    name: "mcp_list",
    description:
      "List all tools available from connected MCP servers. Returns the " +
      "names and descriptions of each accessible MCP tool.",
    args: {},
    async handler(_args, _ctx: ToolContext) {
      const client = await ensureMcp();
      const tools = await client.listTools();
      return JSON.stringify(
        tools.tools.map((t) => ({ name: t.name, description: t.description })),
        null,
        2
      );
    },
  }),

  defineTool({
    name: "mcp_call",
    description:
      "Call a tool exposed by an MCP server. Specify the tool name and " +
      "pass arguments as a JSON string.",
    args: {
      name: z.string().describe("Name of the MCP tool to call"),
      arguments: z.string().describe("Arguments as a JSON string"),
    },
    async handler(args, _ctx: ToolContext) {
      const client = await ensureMcp();
      let parsedArgs: Record<string, unknown>;
      try {
        parsedArgs = JSON.parse(args.arguments);
      } catch {
        return `Invalid JSON arguments: ${args.arguments}`;
      }
      const result = await client.callTool(args.name, parsedArgs);
      const content = Array.isArray(result.content)
        ? result.content.map((c) => c.text ?? JSON.stringify(c)).join("\n")
        : JSON.stringify(result.content);
      return content;
    },
  }),
];

async function ensureMcp(): Promise<MCPClient> {
  if (mcpClient) return mcpClient;
  const server = process.env.MCP_SERVER;
  if (!server) {
    return {
      listTools: async () => ({ tools: [] }),
      callTool: async () => ({
        content: [{ text: "MCP server not configured. Set MCP_SERVER env var to a command." }],
      }),
      close: async () => {},
    };
  }
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
  const client = new Client({ name: "alex-mcp", version: "1.0.0" });
  const transport = new StdioClientTransport({ command: server, args: [] });
  await client.connect(transport);
  mcpClient = client as unknown as MCPClient;
  return mcpClient;
}
