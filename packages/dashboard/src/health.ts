import { OmnirouteService } from "@alex-ai/runtime";
import type { AlexContext } from "@alex-ai/core";
import type { StateStore } from "./state.js";

export interface HealthCheck {
  id: string;
  label: string;
  ok: boolean | null; // null = unknown / not configured
  detail: string;
  latencyMs?: number;
}

export class HealthMonitor {
  private omniroute: OmnirouteService;
  private lastModels: string[] = [];

  constructor(
    private ctx: AlexContext,
    private store: StateStore,
    private memoryCount: () => number,
    omnirouteURL?: string
  ) {
    this.omniroute = new OmnirouteService({ baseURL: omnirouteURL ?? "http://localhost:3000" });
  }

  omnirouteService(): OmnirouteService {
    return this.omniroute;
  }

  lastKnownModels(): string[] {
    return this.lastModels;
  }

  async check(): Promise<{ checks: HealthCheck[]; models: string[] }> {
    const checks: HealthCheck[] = [];
    let models: string[] = [];

    // Dashboard server itself
    checks.push({ id: "dashboard", label: "Dashboard server", ok: true, detail: "HTTP API responding" });

    // Provider endpoints (probes each registered provider's /v1/models — no auth header needed locally)
    const providerChecks = await Promise.all(
      this.ctx.providers.list().map(async (p) => {
        const opts = (p as unknown as { options?: { baseURL?: string } }).options;
        const baseURL = opts?.baseURL;
        if (!baseURL) {
          return null;
        }
        const started = Date.now();
        try {
          const resp = await fetch(new URL("/v1/models", baseURL).toString(), {
            signal: AbortSignal.timeout(3000),
          });
          const latency = Date.now() - started;
          let modelList: string[] = [];
          if (resp.ok) {
            try {
              const body = (await resp.json()) as { data?: { id?: string }[] };
              modelList = (body.data ?? []).map((m) => m.id ?? "").filter(Boolean);
            } catch {
              // non-JSON /v1/models — treat as reachable but no model list
            }
          }
          return {
            check: {
              id: `provider:${p.id}`,
              label: `Provider: ${p.name}`,
              ok: resp.ok,
              detail: resp.ok ? `Reachable (${modelList.length} models)` : `HTTP ${resp.status}`,
              latencyMs: latency,
            } satisfies HealthCheck,
            providerId: p.id,
            modelList,
          };
        } catch (err) {
          return {
            check: {
              id: `provider:${p.id}`,
              label: `Provider: ${p.name}`,
              ok: false,
              detail: `Unreachable: ${err instanceof Error ? err.message : String(err)}`,
            } satisfies HealthCheck,
            providerId: p.id,
            modelList: [],
          };
        }
      })
    );

    for (const entry of providerChecks) {
      if (entry) {
        checks.push(entry.check);
        if (entry.providerId === "omniroute" && entry.modelList.length > 0) {
          models = entry.modelList;
        }
      }
    }
    if (models.length > 0) {
      this.lastModels = models;
    }

    // Persistence state file
    const state = this.store.snapshot;
    checks.push({
      id: "state",
      label: "Persistent state",
      ok: true,
      detail: `dashboard-state.json (${state.missions.length} missions, ${state.tasks.length} tasks, ${state.conversations.length} conversations, ${state.events.length} events)`,
    });

    // Memory layer
    const memoryTotal = this.memoryCount();
    checks.push({
      id: "memory",
      label: "Memory store",
      ok: memoryTotal >= 0,
      detail: `${memoryTotal} entries`,
    });

    // Tool availability
    const tools = this.ctx.tools.list();
    checks.push({
      id: "tools",
      label: "Tool registry",
      ok: tools.length > 0,
      detail: `${tools.length} tools registered`,
    });

    // Background scheduler
    const workflows = state.workflows.filter((w) => w.enabled && (w.intervalMinutes ?? 0) > 0);
    checks.push({
      id: "scheduler",
      label: "Workflow scheduler",
      ok: true,
      detail: workflows.length === 0 ? "No scheduled workflows" : `${workflows.length} scheduled workflow(s)`,
    });

    return { checks, models };
  }
}
