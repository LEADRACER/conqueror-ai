#!/usr/bin/env node

import { AgentLoop, OmnirouteService } from "@alex-ai/runtime";
import type { AgentConfig, ToolCall } from "@alex-ai/core";
import { interopTools } from "@alex-ai/tools";
import { TuiDashboard } from "./tui-dashboard.js";
import { startDashboard } from "@alex-ai/dashboard";
import process from "node:process";

interface CliOptions {
  provider?: string;
  model?: string;
  baseURL?: string;
  apiKey?: string;
  skill?: string[];
  interactive?: boolean;
  interop?: boolean;
  timeout?: number;
  maxSteps?: number;
  useOpencode?: boolean;
  noAutoStart?: boolean;
  web?: boolean;
  port?: string;
  host?: string;
  token?: string | null;
}

const C = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

const HELP = `${C.bold}alex${C.reset} — multihanded universal agent

${C.bold}Usage:${C.reset}
  alex <request>              Run a single task (streams to stdout)
  alex -i                     Launch the TUI dashboard
  alex web                    Launch the web operations console

${C.bold}Options:${C.reset}
  -i, --interactive        Interactive TUI dashboard
  --web                    Start the web dashboard server
  --port <n>               Web dashboard port (default 3007)
  --host <addr>            Bind address (default 127.0.0.1)
  --token <t>              Require a bearer token for the web dashboard
  --provider <id>          Provider: omniroute | opencode
  --model <name|id>        Model identifier
  --baseURL <url>          OpenAI-compatible base URL override
  --apiKey <key>           API key (prefer env: OMNIROUTE_API_KEY)
  --timeout <ms>           Per-run timeout
  --max-steps <n>          Max agent steps per run
  --skill <a,b,c>          Restrict to specific skills
  --interop                Enable cross-host tools (opencode_run)
  --use-opencode           Use OpenCode as the provider
  --no-auto-start          Do not auto-start omniroute
  -h, --help               This help
`;

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { interactive: false, token: null };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-i" || arg === "--interactive") {
      opts.interactive = true;
    } else if (arg === "--interop") {
      opts.interop = true;
    } else if (arg === "web" || arg === "--web") {
      opts.web = true;
    } else if (arg === "--provider") {
      const val = argv[i + 1];
      if (val !== undefined) { opts.provider = val; i++; }
    } else if (arg === "--model") {
      const val = argv[i + 1];
      if (val !== undefined) { opts.model = val; i++; }
    } else if (arg === "--baseURL") {
      const val = argv[i + 1];
      if (val !== undefined) { opts.baseURL = val; i++; }
    } else if (arg === "--apiKey") {
      const val = argv[i + 1];
      if (val !== undefined) { opts.apiKey = val; i++; }
    } else if (arg === "--timeout") {
      const val = argv[i + 1];
      if (val !== undefined) { opts.timeout = Number.parseInt(val, 10); i++; }
    } else if (arg === "--max-steps") {
      const val = argv[i + 1];
      if (val !== undefined) { opts.maxSteps = Number.parseInt(val, 10); i++; }
    } else if (arg === "--port") {
      const val = argv[i + 1];
      if (val !== undefined) { opts.port = val; i++; }
    } else if (arg === "--host") {
      const val = argv[i + 1];
      if (val !== undefined) { opts.host = val; i++; }
    } else if (arg === "--token") {
      const val = argv[i + 1];
      if (val !== undefined) { opts.token = val; i++; }
    } else if (arg === "--use-opencode") {
      opts.useOpencode = true;
    } else if (arg === "--no-auto-start") {
      opts.noAutoStart = true;
    } else if (arg === "--skill") {
      const val = argv[i + 1];
      if (val !== undefined) { opts.skill = val.split(","); i++; }
    } else if (arg === "-h" || arg === "--help") {
      process.stdout.write(HELP);
      process.exit(0);
    }
  }
  return opts;
}

function buildConfig(opts: CliOptions): Partial<AgentConfig> {
  const entries: [string, unknown][] = [];
  if (opts.useOpencode) {
    entries.push(["provider", "opencode"]);
  } else if (opts.provider !== undefined) {
    entries.push(["provider", opts.provider]);
  }
  if (opts.model !== undefined) entries.push(["model", opts.model]);
  if (opts.baseURL !== undefined) entries.push(["baseURL", opts.baseURL]);
  if (opts.apiKey !== undefined) entries.push(["apiKey", opts.apiKey]);
  if (opts.skill !== undefined) entries.push(["skills", opts.skill]);
  if (opts.maxSteps !== undefined) entries.push(["maxSteps", opts.maxSteps]);
  return Object.fromEntries(entries) as Partial<AgentConfig>;
}

let statusLineActive = false;

function clearStatus(): void {
  if (statusLineActive) {
    process.stdout.write(`\r\x1b[K`);
    statusLineActive = false;
  }
}

function formatToolCall(call: ToolCall): string {
  let argsStr: string;
  try {
    const obj = call.arguments as Record<string, unknown>;
    argsStr = JSON.stringify(obj);
  } catch {
    argsStr = String(call.arguments);
  }
  return `${C.yellow}[tool]${C.reset} ${C.bold}${call.name}${C.reset} ${argsStr}`;
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + "...";
}

async function runOneShot(request: string, opts: CliOptions, config: Partial<AgentConfig>): Promise<void> {
  // Default to omniroute for one-shot tasks; auto-start unless disabled or OpenCode selected
  if (!opts.useOpencode && opts.provider === undefined) {
    config.provider = "omniroute";
    const service = new OmnirouteService({
      baseURL: opts.baseURL ?? process.env.OMNIROUTE_URL ?? "http://localhost:3000",
      ...(opts.apiKey !== undefined ? { apiKey: opts.apiKey } : {}),
    });
    if (!opts.noAutoStart) {
      process.stderr.write(`${C.dim}checking omniroute gateway…${C.reset}\n`);
      const ready = await service.ensureRunning();
      if (!ready) {
        process.stderr.write(
          `${C.red}omniroute not reachable${C.reset} (auto-start failed or timed out). ` +
          `Start it manually or use --use-opencode / --provider.\n`
        );
        process.exit(2);
      }
      process.stderr.write(`${C.green}omniroute ready${C.reset} at ${service.getBaseURL()}\n`);
    }
    config.baseURL = config.baseURL ?? service.getBaseURL();
  }

  process.stderr.write(`${C.dim}thinking…${C.reset}\n`);
  const { agent } = await AgentLoop.createDefault(process.cwd(), config, {
    extraTools: opts.interop ? interopTools : [],
  });

  await agent.run(
    request,
    (msg) => {
      if (msg.role === "assistant" && msg.toolCalls) {
        for (const call of msg.toolCalls) {
          process.stderr.write(formatToolCall(call) + "\n");
        }
      } else if (msg.role === "tool") {
        const meta = msg.metadata as Record<string, unknown> | undefined;
        if (meta?.error) {
          process.stderr.write(`${C.red}[tool-failed]${C.reset} ${truncate(msg.content ?? "", 160)}\n`);
        }
      }
    },
    {
      stream: true,
      timeout: opts.timeout ?? 120000,
      onChunk: (delta) => {
        if (delta.content !== undefined) {
          process.stdout.write(delta.content);
        }
      },
    }
  );

  process.stdout.write("\n");
}

async function runWeb(opts: CliOptions): Promise<void> {
  const port = Number.parseInt(opts.port ?? "3007", 10) || 3007;
  const autoStart = !opts.noAutoStart;
  process.stderr.write(`${C.dim}starting dashboard…${C.reset}\n`);
  if (autoStart) {
    const service = new OmnirouteService({
      baseURL: opts.baseURL ?? process.env.OMNIROUTE_URL ?? "http://localhost:3000",
      ...(opts.apiKey !== undefined ? { apiKey: opts.apiKey } : {}),
    });
    void service
      .ensureRunning()
      .then((ok) => {
        if (ok) process.stderr.write(`${C.green}omniroute gateway ready${C.reset}\n`);
        else process.stderr.write(`${C.yellow}omniroute gateway not reachable — some AI actions will fail until it is started${C.reset}\n`);
      })
      .catch(() => {});
  }
  let dash;
  try {
    dash = await startDashboard({
      port,
      ...(opts.host !== undefined ? { host: opts.host } : {}),
      ...(opts.token ? { token: opts.token } : {}),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("EADDRINUSE")) {
      process.stderr.write(`${C.red}Fatal:${C.reset} port ${port} is already in use. Stop the other process or choose --port <n>.\n`);
      process.exit(2);
    }
    throw err;
  }
  const url = `http://127.0.0.1:${dash.port}`;
  process.stdout.write(
    `${C.bold}Alex web console${C.reset} → ${C.cyan}${url}${C.reset}\n` +
    `${C.dim}(Ctrl+C to stop)${C.reset}\n`
  );
  const shutdown = () => {
    void dash.close().then(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function main() {
  try {
    const argv = process.argv;
    const opts = parseArgs(argv);
    const config = buildConfig(opts);

    // extract positional request text, skipping flag values
    const VALUE_FLAGS = new Set(["--provider", "--model", "--baseURL", "--apiKey", "--timeout", "--max-steps", "--port", "--host", "--token", "--skill"]);
    const plain: string[] = [];
    let skipNext = false;
    argv.slice(2).forEach((arg, i, arr) => {
      if (skipNext) {
        skipNext = false;
        return;
      }
      if (arg.startsWith("-")) {
        if (VALUE_FLAGS.has(arg)) {
          skipNext = true;
        }
        return;
      }
      if (arg === "web" && i === 0) {
        return;
      }
      const prev = arr[i - 1];
      if (VALUE_FLAGS.has(prev ?? "")) {
        return;
      }
      plain.push(arg);
    });
    const request = plain.join(" ").trim();

    if (!opts.interactive && !opts.web && request === "" && !process.stdin.isTTY) {
      process.stdout.write(HELP);
      process.exit(0);
    }

    if (opts.web) {
      await runWeb(opts);
      return;
    }

    if (opts.interactive || (request === "" && process.stdin.isTTY)) {
      const { ctx, agent } = await AgentLoop.createDefault(process.cwd(), config, {
        extraTools: opts.interop ? interopTools : [],
      });
      const tui = new TuiDashboard(ctx, agent, process.cwd());
      tui.start();
      process.stdin.on("data", (data: Buffer) => {
        const str = data.toString("utf8");
        for (let i = 0; i < str.length; i++) {
          const key = str[i]!;
          if (key === "\x1b") {
            const next = str[i + 1];
            if (next === "q" || next === "Q") {
              tui.stop();
              process.exit(0);
            }
            const remaining = str.slice(i + 1);
            if (!tui.handleKey("\x1b" + remaining)) {
              tui.stop();
              process.exit(0);
            }
            break;
          } else {
            if (!tui.handleKey(key)) {
              tui.stop();
              process.exit(0);
            }
          }
        }
      });
      return;
    }

    if (request !== "") {
      await runOneShot(request, opts, config);
      return;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    clearStatus();
    console.error(`${C.red}Fatal:${C.reset}`, msg);
    process.exit(1);
  }
}

main().catch((err) => {
  clearStatus();
  console.error(`${C.red}Fatal:${C.reset}`, err);
  process.exit(1);
});
