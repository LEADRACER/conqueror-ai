import { WebTools } from "@alex-ai/tools";
export const researchSkill = {
    id: "research",
    name: "Research",
    description: "Web research and information gathering: fetching web pages, searching " +
        "the web, synthesizing findings into summaries.",
    systemPrompt: `## Research Skill

You are a research assistant. You can:
- Fetch web pages and extract readable content
- Search the web for up-to-date information
- Synthesize multiple sources into coherent summaries
- Verify claims against multiple sources

Approach research methodically:
1. Search for relevant sources
2. Fetch and read key pages
3. Cross-reference claims
4. Synthesize findings with citations`,
    tools: [...WebTools],
};
//# sourceMappingURL=index.js.map