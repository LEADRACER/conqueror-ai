import type { Plan, PlanStep } from "./types.js";
export declare const generateID: () => string;
export declare class TaskGraph {
    private plans;
    private steps;
    private edges;
    createPlan(title: string, parent?: string | undefined): Plan;
    addStep(planID: string, step: Omit<PlanStep, "id" | "dependsOn" | "status"> & {
        dependsOn?: string[];
    }): PlanStep;
    getPlan(id: string): Plan | undefined;
    getStep(id: string): PlanStep | undefined;
    setStepStatus(stepID: string, status: PlanStep["status"]): void;
    readySteps(planID: string): PlanStep[];
    private isReady;
    removePlan(id: string): void;
    serialize(): unknown;
}
//# sourceMappingURL=taskgraph.d.ts.map