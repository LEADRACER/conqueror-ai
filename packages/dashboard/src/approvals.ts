import type { ToolCall } from "@alex-ai/core";
import type { EventBus } from "./events.js";
import type { StateStore } from "./state.js";
import { ApprovalRecord, sanitizeText, nowISO, newId } from "./state.js";

const APPROVAL_TIMEOUT_MS = 10 * 60 * 1000; // pending approvals expire after 10 min

export interface ApprovalContext {
  runId?: string;
}

export class ApprovalGate {
  private pendingResolvers = new Map<string, (approved: boolean) => void>();
  private requiredTools: Set<string>;

  constructor(
    private store: StateStore,
    private bus: EventBus,
    requiredTools: Set<string>
  ) {
    this.requiredTools = requiredTools;
  }

  setRequired(tools: Set<string>): void {
    this.requiredTools = tools;
  }

  private list(): ApprovalRecord[] {
    return this.store.snapshot.approvals;
  }

  isRequired(toolName: string): boolean {
    return this.requiredTools.has(toolName);
  }

  pending(): ApprovalRecord[] {
    return this.list().filter((a) => a.status === "pending");
  }

  async gate(call: ToolCall, ctx: ApprovalContext): Promise<{ approved: boolean; approvalId?: string }> {
    const argsPreview = safeJson(call.arguments);
    const record: ApprovalRecord = {
      id: newId(),
      tool: call.name,
      argsPreview,
      status: "pending",
      createdAt: nowISO(),
    };
    if (ctx.runId !== undefined) {
      record.runId = ctx.runId;
    }
    this.list().push(record);
    this.store.scheduleSave();
    this.bus.emit(
      "approval.requested",
      `Approval needed: ${call.name}`,
      { runId: ctx.runId, data: { approvalId: record.id, tool: call.name, argsPreview } }
    );

    const approved = await new Promise<boolean>((resolve) => {
      this.pendingResolvers.set(record.id, resolve);
      const timer = setTimeout(() => {
        if (this.pendingResolvers.has(record.id)) {
          this.decide(record.id, false, true);
        }
      }, APPROVAL_TIMEOUT_MS);
      timer.unref?.();
    });

    return { approved, approvalId: record.id };
  }

  decide(id: string, approved: boolean, expired = false): boolean {
    const records = this.list();
    const rec = records.find((a) => a.id === id && a.status === "pending");
    if (!rec) {
      return false;
    }
    rec.status = expired ? "expired" : approved ? "approved" : "rejected";
    rec.decidedAt = nowISO();
    this.store.scheduleSave();
    this.pendingResolvers.get(rec.id)?.(approved);
    this.pendingResolvers.delete(rec.id);
    this.bus.emit(
      expired ? "approval.expired" : approved ? "approval.approved" : "approval.rejected",
      `${expired ? "Expired" : approved ? "Approved" : "Rejected"}: ${rec.tool}`,
      { runId: rec.runId, data: { approvalId: rec.id, tool: rec.tool } }
    );
    return true;
  }

  /** Abandon approval when a run ends without a decision. */
  cancelForRun(runId: string): void {
    for (const rec of this.list()) {
      if (rec.runId === runId && rec.status === "pending") {
        rec.status = "expired";
        rec.decidedAt = nowISO();
        this.pendingResolvers.delete(rec.id);
      }
    }
    this.store.scheduleSave();
  }
}

function safeJson(args: Record<string, unknown>): string {
  try {
    const s = JSON.stringify(args);
    return sanitizeText(s ?? "{}", 800);
  } catch {
    return "{}";
  }
}
