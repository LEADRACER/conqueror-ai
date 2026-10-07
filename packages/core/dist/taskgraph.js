import { randomUUID } from "node:crypto";
export const generateID = () => randomUUID();
export class TaskGraph {
    plans = new Map();
    steps = new Map();
    edges = new Map();
    createPlan(title, parent) {
        const id = generateID();
        const plan = { id, title, steps: [], parent };
        this.plans.set(id, plan);
        return plan;
    }
    addStep(planID, step) {
        const plan = this.getPlan(planID);
        if (!plan) {
            throw new Error(`Plan "${planID}" not found`);
        }
        const id = generateID();
        const fullStep = {
            id,
            description: step.description,
            toolCalls: step.toolCalls,
            dependsOn: step.dependsOn ?? [],
            status: "pending",
        };
        this.steps.set(id, fullStep);
        this.edges.set(id, new Set());
        plan.steps.push(fullStep);
        return fullStep;
    }
    getPlan(id) {
        return this.plans.get(id);
    }
    getStep(id) {
        return this.steps.get(id);
    }
    setStepStatus(stepID, status) {
        const step = this.steps.get(stepID);
        if (!step) {
            throw new Error(`Step "${stepID}" not found`);
        }
        step.status = status;
    }
    readySteps(planID) {
        const plan = this.getPlan(planID);
        if (!plan)
            return [];
        return plan.steps.filter((s) => s.status === "pending" && this.isReady(s.id));
    }
    isReady(stepID) {
        const step = this.steps.get(stepID);
        if (!step)
            return false;
        return step.dependsOn.every((dep) => {
            const depStep = this.steps.get(dep);
            return depStep?.status === "done";
        });
    }
    removePlan(id) {
        const plan = this.plans.get(id);
        if (!plan)
            return;
        for (const step of plan.steps) {
            this.steps.delete(step.id);
            this.edges.delete(step.id);
        }
        this.plans.delete(id);
    }
    serialize() {
        return {
            plans: Array.from(this.plans.entries()),
            steps: Array.from(this.steps.entries()),
            edges: Array.from(this.edges.entries()).map(([k, v]) => [k, Array.from(v)]),
        };
    }
}
//# sourceMappingURL=taskgraph.js.map