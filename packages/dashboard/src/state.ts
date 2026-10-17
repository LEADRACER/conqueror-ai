import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";

import { dirname, resolve } from "node:path";

import os from "node:os";

import { randomUUID } from "node:crypto";


export type RunStatus = "queued" | "running" | "waiting_approval" | "completed" | "failed" | "cancelled";

export type MissionStatus = "active" | "paused" | "completed" | "failed" | "cancelled";

export type TaskStatus = "pending" | "running" | "awaiting_approval" | "completed" | "failed" | "cancelled";

export type Priority = "low" | "medium" | "high";


export interface RunRecord {
  id: string;

  kind: "chat" | "task" | "workflow";

  request: string;

  conversationId?: string | undefined;

  missionId?: string | undefined;

  taskId?: string | undefined;

  projectId?: string | undefined;
  status: RunStatus;

  provider: string;

  model: string;

  startedAt?: string | undefined;

  endedAt?: string | undefined;

  error?: string | undefined;

  answer?: string | undefined;
  dims: { steps: number;
 inputTokens: number;
 outputTokens: number };

  toolCalls: { name: string;
 ts: string;
 ok: boolean;
 ms: number }[];

}

export interface Conversation {
  id: string;

  title: string;

  projectId?: string | undefined;
  archived: boolean;

  createdAt: string;

  updatedAt: string;

  messages: {
    id: string;

    role: "user" | "assistant" | "system" | "tool";

    content?: string | undefined;
    ts: string;

    runId?: string | undefined;
  }[];

}

export interface Mission {
  id: string;

  name: string;

  objective: string;

  successCriteria?: string | undefined;
  priority: Priority;

  constraints?: string | undefined;

  deadline?: string | undefined;
  status: MissionStatus;

  projectId?: string | undefined;

  outcome?: string | undefined;
  blockers: string[];

  artifacts: string[];

  runIds: string[];

  createdAt: string;

  updatedAt: string;

}

export interface Task {
  id: string;

  missionId?: string | undefined;

  projectId?: string | undefined;
  title: string;

  description?: string | undefined;
  status: TaskStatus;

  priority: Priority;

  attempts: number;

  runId?: string | undefined;

  output?: string | undefined;

  error?: string | undefined;
  createdAt: string;

  updatedAt: string;

}

export interface Project {
  id: string;

  name: string;

  description?: string | undefined;

  objectives?: string | undefined;

  notes?: string | undefined;
  createdAt: string;

  updatedAt: string;

}

export interface WorkflowStep {
  id: string;

  name: string;

  prompt: string;

}

export interface Workflow {
  id: string;

  name: string;

  description?: string | undefined;
  enabled: boolean;

  intervalMinutes?: number | undefined;

  nextRunAt?: string | undefined;

  lastRunAt?: string | undefined;

  lastStatus?: "completed" | "failed" | undefined;
  steps: WorkflowStep[];

  createdAt: string;

  updatedAt: string;

}

export interface ApprovalRecord {
  id: string;

  runId?: string | undefined;
  tool: string;

  argsPreview: string;

  reason?: string;

  status: "pending" | "approved" | "rejected" | "expired";

  createdAt: string;

  decidedAt?: string | undefined;
}

export interface DashEvent {
  id: number;

  ts: string;

  type: string;

  message: string;

  runId?: string | undefined;

  missionId?: string | undefined;

  taskId?: string | undefined;

  data?: Record<string, unknown>;

}

export interface Settings {
  provider: string;

  model: string;

  runTimeoutMs: number;

  approvalTools: string[];

}

export interface StateFile {
  version: 1;

  conversations: Conversation[];

  missions: Mission[];

  tasks: Task[];

  projects: Project[];

  workflows: Workflow[];

  approvals: ApprovalRecord[];

  events: DashEvent[];

  runs: RunRecord[];

  settings: Settings;

  eventSeq: number;

}

export interface RunConfig {
  timeoutMs?: number;

  approvalTools?: string[];

}

const REPLACES: { [k: string]: string } = {
  "\u2028": " ",
  "\u2029": " ",
};


export function defaultSettings(): Settings {
  return {
    provider: "omniroute",
    model: "gpt-4o",
    runTimeoutMs: 600000,
    approvalTools: [
      "shell",
      "write_file",
      "edit_file",
      "delete_file",
      "http_request",
      "vscode_install",
      "vscode_uninstall",
      "subagent_start",
      "opencode_run",
      "browser_evaluate",
    ],
  };

}

export function emptyState(): StateFile {
  return {
    version: 1,
    conversations: [],
    missions: [],
    tasks: [],
    projects: [],
    workflows: [],
    approvals: [],
    events: [],
    runs: [],
    settings: defaultSettings(),
    eventSeq: 0,
  };

}

export function dashboardHome(): string {
  const base = process.env.ALEX_HOME ?? resolve(os.homedir(), ".config", "alex");

  return base;

}

export class StateStore {
  private filePath: string;

  private state: StateFile;

  private saveTimer: NodeJS.Timeout | null = null;


  constructor(basePath?: string) {
    const base = basePath ?? dashboardHome();

    this.filePath = resolve(base, "dashboard-state.json");

    this.state = this.load();

  }

  private load(): StateFile {
    if (existsSync(this.filePath)) {
      try {
        const raw = readFileSync(this.filePath, "utf-8");

        const parsed = JSON.parse(raw) as Partial<StateFile>;

        const merged: StateFile = { ...emptyState(), ...parsed };

        merged.settings = { ...defaultSettings(), ...(parsed.settings ?? {}) };

        return merged;

      } catch {
        return { ...emptyState() };

      }
    }
    return { ...emptyState() };

  }

  get snapshot(): StateFile {
    return this.state;

  }

  flush(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);

      this.saveTimer = null;

    }
    const dir = dirname(this.filePath);

    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });

    }
    const tmp = this.filePath + ".tmp";

    try {
      writeFileSync(tmp, JSON.stringify(this.state, null, 2), "utf-8");

      renameSync(tmp, this.filePath);

    } catch {
      // best-effort persistence; server keeps serving from memory
    }
  }

  scheduleSave(): void {
    if (this.saveTimer) {
      return;

    }
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;

      this.flush();

    }, 500);

  }

  nextEventId(): number {
    this.state.eventSeq += 1;

    return this.state.eventSeq;

  }

  addEvent(evt: DashEvent): void {
    this.state.events.push(evt);

    if (this.state.events.length > 2000) {
      this.state.events.splice(0, this.state.events.length - 2000);

    }
    this.scheduleSave();

  }

  upsert<T extends { id: string }>(list: T[], item: T): void {
    const idx = list.findIndex((x) => x.id === item.id);

    if (idx >= 0) {
      list[idx] = item;

    } else {
      list.push(item);

    }
    this.scheduleSave();

  }

  removeById<T extends { id: string }>(list: T[], id: string): boolean {
    const idx = list.findIndex((x) => x.id === id);

    if (idx >= 0) {
      list.splice(idx, 1);

      this.scheduleSave();

      return true;

    }
    return false;

  }

  save(): void {
    this.flush();

  }
}

export function newId(): string {
  return randomUUID();

}

export function nowISO(): string {
  return new Date().toISOString();

}

export function sanitizeText(input: string, maxLength: number = 20000): string {
  let out = input.slice(0, maxLength);

  for (const [raw, replacement] of Object.entries(REPLACES)) {
    out = out.replace(new RegExp(raw, "g"), replacement);

  }
  // strip control chars except newline/tab
  out = out.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

  return out;

}
