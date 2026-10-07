import type { Skill } from "@alex-ai/core";
import { codingSkill } from "./coding/index.js";
import { researchSkill } from "./research/index.js";
import { automationSkill } from "./automation/index.js";
import { creativeSkill } from "./creative/index.js";
import { browserSkill } from "./browser/index.js";
import { memorySkill } from "./memory/index.js";

export { codingSkill, researchSkill, automationSkill, creativeSkill, browserSkill, memorySkill };

export const allSkills: Skill[] = [codingSkill, researchSkill, automationSkill, creativeSkill, browserSkill, memorySkill];

export const skillById = new Map(allSkills.map((s) => [s.id, s] as const));

export function getSkill(id: string): Skill | undefined {
  return skillById.get(id);
}

export function listSkills(): Skill[] {
  return allSkills;
}
