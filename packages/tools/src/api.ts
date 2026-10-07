import { z } from "zod";
import { defineTool } from "@alex-ai/core";
import type { ToolDefinition } from "@alex-ai/core";

export const ApiTools: ToolDefinition[] = [
  defineTool({
    name: "http_request",
    description:
      "Make an HTTP request to any URL. Returns the response body and status. " +
      "Use this to call REST APIs, GraphQL endpoints, or any web service.",
    args: {
      url: z.string().url().describe("The URL to request"),
      method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH"]).optional().describe("HTTP method (default GET)"),
      headers: z.record(z.string(), z.string()).optional().describe("Request headers as JSON object"),
      body: z.string().optional().describe("Request body (raw text)"),
      timeout: z.number().int().min(1000).optional().describe("Timeout in ms (default 10000)"),
    },
    async handler(args, _ctx) {
      const timeout = args.timeout ?? 10000;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      try {
        const headers: Record<string, string> = { "User-Agent": "Alex-Agent/0.1" };
        if (args.headers) {
          Object.assign(headers, args.headers);
        }
        const init: RequestInit = {
          method: args.method ?? "GET",
          headers,
          signal: controller.signal,
        };
        if (args.body) {
          init.body = args.body;
        }
        const res = await fetch(args.url, init);
        const text = await res.text();
        const headerObj: Record<string, string> = {};
        res.headers.forEach((value, key) => {
          headerObj[key] = value;
        });
        return {
          output: text,
          metadata: {
            status: res.status,
            statusText: res.statusText,
            headers: headerObj,
          },
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return `HTTP error: ${msg}`;
      } finally {
        clearTimeout(timer);
      }
    },
  }),
];
