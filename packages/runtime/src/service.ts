import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";

const LOCAL_OMNIROUTE_URL = "http://localhost:3000";
const HEALTH_CHECK_PATH = "/v1/models";
const STARTUP_TIMEOUT_MS = 30000;
const POLL_INTERVAL_MS = 500;

export interface OmnirouteServiceOptions {
  baseURL?: string;
  apiKey?: string;
  autoStart?: boolean;
  noAutoStart?: boolean;
}

export class OmnirouteService {
  private process: ChildProcess | null = null;
  private baseURL: string;
  private apiKey?: string;
  private started: boolean = false;

  constructor(options: OmnirouteServiceOptions = {}) {
    this.baseURL = options.baseURL ?? LOCAL_OMNIROUTE_URL;
    if (options.apiKey !== undefined) {
      this.apiKey = options.apiKey;
    }
  }

  async isRunning(): Promise<boolean> {
    try {
      const url = new URL(HEALTH_CHECK_PATH, this.baseURL);
      const resp = await fetch(url.toString(), {
        method: "GET",
        signal: AbortSignal.timeout(3000),
      });
      return resp.ok;
    } catch {
      return false;
    }
  }

  async start(): Promise<boolean> {
    if (this.started) {
      return true;
    }

    const running = await this.isRunning();
    if (running) {
      this.started = true;
      return true;
    }

    const args = ["omniroute"];
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined) {
        env[k] = v;
      }
    }
    if (this.apiKey) {
      env.OMNIROUTE_API_KEY = this.apiKey;
    }

    this.process = spawn("npx", args, {
      shell: true,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });

    this.process.stdout?.on("data", (data) => {
      process.stderr.write(`[omniroute] ${data}`);
    });
    this.process.stderr?.on("data", (data) => {
      process.stderr.write(`[omniroute] ${data}`);
    });

    const ready = await this.waitForReady(STARTUP_TIMEOUT_MS);
    if (!ready) {
      this.stop();
      return false;
    }

    this.started = true;
    return true;
  }

  private async waitForReady(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await this.isRunning()) {
        return true;
      }
      await sleep(POLL_INTERVAL_MS);
    }
    return false;
  }

  stop(): void {
    if (this.process) {
      this.process.kill("SIGTERM");
      try {
        this.process.kill("SIGKILL");
      } catch {
      }
      this.process = null;
    }
    this.started = false;
  }

  async ensureRunning(): Promise<boolean> {
    if (await this.isRunning()) {
      this.started = true;
      return true;
    }
    return this.start();
  }

  getBaseURL(): string {
    return this.baseURL;
  }

  isStarted(): boolean {
    return this.started;
  }
}

export class RemoteOmnirouteProvider {
  readonly id = "omniroute-remote";
  readonly name = "Omniroute (Remote)";
  readonly models: string[] = ["gpt-4o", "claude-3-5-sonnet-20241022"];

  constructor(private baseURL: string, private apiKey?: string) {}

  getBaseURL(): string {
    return this.baseURL;
  }

  getAPIKey(): string | undefined {
    return this.apiKey;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const REMOTE_OMNIROUTE_URL = "https://router.kilocode.ai/v1";
