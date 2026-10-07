import { z } from "zod";
import { defineTool } from "@alex-ai/core";
import type { ToolDefinition } from "@alex-ai/core";

export const WebTools: ToolDefinition[] = [
  defineTool({
    name: "web_fetch",
    description:
      "Fetch the content of a URL and return the text content (HTML stripped to readable text). " +
      "Useful for reading web pages, documentation, and API responses.",
    args: {
      url: z.string().url().describe("The URL to fetch"),
      timeout: z.number().int().min(1000).optional().describe("Timeout in ms (default 10000)"),
    },
    async handler(args, _ctx) {
      const timeout = args.timeout ?? 10000;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      try {
        const res = await fetch(args.url, {
          signal: controller.signal,
          headers: { "User-Agent": "Alex-Agent/0.1" },
        });
        if (!res.ok) {
          return `HTTP ${res.status}: ${res.statusText}`;
        }
        const text = await res.text();
        return stripHtml(text).slice(0, 50000);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return `Fetch error: ${msg}`;
      } finally {
        clearTimeout(timer);
      }
    },
  }),

  defineTool({
    name: "web_search",
    description:
      "Perform a web search using DuckDuckGo and return top results as JSON. " +
      "Each result includes title, url, and snippet.",
    args: {
      query: z.string().describe("Search query"),
      num: z.number().int().min(1).max(20).optional().describe("Number of results (default 5)"),
    },
    async handler(args, _ctx) {
      const num = args.num ?? 5;
      const endpoint =
        "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(args.query);
      const res = await fetch(endpoint, {
        headers: { "User-Agent": "Alex-Agent/0.1" },
      });
      const html = await res.text();
      const results = parseSearchResults(html);
      return JSON.stringify(
        results.slice(0, num).map((r) => ({ title: r.title, url: r.url, snippet: r.snippet })),
        null,
        2
      );
    },
  }),
];

function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

function parseSearchResults(html: string): SearchResult[] {
  const results: SearchResult[] = [];
  const resultRegex = /<div[^>]*class="result[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
  let match: RegExpExecArray | null;
  while ((match = resultRegex.exec(html)) !== null) {
    const block = match[1]!;
    const titleMatch = /<a[^>]*class="result__a"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    const urlMatch = /<a[^>]*class="result__a"[^>]*href="([^"]*)"/i.exec(block);
    const snippetMatch = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    const title = titleMatch?.[1];
    const url = urlMatch?.[1];
    if (title && url) {
      results.push({
        title: stripHtml(title),
        url,
        snippet: snippetMatch?.[1] ? stripHtml(snippetMatch[1]) : "",
      });
    }
  }
  return results;
}
