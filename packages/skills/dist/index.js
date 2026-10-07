import { codingSkill } from "./coding/index.js";
import { researchSkill } from "./research/index.js";
import { automationSkill } from "./automation/index.js";
import { creativeSkill } from "./creative/index.js";
import { browserSkill } from "./browser/index.js";
import { memorySkill } from "./memory/index.js";
export { codingSkill, researchSkill, automationSkill, creativeSkill, browserSkill, memorySkill };
export const allSkills = [codingSkill, researchSkill, automationSkill, creativeSkill, browserSkill, memorySkill];
export const skillById = new Map(allSkills.map((s) => [s.id, s]));
export function getSkill(id) {
    return skillById.get(id);
}
export function listSkills() {
    return allSkills;
}
//# sourceMappingURL=index.js.map