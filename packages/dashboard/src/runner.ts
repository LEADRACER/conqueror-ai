import { AgentLoop, ToolDispatcher } from "@alex-ai/runtime";
import type { ToolCall, ToolOutput, Message } from "@alex-ai/core";
import type { AlexContext as CtxLike } from "@alex-ai/core";
import type { ApprovalGate } from "./approvals.js";
import type { EventBus } from "./events.js";
import { guardArgs } from "./paths.js";
import type { RunRecord, StateStore, Settings, Conversation } from "./state.js";
import { nowISO, newId, sanitizeText } from "./state.js";

/** Dispatcher that enforces path containment and approval gates before execution. */
export class SupervisedDispatcher extends ToolDispatcher {
  constructor(
    ctx: CtxLike,
    private gate: ApprovalGate,
    private runId: string,
    private bus: EventBus,
    private recordTool: (name: string, ok: boolean, ms: number) => void,
    private setWaiting: (waiting: boolean) => void
  ) {
    super(ctx);
  }

  override async execute(call: ToolCall): Promise<ToolOutput> {
    const tool = this.ctx.tools.get(call.name);
    if (!tool) {
      return { output: `Tool "${call.name}" not found.`, metadata: { error: "tool_not_found" } };
    }

    // Path containment for filesystem-ish tool args (defense in depth at runner level).
    try {
      await guardArgs(call.name, call.arguments);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.bus.emit("run.error", `${call.name}: ${msg}`, { runId: this.runId, data: { tool: call.name } });
      return { output: `Blocked: ${msg}`, metadata: { error: "denied" } };
    }

    if (this.gate.isRequired(call.name)) {
      this.bus.emit("run.tool_pending", `Awaiting approval: ${call.name}`, {
        runId: this.runId,
        data: { tool: call.name, args: call.arguments },
      });
      this.setWaiting(true);
      const decision = await this.gate.gate(call, { runId: this.runId });
      this.setWaiting(false);
      if (!decision.approved) {
        return {
          output: `The user REJECTED the "${call.name}" tool call. Do not attempt it again; propose an alternative or continue without it.`,
          metadata: { approvalId: decision.approvalId, rejected: true },
        };
      }
    }

    const started = Date.now();
    try {
      const result = await super.execute(call);
      const ok = !(result && typeof result === "object" && "metadata" in result &&
        (result.metadata as Record<string, unknown> | undefined)?.error);
      this.recordTool(call.name, ok, Date.now() - started);
      this.bus.emit(ok ? "run.tool_ok" : "run.tool_err", `Tool ${call.name}`, {
        runId: this.runId,
        data: { tool: call.name, ms: Date.now() - started },
      });
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.recordTool(call.name, false, Date.now() - started);
      this.bus.emit("run.tool_err", `Tool ${call.name} failed`, {
        runId: this.runId,
        data: { tool: call.name, error: sanitizeText(msg, 300) },
      });
      return { output: `Error: ${msg}`, metadata: { error: "handler_error" } };
    }
  }
}

export interface StartRunOptions {
  kind: "chat" | "task" | "workflow";
  request: string;
  conversationId?: string | undefined;
  missionId?: string | undefined;
  taskId?: string | undefined;
  projectId?: string | undefined;
  provider?: string | undefined;
  model?: string | undefined;
  /** "plan" runs produce a task breakdown for the linked mission */
  purpose?: "execute" | "plan" | undefined;
}

export interface RunContexts {
  store: StateStore;
  bus: EventBus;
  gate: ApprovalGate;
  agentFactory: () => { ctx: CtxLike; agent: AgentLoop };
  settings: Settings;
}

export class RunManager {
  readonly runs: RunRecord[];
  private controllers = new Map<string, AbortController>();
  private store: StateStore;
  private bus: EventBus;
  private gate: ApprovalGate;
  private agentFactory: () => { ctx: CtxLike; agent: AgentLoop };

  constructor(c: RunContexts) {
    this.runs = c.store.snapshot.runs;
    this.store = c.store;
    this.bus = c.bus;
    this.gate = c.gate;
    this.agentFactory = c.agentFactory;
    this.reapOrphans();
  }

  /**
   * Runs left "running"/"waiting_approval" from a previous server process
   * can never finish — mark them failed at startup with an honest error.
   */
  private reapOrphans(): void {
    let reaped = 0;
    for (const run of this.runs) {
      if (run.status === "running" || run.status === "waiting_approval" || run.status === "queued") {
        run.status = "failed";
        run.error = "interrupted: server restarted before completion";
        run.endedAt = new Date().toISOString();
        this.gate.cancelForRun(run.id);
        reaped++;
      }
    }
    // After reaping nothing can ever resolve them: fail-safe-cancel any
    // leftover pending approvals (e.g. state saved between events).
    for (const approval of this.gate.pending()) {
      this.gate.decide(approval.id, false, true);
    }
    if (reaped > 0) {
      this.store.scheduleSave();
    }
  }

  list(limit = 100): RunRecord[] {
    return this.runs.slice(-limit).reverse();
  }

  get(id: string): RunRecord | undefined {
    return this.runs.find((r) => r.id === id);
  }

  activeRun(): RunRecord | undefined {
    return this.runs.find((r) => r.status === "running" || r.status === "waiting_approval");
  }

  agentStatus(): { status: "idle" | "executing" | "waiting_approval"; detail: string; runId?: string } {
    const active = this.runs.filter((r) => r.status === "running" || r.status === "waiting_approval" || r.status === "queued");
    const last = this.runs.at(-1);
    if (active.length === 0) {
      return { status: "idle", detail: last ? `Last run: ${last.status}` : "No runs yet" };
    }
    const waiting = active.find((r) => r.status === "waiting_approval");
    if (waiting) {
      return { status: "waiting_approval", detail: "Approval required", runId: waiting.id };
    }
    const lastActive = active.at(-1);
    if (lastActive) {
      return { status: "executing", detail: `${active.length} active run(s)`, runId: lastActive.id };
    }
    return { status: "executing", detail: `${active.length} active run(s)` };
  }

  start(opts: StartRunOptions): RunRecord {
    const run: RunRecord = {
      id: newId(),
      kind: opts.kind,
      request: sanitizeText(opts.request, 20000),
      provider: opts.provider ?? this.store.snapshot.settings.provider,
      model: opts.model ?? this.store.snapshot.settings.model,
      status: "queued",
      dims: { steps: 0, inputTokens: 0, outputTokens: 0 },
      toolCalls: [],
      startedAt: nowISO(),
    };
    if (opts.conversationId) run.conversationId = opts.conversationId;
    if (opts.missionId) run.missionId = opts.missionId;
    if (opts.taskId) run.taskId = opts.taskId;
    if (opts.projectId) run.projectId = opts.projectId;
    if (opts.purpose && opts.purpose !== "execute") {
      (run as RunRecord & { purpose?: string }).purpose = opts.purpose;
    }
    this.runs.push(run);
    this.store.scheduleSave();
    this.bus.emit("run.started", `Run started (${opts.kind})`, {
      runId: run.id,
      missionId: opts.missionId,
      taskId: opts.taskId,
      data: { request: run.request.slice(0, 300) },
    });
    if (opts.taskId) {
      this.patchTask(opts.taskId, { status: "running" });
    }
    if (opts.missionId) {
      this.patchMission(opts.missionId, { status: "active" });
    }
    void this.execute(run).catch(() => {
      // execute handles its own errors; catch keeps the promise chain safe
    });
    return run;
  }

  patchTask(taskId: string, patch: { status?: "pending" | "running" | "awaiting_approval" | "completed" | "failed" | "cancelled"; output?: string; error?: string; runId?: string }): void {
    const task = this.store.snapshot.tasks.find((t) => t.id === taskId);
    if (!task) return;
    if (patch.status) task.status = patch.status;
    if (patch.output !== undefined) task.output = patch.output;
    if (patch.error !== undefined) task.error = patch.error;
    if (patch.runId) task.runId = patch.runId;
    task.updatedAt = nowISO();
    this.store.scheduleSave();
    if (patch.status) {
      this.bus.emit("task.updated", `Task ${patch.status}: ${task.title}`, { taskId: task.id });
    }
  }

  patchMission(missionId: string, patch: { status?: "active" | "paused" | "completed" | "failed" | "cancelled"; outcome?: string; runId?: string }): void {
    const mission = this.store.snapshot.missions.find((m) => m.id === missionId);
    if (!mission) return;
    if (patch.status) mission.status = patch.status;
    if (patch.outcome !== undefined) mission.outcome = sanitizeText(patch.outcome, 8000);
    if (patch.runId && !mission.runIds.includes(patch.runId)) mission.runIds.push(patch.runId);
    mission.updatedAt = nowISO();
    this.store.scheduleSave();
    if (patch.status) {
      this.bus.emit("mission.updated", `Mission ${patch.status}: ${mission.name}`, { missionId: mission.id });
    }
  }

  cancel(id: string): boolean {
    return this.controllers.get(id)?.abort() ?? false;
  }

  private appendMessage(conversation: Conversation, role: Message["role"], content: string | undefined, runId: string): void {
    conversation.messages.push({
      id: newId(),
      role,
      content: sanitizeText(content ?? "", 40000),
      ts: nowISO(),
      runId,
    });
    conversation.updatedAt = nowISO();
  }

  private async execute(run: RunRecord): Promise<void> {
    const controller = new AbortController();
    this.controllers.set(run.id, controller);
    run.status = "running";
    run.startedAt = nowISO();
    this.store.scheduleSave();
    this.bus.emit("run.phase", "executing", { runId: run.id, data: { phase: "executing" } });

    let conversation: Conversation | undefined;
    if (run.conversationId) {
      conversation = this.store.snapshot.conversations.find((c) => c.id === run.conversationId);
      if (conversation) {
        this.appendMessage(conversation, "user", run.request, run.id);
      }
    }

    try {
      const { ctx, agent } = this.agentFactory();
      const supervised = new SupervisedDispatcher(ctx, this.gate, run.id, this.bus, (name, ok, ms) => {
        run.toolCalls.push({ name, ts: nowISO(), ok, ms });
        run.dims.steps += 1;
      }, (waiting) => {
        if (run.status === "running" || run.status === "waiting_approval") {
          run.status = waiting ? "waiting_approval" : "running";
          this.store.scheduleSave();
          this.bus.emit("run.phase", waiting ? "waiting_approval" : "executing", {
            runId: run.id,
            data: { phase: waiting ? "waiting_approval" : "executing" },
          });
        }
      });
      // per-run agent instance so the supervised dispatcher (and its approval gate) applies only to this run
      const loop = agent;
      const runAgent = new AgentLoop(loop.ctx, loop.config, supervised);

      const onProgress = (msg: Message): void => {
        if (conversation && msg.role === "assistant") {
          this.appendMessage(conversation, "assistant", msg.content, run.id);
        }
      };
      const onChunk = (delta: { content?: string; reasoning?: string; toolCall?: ToolCall }): void => {
        if (delta.content) {
          this.bus.emit("run.delta", delta.content, { runId: run.id, data: { delta: delta.content } });
        }
      };

      const history = await runAgent.run(run.request, onProgress, {
        signal: controller.signal,
        stream: true,
        onChunk,
        timeout: this.store.snapshot.settings.runTimeoutMs,
        provider: run.provider,
        model: run.model,
      });

      const usage = extractUsage(history);
      if (usage) {
        run.dims.inputTokens = usage.input;
        run.dims.outputTokens = usage.output;
      }
      const compaction = extractCompaction(history);
      if (compaction) {
        run.dims.charsCompacted = compaction.charsSaved;
        run.dims.toolsDropped = compaction.unitsRemoved;
      }

      const final = history.at(-1)?.content ?? "";
      run.status = "completed";
      run.endedAt = nowISO();
      run.answer = sanitizeText(final, 40000);
      if (conversation) {
        this.appendMessage(conversation, "assistant", final, run.id);
      }
      if (run.taskId) {
        this.patchTask(run.taskId, { status: "completed", output: run.answer });
      }
      if (run.missionId) {
        this.patchMission(run.missionId, { outcome: final.slice(0, 4000) });
      }
      this.bus.emit("run.completed", "Run completed", {
        runId: run.id,
        data: { steps: run.dims.steps, outputTokens: run.dims.outputTokens },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const cancelled = msg === "Run aborted" || controller.signal.aborted;
      run.status = cancelled ? "cancelled" : "failed";
      run.endedAt = nowISO();
      run.error = sanitizeText(msg, 2000);
      if (run.taskId) {
        this.patchTask(run.taskId, cancelled ? { status: "pending" } : { status: "failed", error: run.error });
      }
      if (run.missionId) {
        this.patchMission(run.missionId, cancelled
          ? { status: "paused" }
          : { status: "failed", outcome: run.error });
      }
      this.bus.emit(cancelled ? "run.cancelled" : "run.failed", cancelled ? "Run cancelled" : `Run failed: ${msg.slice(0, 200)}`, {
        runId: run.id,
        data: { error: run.error },
      });
    } finally {
      this.controllers.delete(run.id);
      this.gate.cancelForRun(run.id);
      this.store.flush();
    }
  }
}

function extractCompaction(history: Message[]): { unitsRemoved: number; charsSaved: number } | undefined {
  for (let i = history.length - 1; i >= 0; i--) {
    const meta = history[i]?.metadata;
    const c = meta?.compaction as { unitsRemoved?: number; charsSaved?: number } | undefined;
    if (c && typeof c.charsSaved === "number" && c.charsSaved > 0) {
      return { charsSaved: c.charsSaved, unitsRemoved: c.unitsRemoved ?? 0 };
    }
  }
  return undefined;
}

function extractUsage(history: Message[]): { input: number; output: number } | undefined {
  for (let i = history.length - 1; i >= 0; i--) {
    const meta = history[i]?.metadata;
    const usage = meta?.usage as { input?: number; output?: number } | undefined;
    if (usage && typeof usage.input === "number") {
      return { input: usage.input, output: usage.output ?? 0 };
    }
    if (meta && typeof meta.inputTokens === "number") {
      return { input: meta.inputTokens as number, output: (meta.outputTokens as number) ?? 0 };
    }
  }
  return undefined;
}
