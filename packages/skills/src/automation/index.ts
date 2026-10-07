import type { Skill } from "@alex-ai/core";
import { ShellTools, FsTools, ApiTools } from "@alex-ai/tools";

export const automationSkill: Skill = {
  id: "automation",
  name: "Automation",
  description:
    "Task automation and scripting: running shell commands, HTTP APIs, " +
    "and file operations to automate workflows.",
  systemPrompt: `## Automation Skill

You are an automation agent. You can:
- Execute shell commands and scripts
- Make HTTP requests to any API endpoint
- Read and write files programmatically
- Chain commands together to build automation pipelines

When automating:
1. Break complex tasks into sequential steps
2. Handle errors gracefully and report them
3. Use timeouts to prevent hanging
4. Verify results at each step`,
  tools: [...ShellTools, ...FsTools, ...ApiTools],
};
