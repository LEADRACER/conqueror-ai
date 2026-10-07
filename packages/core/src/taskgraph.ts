import type { Plan, PlanStep } from "./types.js";
import { randomUUID } from "node:crypto";

export const generateID = (): string => randomUUID();

export class TaskGraph {
  private plans: Map<string, Plan> = new Map();
  private steps: Map<string, PlanStep> = new Map();
  private edges: Map<string, Set<string>> = new Map();

  createPlan(title: string, parent?: string | undefined): Plan {
    const id = generateID();
    const plan: Plan = { id, title, steps: [], parent };
    this.plans.set(id, plan);
    return plan;
  }

  addStep(
    planID: string,
    step: Omit<PlanStep, "id" | "dependsOn" | "status"> & { dependsOn?: string[] }
  ): PlanStep {
    const plan = this.getPlan(planID);
    if (!plan) {
      throw new Error(`Plan "${planID}" not found`);
    }
    const id = generateID();
    const fullStep: PlanStep = {
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

  getPlan(id: string): Plan | undefined {
    return this.plans.get(id);
  }

  getStep(id: string): PlanStep | undefined {
    return this.steps.get(id);
  }

  setStepStatus(stepID: string, status: PlanStep["status"]): void {
    const step = this.steps.get(stepID);
    if (!step) {
      throw new Error(`Step "${stepID}" not found`);
    }
    step.status = status;
  }

  readySteps(planID: string): PlanStep[] {
    const plan = this.getPlan(planID);
    if (!plan) return [];
    return plan.steps.filter((s) => s.status === "pending" && this.isReady(s.id));
  }

  private isReady(stepID: string): boolean {
    const step = this.steps.get(stepID);
    if (!step) return false;
    return step.dependsOn.every((dep) => {
      const depStep = this.steps.get(dep);
      return depStep?.status === "done";
    });
  }

  removePlan(id: string): void {
    const plan = this.plans.get(id);
    if (!plan) return;
    for (const step of plan.steps) {
      this.steps.delete(step.id);
      this.edges.delete(step.id);
    }
    this.plans.delete(id);
  }

  serialize(): unknown {
    return {
      plans: Array.from(this.plans.entries()),
      steps: Array.from(this.steps.entries()),
      edges: Array.from(this.edges.entries()).map(([k, v]) => [k, Array.from(v)]),
    };
  }
}
