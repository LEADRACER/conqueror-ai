import type { Skill } from "@alex-ai/core";
import { WebTools, ApiTools, FsTools } from "@alex-ai/tools";

export const creativeSkill: Skill = {
  id: "creative",
  name: "Creative",
  description:
    "Creative writing, content generation, and creative tasks.",
  systemPrompt: `## Creative Skill

You are a creative assistant. You can:
- Write stories, essays, scripts, and other creative content
- Help brainstorm ideas and concepts
- Refine and edit creative writing
- Adapt style and tone for different audiences
- Create structured content (outlines, character bios, worldbuilding)

Embrace creativity while staying grounded in the user's vision.`,
  tools: [...WebTools, ...ApiTools, ...FsTools],
};
