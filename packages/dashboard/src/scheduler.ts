import type { EventBus } from "./events.js";
import type { RunManager } from "./runner.js";
import type { StateStore, Workflow } from "./state.js";
import { nowISO } from "./state.js";

/**
 * Executes interval-scheduled workflows. setInterval-driven (30s tick), timezone = server TZ.
 */
export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  private executing = new Set<string>();

  constructor(
    private store: StateStore,
    private bus: EventBus,
    private runs: RunManager
  ) {}

  start(): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => {
      void this.tick();
    }, 30000);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick(): Promise<void> {
    const now = Date.now();
    for (const wf of this.store.snapshot.workflows) {
      if (!wf.enabled || !wf.intervalMinutes || wf.steps.length === 0) {
        continue;
      }
      if (this.executing.has(wf.id)) {
        continue;
      }
      const due = !wf.nextRunAt || new Date(wf.nextRunAt).getTime() <= now;
      if (!due) {
        continue;
      }
      this.runScheduled(wf);
    }
  }

  private runScheduled(wf: Workflow): void {
    const runId = this.runWorkflow(wf.id, "schedule");
    if (runId) {
      this.bus.emit("workflow.scheduled_run", `Scheduled run started: ${wf.name}`, {
        data: { workflowId: wf.id, runId },
      });
    }
  }

  /** Launches a workflow: each step becomes a sequential agent run. Returns the first runId. */
  runWorkflow(wfId: string, source: "manual" | "schedule"): string | null {
    const wf = this.store.snapshot.workflows.find((w) => w.id === wfId);
    if (!wf || wf.steps.length === 0) {
      return null;
    }
    if (this.executing.has(wf.id)) {
      return null;
    }
    this.executing.add(wf.id);

    const runFirst = (index: number, carried: string): void => {
      if (index >= wf.steps.length) {
        wf.lastRunAt = nowISO();
        wf.lastStatus = "completed";
        wf.nextRunAt = wf.enabled && wf.intervalMinutes
          ? new Date(Date.now() + wf.intervalMinutes * 60000).toISOString()
          : undefined;
        this.store.scheduleSave();
        this.executing.delete(wf.id);
        this.bus.emit("workflow.completed", `Workflow completed: ${wf.name}`, { data: { workflowId: wf.id, source } });
        return;
      }
      const step = wf.steps[index]!;
      const stepPrompt = carried
        ? `Workflow "${wf.name}" — step ${index + 1}/${wf.steps.length}: "${step.name}".\nPrevious step output:\n${carried.slice(0, 4000)}\n\nTask: ${step.prompt}`
        : `Workflow "${wf.name}" — step ${index + 1}/${wf.steps.length}: "${step.name}".\nTask: ${step.prompt}`;
      const run = this.runs.start({ kind: "workflow", request: stepPrompt });
      this.lastRunIds.set(wf.id, run.id);
      const poll = setInterval(() => {
        const record = this.runs.get(run.id);
        if (record && record.endedAt) {
          clearInterval(poll);
          if (record.status === "completed") {
            runFirst(index + 1, record.answer ?? "");
          } else {
            wf.lastRunAt = nowISO();
            wf.lastStatus = "failed";
            wf.nextRunAt = wf.enabled && wf.intervalMinutes
              ? new Date(Date.now() + wf.intervalMinutes * 60000).toISOString()
              : undefined;
            this.store.scheduleSave();
            this.executing.delete(wf.id);
            this.bus.emit("workflow.failed", `Workflow step failed: ${wf.name} / ${step.name}`, {
              data: { workflowId: wf.id, runId: run.id, error: record.error },
            });
          }
        }
      }, 500);
      poll.unref?.();
    };

    runFirst(0, "");
    return this.lastRunIds.get(wf.id) ?? null;
  }

  private lastRunIds = new Map<string, string>();
}
