#!/usr/bin/env node

import { AgentLoop } from "@alex-ai/runtime";
import type { AgentConfig } from "@alex-ai/core";
import { TuiDashboard } from "./tui-dashboard.js";
import { startDashboard } from "@alex-ai/dashboard";
import process from "node:process";

interface CliOptions {
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
};

const HELP = `${C.bold}alex${C.reset} — multihanded universal agent (TUI-first)

${C.bold}Usage:${C.reset}
  alex                        Launch the TUI dashboard (works without a model)
  alex -i                     Same as above
  alex web                    Launch the web operations console

${C.bold}Web options:${C.reset}
  --port <n>               Dashboard port (default 3007)
  --host <addr>            Bind address (default 127.0.0.1; non-loopback needs --token)
  --token <t>              Bearer token for the web console
  -h, --help               This help

${C.bold}Environment:${C.reset}
  OMNIROUTE_URL            OpenAI-compatible gateway (e.g. http://127.0.0.1:20128)
  ALEX_DASHBOARD_TOKEN     Token for non-loopback web binding
`;

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { token: null };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "web" || arg === "--web") {
      opts.web = true;
    } else if (arg === "--port") {
      const val = argv[i + 1];
      if (val !== undefined) { opts.port = val; i++; }
    } else if (arg === "--host") {
      const val = argv[i + 1];
      if (val !== undefined) { opts.host = val; i++; }
    } else if (arg === "--token") {
      const val = argv[i + 1];
      if (val !== undefined) { opts.token = val; i++; }
    } else if (arg === "-i" || arg === "--interactive") {
      // TUI is the default; accepted for compatibility
    } else if (arg === "-h" || arg === "--help") {
      process.stdout.write(HELP);
      process.exit(0);
    } else if (arg && !arg.startsWith("-") && arg !== "web") {
      process.stderr.write(
        `${C.yellow}note:${C.reset} one-shot CLI mode was removed. Use the TUI (${C.bold}alex${C.reset}) or the web console (${C.bold}alex web${C.reset}).\n`
      );
    }
  }
  return opts;
}

async function runWeb(opts: CliOptions): Promise<void> {
  const parsedPort = Number.parseInt(opts.port ?? "3007", 10);
  const port = Number.isNaN(parsedPort) ? 3007 : parsedPort;
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
    const opts = parseArgs(process.argv);

    if (opts.web) {
      await runWeb(opts);
      return;
    }

    // TUI: starts with or without a reachable model; runs fail honestly.
    const { ctx, agent } = await AgentLoop.createDefault(process.cwd());
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
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${C.red}Fatal:${C.reset}`, msg);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`${C.red}Fatal:${C.reset}`, err);
  process.exit(1);
});
