import type { Skill } from "@alex-ai/core";
import { codingSkill } from "./coding/index.js";
import { researchSkill } from "./research/index.js";
import { automationSkill } from "./automation/index.js";
import { creativeSkill } from "./creative/index.js";
import { browserSkill } from "./browser/index.js";
import { memorySkill } from "./memory/index.js";
export { codingSkill, researchSkill, automationSkill, creativeSkill, browserSkill, memorySkill };
export declare const allSkills: Skill[];
export declare const skillById: Map<string, Skill>;
export declare function getSkill(id: string): Skill | undefined;
export declare function listSkills(): Skill[];
//# sourceMappingURL=index.d.ts.map