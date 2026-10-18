import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { extname, join, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { AgentLoop } from "@alex-ai/runtime";
import { OmnirouteProvider } from "@alex-ai/providers";
import type { AlexContext } from "@alex-ai/core";
import { MemoryManager } from "@alex-ai/experience";
import { setMemoryManager } from "@alex-ai/tools";
import { EventBus } from "./events.js";
import { ApprovalGate } from "./approvals.js";
import { RunManager } from "./runner.js";
import { HealthMonitor } from "./health.js";
import { Scheduler } from "./scheduler.js";
import {
  StateStore,
  defaultSettings,
  nowISO,
  newId,
  sanitizeText,
} from "./state.js";
import type { Mission, Project, Task, TaskStatus, Workflow, WorkflowStep, RunRecord, Conversation } from "./state.js";

const TASK_STATUSES: TaskStatus[] = ["pending", "running", "awaiting_approval", "completed", "failed", "cancelled"];

const UI_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "ui");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
};

const BODY_LIMIT = 2 * 1024 * 1024;
const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
};

export interface DashboardOptions {
  host?: string;
  port?: number;
  token?: string | null;
  omnirouteURL?: string;
  omnirouteApiKey?: string;
  omnirouteAutoStart?: boolean;
}

export interface Dashboard {
  server: Server;
  port: number;
  close: () => Promise<void>;
  health: HealthMonitor;
  runs: RunManager;
  store: StateStore;
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

interface App {
  store: StateStore;
  bus: EventBus;
  gate: ApprovalGate;
  runs: RunManager;
  health: HealthMonitor;
  scheduler: Scheduler;
  memory: MemoryManager;
  ctx: AlexContext;
  token: string | null;
}

export async function startDashboard(opts: DashboardOptions = {}): Promise<Dashboard> {
  const port = opts.port ?? 3007;
  const host = opts.host ?? "127.0.0.1";
  const token = opts.token === null ? null : (opts.token ?? process.env.ALEX_DASHBOARD_TOKEN ?? null);

  const loopback = host === "127.0.0.1" || host === "localhost" || host === "::1";
  if (!loopback && !token) {
    throw new Error("Non-loopback binding requires a token (pass --token or set ALEX_DASHBOARD_TOKEN)");
  }

  const store = new StateStore();
  const bus = new EventBus(store);
  const snapSettings = store.snapshot.settings;

  const omnirouteAutoStart = opts.omnirouteAutoStart ?? false;
  const omnirouteURL = opts.omnirouteURL ?? process.env.OMNIROUTE_URL ?? "http://localhost:3000";
  const { ctx, agent } = await AgentLoop.createDefault(process.cwd(), {
    provider: snapSettings.provider,
    model: snapSettings.model,
  });

  const omniroute = new OmnirouteProvider({
    baseURL: omnirouteURL,
    ...(opts.omnirouteApiKey ? { apiKey: opts.omnirouteApiKey } : {}),
  });
  if (ctx.providers.has("omniroute")) {
    ctx.providers.remove("omniroute");
  }
  ctx.providers.register(omniroute);

  const memory = new MemoryManager();
  setMemoryManager(memory);

  const gate = new ApprovalGate(store, bus, new Set(snapSettings.approvalTools));
  const runs = new RunManager({
    store,
    bus,
    gate,
    settings: snapSettings,
    agentFactory: () => ({ ctx, agent }),
  });
  const health = new HealthMonitor(ctx, store, () => memory.count(), omnirouteURL);
  const scheduler = new Scheduler(store, bus, runs);
  scheduler.start();

  if (omnirouteAutoStart) {
    // best-effort: bring up the omniroute gateway in the background
    void health.omnirouteService().start().then((ok) => {
      if (ok) {
        bus.emit("system.health", "omniroute gateway ready", { data: { baseURL: omnirouteURL } });
      } else {
        bus.emit("system.warning", "omniroute gateway not reachable — start it manually if needed", {
          data: { baseURL: omnirouteURL },
        });
      }
    });
  }

  const app: App = { store, bus, gate, runs, health, scheduler, memory, ctx, token };
  startPlanFinalizer(app, createTask);

  const server = createServer((req, res) => {
    void routeRequest(app, req, res).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      if (!res.headersSent) {
        sendJSON(res, 500, { error: `Internal error: ${msg}` });
      } else {
        res.end();
      }
    });
  });

  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.once("error", (err) => rejectPromise(err));
    server.listen(port, host, () => {
      server.removeAllListeners("error");
      resolvePromise();
    });
  });
  const addr = server.address();
  const boundPort = typeof addr === "object" && addr ? addr.port : port;

  const close = async (): Promise<void> => {
    scheduler.stop();
    store.flush();
    await new Promise<void>((resolvePromise) => {
      server.close(() => resolvePromise());
    });
  };

  return { server, port: boundPort, close, health, runs, store };
}

// ---------- request handling ----------

async function routeRequest(app: App, req: IncomingMessage, res: ServerResponse): Promise<void> {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    res.setHeader(k, v);
  }

  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const path = url.pathname;
  const method = req.method ?? "GET";

  // token auth for API + SSE; static UI is served without auth
  if (path.startsWith("/api/") || path === "/events") {
    if (app.token && !authed(req, url, app.token)) {
      sendJSON(res, 401, { error: "unauthorized" });
      return;
    }
  }

  if (path === "/api/events") {
    streamEvents(app, req, res, url);
    return;
  }

  if (path.startsWith("/api/")) {
    await handleAPI(app, req, res, url, method, path);
    return;
  }

  if (method === "GET") {
    serveStatic(path, res);
    return;
  }

  sendJSON(res, 404, { error: "not found" });
}

function authed(req: IncomingMessage, url: URL, token: string): boolean {
  const header = req.headers.authorization;
  if (header === `Bearer ${token}`) {
    return true;
  }
  const wsHeader = req.headers["x-alex-token"];
  if (wsHeader === token) {
    return true;
  }
  return url.searchParams.get("token") === token;
}

function sendJSON(res: ServerResponse, code: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(payload);
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolvePromise, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let overflowed = false;
    req.on("data", (chunk: Buffer) => {
      if (overflowed) {
        return;
      }
      total += chunk.length;
      if (total > BODY_LIMIT) {
        overflowed = true;
        chunks.length = 0;
        reject(new HttpError(413, "Request body too large"));
        // Switch to pure discard mode so the rest of the upload drains and
        // the client can still read our 413 response (no socket reset).
        req.removeAllListeners("data");
        const discard = (): void => {};
        req.on("data", discard);
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (chunks.length === 0) {
        resolvePromise({});
        return;
      }
      try {
        resolvePromise(JSON.parse(Buffer.concat(chunks).toString("utf-8")) as Record<string, unknown>);
      } catch {
        reject(new HttpError(400, "Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

// ---------- SSE ----------

function streamEvents(app: App, req: IncomingMessage, res: ServerResponse, url: URL): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write("retry: 2000\n\n");

  const lastHeader = req.headers["last-event-id"];
  const sinceParam = url.searchParams.get("since");
  let lastSent = Number.parseInt(typeof lastHeader === "string" ? lastHeader : sinceParam ?? "0", 10);
  if (!Number.isFinite(lastSent) || lastSent < 0) {
    lastSent = 0;
  }

  let closed = false;
  const send = (evt: { id: number; ts: string; type: string; message: string; data?: Record<string, unknown> }): void => {
    if (closed || evt.id <= lastSent) {
      return;
    }
    lastSent = evt.id;
    res.write(`id: ${evt.id}\ndata: ${JSON.stringify(evt)}\n\n`);
  };

  // flush backlog then subscribe
  for (const evt of app.store.snapshot.events) {
    if (evt.id > lastSent) {
      send(evt);
    }
  }

  const unsubscribe = app.bus.subscribe((evt) => send(evt));
  const heartbeat = setInterval(() => {
    if (!closed) {
      res.write(": hb\n\n");
    }
  }, 15000);
  heartbeat.unref?.();
  const closeHandler = (): void => {
    closed = true;
    clearInterval(heartbeat);
    unsubscribe();
  };
  req.on("close", closeHandler);
  res.on("close", closeHandler);
}

// ---------- API ----------

async function handleAPI(
  app: App,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
  path: string
): Promise<void> {
  try {
    const segs = path.split("/").filter(Boolean);
    const [, resource, id, action] = segs;

    if (path === "/api/health" && method === "GET") {
      const data = await app.health.check();
      sendJSON(res, 200, data);
      return;
    }

    if (path === "/api/state" && method === "GET") {
      const snap = app.store.snapshot;
      sendJSON(res, 200, {
        agent: app.runs.agentStatus(),
        settings: snap.settings,
        approvals: snap.approvals.filter((a) => a.status === "pending"),
        counts: {
          missions: snap.missions.length,
          tasks: snap.tasks.length,
          projects: snap.projects.length,
          workflows: snap.workflows.length,
          conversations: snap.conversations.filter((c) => !c.archived).length,
          runs: snap.runs.length,
          pendingApprovals: snap.approvals.filter((a) => a.status === "pending").length,
        },
        events: snap.events.slice(-100),
        runs: snap.runs.slice(-20).reverse(),
        missions: snap.missions.slice(-20).reverse(),
        tasks: snap.tasks.slice(-40).reverse(),
        projects: snap.projects,
        workflows: snap.workflows,
        conversations: snap.conversations.filter((c) => !c.archived),
      });
      return;
    }

    if (path === "/api/activity" && method === "GET") {
      sendJSON(res, 200, { events: app.store.snapshot.events.slice(-200).reverse() });
      return;
    }

    if (resource === "runs" && !id) {
      if (method === "POST") {
        const body = await readBody(req);
        const request = typeof body.request === "string" ? sanitizeText(body.request, 20000) : "";
        if (!request.trim()) {
          sendJSON(res, 400, { error: "request is required" });
          return;
        }
        let conversationId: string | undefined;
        if (body.conversationId === "new") {
          const conv = ensureConversation(app, undefined, "Chat");
          conversationId = conv.id;
        } else {
          conversationId = optString(body.conversationId);
        }
        const kind: RunRecord["kind"] = conversationId ? "chat" : "task";
        const run = app.runs.start({
          kind,
          request,
          conversationId,
          missionId: optString(body.missionId),
          taskId: optString(body.taskId),
          projectId: optString(body.projectId),
          provider: optString(body.provider),
          model: optString(body.model),
        });
        sendJSON(res, 202, { runId: run.id, conversationId: run.conversationId });
        return;
      }
      if (method === "GET") {
        sendJSON(res, 200, { runs: app.runs.list(100) });
        return;
      }
    }

    if (resource === "runs" && id) {
      if (method === "GET") {
        const run = app.runs.get(id);
        if (!run) {
          sendJSON(res, 404, { error: "Run not found" });
          return;
        }
        const conv = run.conversationId
          ? app.store.snapshot.conversations.find((x) => x.id === run.conversationId)
          : undefined;
        sendJSON(res, 200, { run, messages: conv?.messages ?? [] });
        return;
      }
      if (method === "POST" && action === "cancel") {
        if (!app.runs.get(id)) {
          sendJSON(res, 404, { error: "Run not found" });
          return;
        }
        const ok = app.runs.cancel(id);
        sendJSON(res, 200, { ok });
        return;
      }
    }

    if (resource === "conversations") {
      await handleConversations(app, req, res, method, id);
      return;
    }

    if (resource === "approvals") {
      await handleApprovals(app, req, res, method, id, action);
      return;
    }

    if (resource === "missions") {
      await handleMissions(app, req, res, method, id, action);
      return;
    }

    if (resource === "tasks") {
      await handleTasks(app, req, res, method, id, action);
      return;
    }

    if (resource === "projects") {
      await handleProjects(app, req, res, method, id);
      return;
    }

    if (resource === "workflows") {
      await handleWorkflows(app, req, res, method, id, action);
      return;
    }

    if (resource === "tools" && method === "GET") {
      sendJSON(res, 200, { tools: toolList(app) });
      return;
    }

    if (resource === "memory") {
      await handleMemory(app, req, res, method, id, url);
      return;
    }

    if (resource === "settings") {
      await handleSettings(app, req, res, method);
      return;
    }

    if (resource === "providers" && method === "GET") {
      const providers = app.ctx.providers.list().map((p) => ({
        id: p.id,
        name: p.name,
        models: p.models,
        online: null as boolean | null,
      }));
      const hc = await app.health.check();
      for (const p of providers) {
        const found = hc.checks.find((c) => c.id === `provider:${p.id}`);
        p.online = found?.ok ?? null;
      }
      sendJSON(res, 200, { providers, gatewayModels: hc.models, checks: hc.checks });
      return;
    }

    sendJSON(res, 404, { error: `Unknown API route: ${method} ${path}` });
  } catch (err) {
    if (err instanceof HttpError) {
      sendJSON(res, err.status, { error: err.message });
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    sendJSON(res, 500, { error: msg });
  }
}

function optString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v : undefined;
}

const PRIORITIES = new Set(["low", "medium", "high"]);
function normalizePriority(v: unknown): "low" | "medium" | "high" {
  return typeof v === "string" && PRIORITIES.has(v) ? (v as "low" | "medium" | "high") : "medium";
}

function normalizeInterval(v: unknown): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    return undefined;
  }
  const rounded = Math.max(1, Math.round(v));
  return rounded;
}

function normalizeSteps(v: unknown): WorkflowStep[] {
  if (!Array.isArray(v)) {
    return [];
  }
  return v
    .map((raw) => {
      const step = raw as { name?: unknown; prompt?: unknown };
      const name = typeof step.name === "string" ? sanitizeText(step.name, 200) : `Step ${Math.random().toString(36).slice(2, 6)}`;
      const prompt = typeof step.prompt === "string" ? sanitizeText(step.prompt, 20000) : "";
      return { id: newId(), name, prompt } satisfies WorkflowStep;
    })
    .filter((s) => s.prompt.trim().length > 0)
    .slice(0, 50);
}

// ---------- conversations ----------

function ensureConversation(app: App, id?: string, title?: string): Conversation {
  if (id) {
    const found = app.store.snapshot.conversations.find((c) => c.id === id);
    if (found) {
      return found;
    }
  }
  const now = nowISO();
  const conv: Conversation = {
    id: newId(),
    title: title ?? "New conversation",
    archived: false,
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
  app.store.snapshot.conversations.push(conv);
  app.store.scheduleSave();
  app.bus.emit("conversation.created", `Conversation created: ${conv.title}`, { data: { conversationId: conv.id } });
  return conv;
}

async function handleConversations(
  app: App,
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  id?: string
): Promise<void> {
  if (method === "GET" && !id) {
    sendJSON(res, 200, { conversations: app.store.snapshot.conversations.filter((c) => !c.archived) });
    return;
  }
  if (method === "POST" && !id) {
    const conv = ensureConversation(app);
    sendJSON(res, 201, { conversation: conv });
    return;
  }
  if (id && method === "GET") {
    const conv = app.store.snapshot.conversations.find((c) => c.id === id);
    if (!conv) {
      sendJSON(res, 404, { error: "Conversation not found" });
      return;
    }
    sendJSON(res, 200, { conversation: conv });
    return;
  }
  if (id && (method === "PATCH" || method === "DELETE")) {
    const conv = app.store.snapshot.conversations.find((c) => c.id === id);
    if (!conv) {
      sendJSON(res, 404, { error: "Conversation not found" });
      return;
    }
    if (method === "DELETE") {
      app.store.removeById(app.store.snapshot.conversations, id);
      app.bus.emit("conversation.deleted", "Conversation deleted", { data: { conversationId: id } });
      sendJSON(res, 200, { ok: true });
      return;
    }
    const body = await readBody(req);
    if (typeof body.title === "string" && body.title.trim()) {
      conv.title = sanitizeText(body.title, 200);
    }
    if (typeof body.archived === "boolean") {
      conv.archived = body.archived;
    }
    conv.updatedAt = nowISO();
    app.store.scheduleSave();
    sendJSON(res, 200, { conversation: conv });
    return;
  }
  sendJSON(res, 404, { error: "Unknown conversations route" });
}

// ---------- approvals ----------

async function handleApprovals(
  app: App,
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  id?: string,
  action?: string
): Promise<void> {
  if (method === "GET" && !id) {
    sendJSON(res, 200, { approvals: app.store.snapshot.approvals.slice(-100).reverse() });
    return;
  }
  if (method === "POST" && id && action === "decision") {
    const body = await readBody(req);
    if (typeof body.approved !== "boolean") {
      sendJSON(res, 400, { error: "approved (boolean) is required" });
      return;
    }
    const ok = app.gate.decide(id, body.approved);
    sendJSON(res, ok ? 200 : 404, ok ? { ok } : { error: "Pending approval not found" });
    return;
  }
  sendJSON(res, 404, { error: "Unknown approvals route" });
}

// ---------- missions ----------

function createMission(app: App, data: Pick<Mission, "name" | "objective"> & Partial<Mission>): Mission {
  if (!data.name?.trim()) {
    throw new HttpError(400, "Mission requires a name");
  }
  const now = nowISO();
  const mission: Mission = {
    id: newId(),
    name: sanitizeText(data.name.trim(), 200),
    objective: sanitizeText(data.objective ?? "", 2000),
    priority: data.priority ?? "medium",
    status: "active",
    blockers: [],
    artifacts: [],
    runIds: [],
    createdAt: now,
    updatedAt: now,
  };
  if (data.successCriteria) mission.successCriteria = data.successCriteria;
  if (data.projectId) mission.projectId = data.projectId;
  if (data.deadline) mission.deadline = data.deadline;
  if (data.constraints) mission.constraints = data.constraints;
  app.store.snapshot.missions.push(mission);
  app.store.scheduleSave();
  app.bus.emit("mission.created", `Mission created: ${mission.name}`, { missionId: mission.id });
  return mission;
}

function buildMissionPrompt(m: Mission, extra: string): string {
  const parts = [
    `Execute this mission to completion.`,
    `Mission: ${m.name}`,
    `Objective: ${m.objective}`,
  ];
  if (m.successCriteria) parts.push(`Success criteria: ${m.successCriteria}`);
  if (m.constraints) parts.push(`Constraints: ${m.constraints}`);
  if (m.deadline) parts.push(`Deadline: ${m.deadline}`);
  if (extra) parts.push(`Operator instruction: ${extra}`);
  parts.push(`When done, write a short completion summary as your final answer.`);
  return parts.join("\n");
}

function buildMissionPlanPrompt(m: Mission): string {
  return [
    `Break the following mission into concrete executable tasks.`,
    `Mission: ${m.name}`,
    `Objective: ${m.objective}`,
    m.successCriteria ? `Success criteria: ${m.successCriteria}` : "",
    m.constraints ? `Constraints: ${m.constraints}` : "",
    `Respond with ONLY a JSON object of the shape {"tasks": ["..."]} where each array item is "task title — 1 sentence detail".`,
    `No tool calls are needed; this is a planning step.`,
  ].filter(Boolean).join("\n");
}

async function handleMissions(
  app: App,
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  id?: string,
  action?: string
): Promise<void> {
  if (method === "GET" && !id) {
    sendJSON(res, 200, { missions: [...app.store.snapshot.missions].reverse() });
    return;
  }
  if (method === "POST" && !id) {
    const body = await readBody(req);
    const name = typeof body.name === "string" ? sanitizeText(body.name, 300) : "";
    const objective = typeof body.objective === "string" ? sanitizeText(body.objective, 20000) : "";
    if (!name || !objective) {
      sendJSON(res, 400, { error: "name and objective are required" });
      return;
    }
    const mission = createMission(app, {
      name,
      objective,
      successCriteria: optString(body.successCriteria),
      priority: normalizePriority(body.priority),
      projectId: optString(body.projectId),
      deadline: optString(body.deadline),
      constraints: optString(body.constraints),
    });
    if (body.execute === true) {
      const run = app.runs.start({ kind: "task", request: buildMissionPrompt(mission, ""), missionId: mission.id, projectId: mission.projectId });
      sendJSON(res, 201, { mission, runId: run.id });
      return;
    }
    sendJSON(res, 201, { mission });
    return;
  }
  if (id && action === "run" && method === "POST") {
    const mission = app.store.snapshot.missions.find((m) => m.id === id);
    if (!mission) {
      sendJSON(res, 404, { error: "Mission not found" });
      return;
    }
    const run = app.runs.start({ kind: "task", request: buildMissionPrompt(mission, ""), missionId: mission.id, projectId: mission.projectId });
    sendJSON(res, 202, { runId: run.id });
    return;
  }
  if (id && action === "plan" && method === "POST") {
    const mission = app.store.snapshot.missions.find((m) => m.id === id);
    if (!mission) {
      sendJSON(res, 404, { error: "Mission not found" });
      return;
    }
    const run = app.runs.start({ kind: "task", request: buildMissionPlanPrompt(mission), missionId: mission.id, projectId: mission.projectId, purpose: "plan" });
    sendJSON(res, 202, { runId: run.id });
    return;
  }
  if (id && method === "PATCH") {
    const mission = app.store.snapshot.missions.find((m) => m.id === id);
    if (!mission) {
      sendJSON(res, 404, { error: "Mission not found" });
      return;
    }
    const body = await readBody(req);
    if (body.status !== undefined) {
      const allowed = ["active", "paused", "completed", "failed", "cancelled"];
      if (typeof body.status !== "string" || !allowed.includes(body.status)) {
        sendJSON(res, 400, { error: `status must be one of: ${allowed.join(", ")}` });
        return;
      }
      mission.status = body.status as Mission["status"];
      mission.updatedAt = nowISO();
      app.store.scheduleSave();
      app.bus.emit("mission.updated", `Mission ${mission.status}: ${mission.name}`, { missionId: mission.id });
    }
    sendJSON(res, 200, { mission });
    return;
  }
  if (id && method === "DELETE") {
    const ok = app.store.removeById(app.store.snapshot.missions, id);
    sendJSON(res, ok ? 200 : 404, ok ? { ok: true } : { error: "Mission not found" });
    return;
  }
  if (id && method === "GET") {
    const mission = app.store.snapshot.missions.find((m) => m.id === id);
    if (!mission) {
      sendJSON(res, 404, { error: "Mission not found" });
      return;
    }
    const missionRuns = app.store.snapshot.runs.filter((r) => r.missionId === mission.id).slice(-20).reverse();
    const missionTasks = app.store.snapshot.tasks.filter((t) => t.missionId === mission.id).slice(-40).reverse();
    sendJSON(res, 200, { mission, runs: missionRuns, tasks: missionTasks });
    return;
  }
  sendJSON(res, 404, { error: "Unknown missions route" });
}

// ---------- tasks ----------

function createTask(app: App, data: Pick<Task, "title"> & Partial<Task>): Task {
  if (!data.title?.trim()) {
    throw new HttpError(400, "Task requires a title");
  }
  if (data.status && !TASK_STATUSES.includes(data.status)) {
    throw new HttpError(400, `Task status must be one of: ${TASK_STATUSES.join(", ")}`);
  }
  const now = nowISO();
  const task: Task = {
    id: newId(),
    title: sanitizeText(data.title.trim(), 300),
    ...(data.status && data.status !== "pending" ? { status: data.status } : {}),
    status: "pending",
    priority: data.priority ?? "medium",
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  };
  if (data.description) task.description = data.description;
  if (data.missionId) task.missionId = data.missionId;
  if (data.projectId) task.projectId = data.projectId;
  app.store.snapshot.tasks.push(task);
  app.store.scheduleSave();
  app.bus.emit("task.created", `Task created: ${task.title}`, { taskId: task.id });
  return task;
}

async function handleTasks(
  app: App,
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  id?: string,
  action?: string
): Promise<void> {
  if (method === "GET" && !id) {
    sendJSON(res, 200, { tasks: [...app.store.snapshot.tasks].reverse() });
    return;
  }
  if (method === "POST" && !id) {
    const body = await readBody(req);
    const title = typeof body.title === "string" ? sanitizeText(body.title, 300) : "";
    if (!title) {
      sendJSON(res, 400, { error: "title is required" });
      return;
    }
    if (body.status !== undefined) {
      if (typeof body.status !== "string" || !TASK_STATUSES.includes(body.status as TaskStatus)) {
        sendJSON(res, 400, { error: `status must be one of: ${TASK_STATUSES.join(", ")}` });
        return;
      }
    }
    const task = createTask(app, {
      title,
      description: optString(body.description),
      missionId: optString(body.missionId),
      projectId: optString(body.projectId),
      priority: normalizePriority(body.priority),
    });
    if (body.execute === true) {
      const prompt = task.description ? `${task.title}\n\n${task.description}` : task.title;
      const run = app.runs.start({ kind: "task", request: prompt, taskId: task.id, missionId: task.missionId, projectId: task.projectId });
      sendJSON(res, 201, { task, runId: run.id });
      return;
    }
    sendJSON(res, 201, { task });
    return;
  }
  if (id && action === "run" && method === "POST") {
    const task = app.store.snapshot.tasks.find((t) => t.id === id);
    if (!task) {
      sendJSON(res, 404, { error: "Task not found" });
      return;
    }
    task.attempts += 1;
    const prompt = task.description ? `${task.title}\n\n${task.description}` : task.title;
    const run = app.runs.start({ kind: "task", request: prompt, taskId: task.id, missionId: task.missionId, projectId: task.projectId });
    sendJSON(res, 202, { runId: run.id });
    return;
  }
  if (id && method === "PATCH") {
    const task = app.store.snapshot.tasks.find((t) => t.id === id);
    if (!task) {
      sendJSON(res, 404, { error: "Task not found" });
      return;
    }
    const body = await readBody(req);
    if (body.status !== undefined) {
      if (typeof body.status !== "string" || !TASK_STATUSES.includes(body.status as TaskStatus)) {
        sendJSON(res, 400, { error: `status must be one of: ${TASK_STATUSES.join(", ")}` });
        return;
      }
      task.status = body.status as Task["status"];
      task.updatedAt = nowISO();
      app.store.scheduleSave();
      app.bus.emit("task.updated", `Task ${task.status}: ${task.title}`, { taskId: task.id });
    }
    sendJSON(res, 200, { task });
    return;
  }
  if (id && method === "DELETE") {
    const ok = app.store.removeById(app.store.snapshot.tasks, id);
    sendJSON(res, ok ? 200 : 404, ok ? { ok: true } : { error: "Task not found" });
    return;
  }
  sendJSON(res, 404, { error: "Unknown tasks route" });
}

// ---------- projects ----------

async function handleProjects(
  app: App,
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  id?: string
): Promise<void> {
  if (method === "GET" && !id) {
    sendJSON(res, 200, { projects: app.store.snapshot.projects });
    return;
  }
  if (method === "POST" && !id) {
    const body = await readBody(req);
    const name = typeof body.name === "string" ? sanitizeText(body.name, 300) : "";
    if (!name) {
      sendJSON(res, 400, { error: "name is required" });
      return;
    }
    const now = nowISO();
    const project: Project = { id: newId(), name: name, createdAt: now, updatedAt: now };
    if (typeof body.description === "string" && body.description.trim()) {
      project.description = sanitizeText(body.description, 4000);
    }
    if (typeof body.objectives === "string" && body.objectives.trim()) {
      project.objectives = sanitizeText(body.objectives, 4000);
    }
    app.store.snapshot.projects.push(project);
    app.store.scheduleSave();
    app.bus.emit("project.created", `Project created: ${project.name}`, { data: { projectId: project.id } });
    sendJSON(res, 201, { project });
    return;
  }
  if (id && method === "GET") {
    const project = app.store.snapshot.projects.find((p) => p.id === id);
    if (!project) {
      sendJSON(res, 404, { error: "Project not found" });
      return;
    }
    const projMissions = app.store.snapshot.missions.filter((m) => m.projectId === project.id);
    const projTasks = app.store.snapshot.tasks.filter((t) => t.projectId === project.id);
    const projRuns = app.store.snapshot.runs.filter((r) => r.projectId === project.id).slice(-20).reverse();
    sendJSON(res, 200, { project, missions: projMissions, tasks: projTasks, runs: projRuns });
    return;
  }
  if (id && method === "PATCH") {
    const project = app.store.snapshot.projects.find((p) => p.id === id);
    if (!project) {
      sendJSON(res, 404, { error: "Project not found" });
      return;
    }
    const body = await readBody(req);
    if (typeof body.name === "string" && body.name.trim()) project.name = sanitizeText(body.name, 300);
    if (typeof body.description === "string") project.description = sanitizeText(body.description, 4000);
    if (typeof body.objectives === "string") project.objectives = sanitizeText(body.objectives, 4000);
    project.updatedAt = nowISO();
    app.store.scheduleSave();
    sendJSON(res, 200, { project });
    return;
  }
  if (id && method === "DELETE") {
    const ok = app.store.removeById(app.store.snapshot.projects, id);
    sendJSON(res, ok ? 200 : 404, ok ? { ok: true } : { error: "Project not found" });
    return;
  }
  sendJSON(res, 404, { error: "Unknown projects route" });
}

// ---------- workflows ----------

function createWorkflow(app: App, data: { name: string; description?: string | undefined; enabled?: boolean; intervalMinutes?: number | undefined; steps: WorkflowStep[] }): Workflow {
  const now = nowISO();
  const wf: Workflow = {
    id: newId(),
    name: data.name,
    description: data.description,
    enabled: data.enabled ?? true,
    intervalMinutes: data.intervalMinutes,
    steps: data.steps,
    createdAt: now,
    updatedAt: now,
  };
  if (wf.enabled && wf.intervalMinutes) {
    wf.nextRunAt = new Date(Date.now() + wf.intervalMinutes * 60000).toISOString();
  }
  app.store.snapshot.workflows.push(wf);
  app.store.scheduleSave();
  app.bus.emit("workflow.created", `Workflow created: ${wf.name}`, { data: { workflowId: wf.id } });
  return wf;
}

async function handleWorkflows(
  app: App,
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  id?: string,
  action?: string
): Promise<void> {
  const withSchedule = (): { workflows: Workflow[]; timezone: string } => {
    return {
      workflows: [...app.store.snapshot.workflows].reverse(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
  };

  if (method === "GET" && !id) {
    sendJSON(res, 200, withSchedule());
    return;
  }
  if (method === "POST" && !id) {
    const body = await readBody(req);
    const name = typeof body.name === "string" ? sanitizeText(body.name, 300) : "";
    if (!name) {
      sendJSON(res, 400, { error: "name is required" });
      return;
    }
    const steps = normalizeSteps(body.steps);
    if (steps.length === 0) {
      sendJSON(res, 400, { error: "at least one step with a prompt is required" });
      return;
    }
    const wf = createWorkflow(app, {
      name,
      description: optString(body.description),
      enabled: body.enabled !== false,
      intervalMinutes: normalizeInterval(body.intervalMinutes),
      steps,
    });
    sendJSON(res, 201, { workflow: wf });
    return;
  }
  if (id && action === "run" && method === "POST") {
    const wf = app.store.snapshot.workflows.find((w) => w.id === id);
    if (!wf) {
      sendJSON(res, 404, { error: "Workflow not found" });
      return;
    }
    const runId = app.scheduler.runWorkflow(wf.id, "manual");
    sendJSON(res, runId ? 202 : 409, runId ? { runId } : { error: "Workflow already executing" });
    return;
  }
  if (id && method === "PATCH") {
    const wf = app.store.snapshot.workflows.find((w) => w.id === id);
    if (!wf) {
      sendJSON(res, 404, { error: "Workflow not found" });
      return;
    }
    const body = await readBody(req);
    if (typeof body.enabled === "boolean") {
      wf.enabled = body.enabled;
      wf.nextRunAt = wf.enabled && wf.intervalMinutes
        ? new Date(Date.now() + wf.intervalMinutes * 60000).toISOString()
        : undefined;
    }
    if (typeof body.name === "string" && body.name.trim()) wf.name = sanitizeText(body.name, 300);
    if (typeof body.description === "string") wf.description = sanitizeText(body.description, 2000);
    if (body.steps !== undefined) {
      const steps = normalizeSteps(body.steps);
      if (steps.length > 0) wf.steps = steps;
    }
    if (body.intervalMinutes !== undefined) {
      wf.intervalMinutes = normalizeInterval(body.intervalMinutes);
      wf.nextRunAt = wf.enabled && wf.intervalMinutes
        ? new Date(Date.now() + wf.intervalMinutes * 60000).toISOString()
        : undefined;
    }
    wf.updatedAt = nowISO();
    app.store.scheduleSave();
    app.bus.emit("workflow.updated", `Workflow updated: ${wf.name}`, { data: { workflowId: wf.id } });
    sendJSON(res, 200, { workflow: wf });
    return;
  }
  if (id && method === "DELETE") {
    const ok = app.store.removeById(app.store.snapshot.workflows, id);
    sendJSON(res, ok ? 200 : 404, ok ? { ok: true } : { error: "Workflow not found" });
    return;
  }
  sendJSON(res, 404, { error: "Unknown workflows route" });
}

// ---------- mission plan finalizer ----------

/**
 * When a "plan" run completes, parse its output into concrete Task records
 * linked to the mission. Uses JSON when the model complies; falls back to
 * numbered or bulleted lines.
 */
export function startPlanFinalizer(app: App, createTaskFn: (app: App, data: Pick<Task, "title"> & Partial<Task>) => Task): void {
  app.bus.subscribe((evt) => {
    if (evt.type !== "run.completed" || !evt.runId) {
      return;
    }
    const run = app.runs.get(evt.runId);
    if (!run || (run as RunRecord & { purpose?: string }).purpose !== "plan" || !run.missionId) {
      return;
    }
    const mission = app.store.snapshot.missions.find((m) => m.id === run.missionId);
    if (!mission) {
      return;
    }
    const titles = parsePlanOutput(run.answer ?? "");
    let created = 0;
    for (const t of titles.slice(0, 25)) {
      createTaskFn(app, {
        title: t,
        missionId: mission.id,
        projectId: mission.projectId,
      });
      created++;
    }
    if (created > 0) {
      app.bus.emit("mission.updated", `Mission plan produced ${created} task(s): ${mission.name}`, { missionId: mission.id });
    }
  });
}

export function parsePlanOutput(answer: string): string[] {
  const text = answer.trim();
  const out: string[] = [];

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as { tasks?: unknown };
      if (Array.isArray(parsed.tasks)) {
        for (const t of parsed.tasks) {
          if (typeof t === "string" && t.trim()) {
            out.push(t.trim().slice(0, 300));
          }
        }
        return out;
      }
    } catch {
      // fall through to line parsing
    }
  }

  for (const line of text.split("\n")) {
    const stripped = line.replace(/^[\s\-*•\d.)\]]+/, "").trim();
    if (stripped.length >= 3 && !stripped.startsWith("{")) {
      out.push(stripped.slice(0, 300));
    }
  }
  return out;
}

// ---------- tools / memory / settings ----------

function toolList(app: App): { name: string; description: string; requiresApproval: boolean; category: string }[] {
  const knownCategories: [string, string][] = [
    ["read_file", "Files"], ["write_file", "Files"], ["edit_file", "Files"], ["delete_file", "Files"], ["list_dir", "Files"], ["grep_search", "Files"],
    ["shell", "Shell"], ["web_fetch", "Web"], ["web_search", "Web"], ["http_request", "APIs"],
    ["browser_", "Browser"], ["vscode_", "VS Code"], ["memory_", "Memory"], ["mcp_", "MCP"], ["subagent", "Agents"], ["opencode", "Interop"],
  ];
  return app.ctx.tools.list().map((t) => {
    let category = "Other";
    for (const [prefix, cat] of knownCategories) {
      if (t.name.startsWith(prefix) || t.name === prefix) {
        category = cat;
        break;
      }
    }
    return {
      name: t.name,
      description: t.description,
      requiresApproval: app.gate.isRequired(t.name),
      category,
    };
  });
}

async function handleMemory(
  app: App,
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  id?: string,
  url?: URL
): Promise<void> {
  if (method === "GET") {
    const all = app.memory.getAll();
    const q = url?.searchParams.get("q") ?? "";
    const query = q.trim().toLowerCase();
    const filtered = query
      ? all.filter((m) => m.content.toLowerCase().includes(query) || (m.tags ?? []).some((t) => t.toLowerCase().includes(query)))
      : all;
    sendJSON(res, 200, { entries: filtered.slice(-200).reverse(), total: all.length });
    return;
  }
  if (method === "POST") {
    const body = await readBody(req);
    const content = typeof body.content === "string" ? sanitizeText(body.content, 10000) : "";
    if (!content.trim()) {
      sendJSON(res, 400, { error: "content is required" });
      return;
    }
    const type = body.type === "semantic" || body.type === "procedural" || body.type === "episodic" ? body.type : "semantic";
    const importance =
      typeof body.importance === "number" && body.importance >= 0 && body.importance <= 1 ? body.importance : 0.7;
    const entry = await app.memory.store(content, type, {
      importance,
      tags: Array.isArray(body.tags) ? body.tags.map(String).slice(0, 10) : ["manual"],
    });
    app.bus.emit("memory.updated", "Memory entry created", { data: { memoryId: entry.id } });
    sendJSON(res, 201, { entry });
    return;
  }
  if (method === "DELETE" && id) {
    const ok = await app.memory.forget(id);
    if (ok) {
      app.bus.emit("memory.updated", "Memory entry deleted", { data: { memoryId: id } });
    }
    sendJSON(res, ok ? 200 : 404, ok ? { ok: true } : { error: "not found" });
    return;
  }
  sendJSON(res, 404, { error: "Unknown memory route" });
}

async function handleSettings(app: App, req: IncomingMessage, res: ServerResponse, method: string): Promise<void> {
  if (method === "GET") {
    sendJSON(res, 200, { settings: app.store.snapshot.settings });
    return;
  }
  if (method === "PATCH") {
    const body = await readBody(req);
    const s = app.store.snapshot.settings;
    if (typeof body.model === "string" && body.model.trim()) s.model = sanitizeText(body.model, 200);
    if (typeof body.provider === "string" && body.provider.trim()) s.provider = sanitizeText(body.provider, 100);
    if (body.runTimeoutMs !== undefined) {
      if (
        typeof body.runTimeoutMs !== "number" ||
        !Number.isFinite(body.runTimeoutMs) ||
        body.runTimeoutMs < 30000 ||
        body.runTimeoutMs > 3600000
      ) {
        throw new HttpError(400, "runTimeoutMs must be a number between 30000 and 3600000");
      }
      s.runTimeoutMs = Math.round(body.runTimeoutMs);
    }
    if (Array.isArray(body.approvalTools)) {
      s.approvalTools = body.approvalTools.map(String).filter((x) => x.length > 0 && x.length < 80).slice(0, 40);
      app.gate.setRequired(new Set(s.approvalTools));
    }
    app.store.scheduleSave();
    sendJSON(res, 200, { settings: s });
    return;
  }
  sendJSON(res, 404, { error: "Unknown settings route" });
}

// ---------- static UI ----------

function serveStatic(path: string, res: ServerResponse): void {
  const safeSuffix = normalize(path).replace(/^(\.\.[/\\])+/, "");
  let requested: string;
  if (safeSuffix === "/" || safeSuffix === "") {
    requested = "index.html";
  } else {
    requested = safeSuffix.slice(1);
  }

  const filePath = join(UI_DIR, requested);
  if (!filePath.startsWith(UI_DIR)) {
    sendJSON(res, 403, { error: "forbidden" });
    return;
  }

  if (!existsSync(filePath)) {
    // SPA fallback only for asset-less routes (no file extension);
    // missing *.js/*.css/*.png etc. are real 404s.
    if (extname(requested)) {
      sendJSON(res, 404, { error: "not found" });
      return;
    }
    const fallback = join(UI_DIR, "index.html");
    if (!existsSync(fallback)) {
      sendJSON(res, 404, { error: "UI not built — files missing from packages/dashboard/ui" });
      return;
    }
    respondFile(fallback, res);
    return;
  }
  respondFile(filePath, res);
}

function respondFile(filePath: string, res: ServerResponse): void {
  try {
    const data = readFileSync(filePath);
    res.writeHead(200, {
      "Content-Type": MIME[extname(filePath)] ?? "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(data);
  } catch {
    sendJSON(res, 500, { error: "failed to read UI file" });
  }
}

// re-export defaults used by CLI
export { defaultSettings };
