import type { Skill } from "@alex-ai/core";
import { FsTools, ShellTools } from "@alex-ai/tools";

export const codingSkill: Skill = {
  id: "coding",
  name: "Coding",
  description:
    "Programming and code manipulation skills: reading, writing, editing " +
    "files, running builds, searching code, and executing shell commands.",
  systemPrompt: `## Coding Skill

You are an expert coding assistant. You can:
- Read, write, and edit files with surgical precision
- Run build, test, and lint commands
- Search codebases using grep/ripgrep
- Execute shell commands for git, package management, and automation
- Reason about TypeScript, JavaScript, Python, Go, Rust, and many other languages

When making changes:
1. First understand the codebase structure and conventions
2. Make minimal, targeted changes
3. Verify with type checking and tests
4. Follow existing patterns and style`,
  tools: [
    ...FsTools,
    ...ShellTools,
  ],
};
