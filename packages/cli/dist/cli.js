#!/usr/bin/env node
import { AgentLoop, OmnirouteService } from "@alex-ai/runtime";
import { interopTools } from "@alex-ai/tools";
import { TuiDashboard } from "./tui-dashboard.js";
import * as process from "node:process";
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
let statusLineActive = false;
function clearStatus() {
    if (statusLineActive) {
        process.stdout.write(`\r\x1b[K`);
        statusLineActive = false;
    }
}
function parseArgs(argv) {
    const opts = { interactive: false };
    for (let i = 2; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "-i" || arg === "--interactive") {
            opts.interactive = true;
        }
        else if (arg === "--interop") {
            opts.interop = true;
        }
        else if (arg === "--provider") {
            const val = argv[i + 1];
            if (val !== undefined) {
                opts.provider = val;
                i++;
            }
        }
        else if (arg === "--model") {
            const val = argv[i + 1];
            if (val !== undefined) {
                opts.model = val;
                i++;
            }
        }
        else if (arg === "--baseURL") {
            const val = argv[i + 1];
            if (val !== undefined) {
                opts.baseURL = val;
                i++;
            }
        }
        else if (arg === "--apiKey") {
            const val = argv[i + 1];
            if (val !== undefined) {
                opts.apiKey = val;
                i++;
            }
        }
        else if (arg === "--timeout") {
            const val = argv[i + 1];
            if (val !== undefined) {
                opts.timeout = Number.parseInt(val, 10);
                i++;
            }
        }
        else if (arg === "--max-steps") {
            const val = argv[i + 1];
            if (val !== undefined) {
                opts.maxSteps = Number.parseInt(val, 10);
                i++;
            }
        }
        else if (arg === "--use-opencode") {
            opts.useOpencode = true;
        }
        else if (arg === "--no-auto-start") {
            opts.noAutoStart = true;
        }
        else if (arg === "--skill") {
            const val = argv[i + 1];
            if (val !== undefined) {
                opts.skill = val.split(",");
                i++;
            }
        }
    }
    return opts;
}
function buildConfig(opts) {
    const entries = [];
    if (opts.useOpencode) {
        entries.push(["provider", "opencode"]);
    }
    else if (opts.provider !== undefined) {
        entries.push(["provider", opts.provider]);
    }
    if (opts.model !== undefined)
        entries.push(["model", opts.model]);
    if (opts.baseURL !== undefined)
        entries.push(["baseURL", opts.baseURL]);
    if (opts.apiKey !== undefined)
        entries.push(["apiKey", opts.apiKey]);
    if (opts.skill !== undefined)
        entries.push(["skills", opts.skill]);
    if (opts.maxSteps !== undefined)
        entries.push(["maxSteps", opts.maxSteps]);
    return Object.fromEntries(entries);
}
function formatToolCall(call) {
    let argsStr;
    try {
        const obj = call.arguments;
        argsStr = JSON.stringify(obj);
    }
    catch {
        argsStr = String(call.arguments);
    }
    return `${C.yellow}[tool]${C.reset} ${C.bold}${call.name}${C.reset} ${argsStr}`;
}
function truncate(text, maxLen) {
    if (text.length <= maxLen)
        return text;
    return text.slice(0, maxLen - 3) + "...";
}
async function runWithOutput(ctx, agent, request, opts) {
    void ctx;
    const maxSteps = opts.maxSteps ?? 50;
    let step = 0;
    const onProgress = (msg) => {
        step++;
        clearStatus();
        if (msg.role === "assistant") {
            if (msg.content) {
                process.stdout.write(`${C.cyan}alex${C.reset}: ${msg.content}\n`);
            }
            if (msg.toolCalls && msg.toolCalls.length > 0) {
                for (const call of msg.toolCalls) {
                    process.stdout.write(`\n  ${formatToolCall(call)}\n`);
                }
            }
        }
        else if (msg.role === "tool") {
            const preview = truncate(msg.content ?? "", 200);
            process.stdout.write(`\n  ${C.gray}[result]${C.reset} ${preview}\n`);
            if ((msg.content ?? "").length > 200) {
                process.stdout.write(`  ${C.gray}(${msg.content.length} chars total)${C.reset}\n`);
            }
        }
    };
    const onChunk = (delta) => {
        if (delta.content) {
            process.stdout.write(delta.content);
        }
    };
    await agent.run(request, onProgress, {
        stream: true,
        timeout: opts.timeout ?? 120000,
        onChunk,
    });
    process.stdout.write("\n");
}
async function main() {
    let omnirouteService = null;
    try {
        const argv = process.argv;
        const opts = parseArgs(argv);
        const config = buildConfig(opts);
        const request = argv.slice(2).filter((a) => !a.startsWith("-")).join(" ").trim();
        if (!request && !opts.interactive) {
            console.error("Usage: alex <request> [-i|--interactive] [--model MODEL] [--provider PROVIDER] [--baseURL URL] [--apiKey KEY] [--skill s1,s2] [--timeout MS] [--max-steps N] [--use-opencode] [--no-auto-start] [--interop]");
            process.exit(1);
        }
        const shouldAutoStart = !opts.noAutoStart && opts.provider !== "opencode" && !opts.useOpencode;
        if (shouldAutoStart) {
            const baseURL = opts.baseURL ?? "http://localhost:3000";
            const svcOpts = { baseURL };
            if (opts.apiKey !== undefined) {
                svcOpts.apiKey = opts.apiKey;
            }
            omnirouteService = new OmnirouteService(svcOpts);
            const running = await omnirouteService.ensureRunning();
            if (!running && !(await omnirouteService.isRunning())) {
                console.error(`${C.red}Error:${C.reset} Failed to start omniroute.`);
                console.error(`${C.dim}Run manually: npx omniroute, or use --no-auto-start and set --baseURL${C.reset}`);
                process.exit(1);
            }
        }
        const { ctx, agent } = await AgentLoop.createDefault(process.cwd(), config, {
            extraTools: opts.interop ? interopTools : [],
        });
        if (opts.interactive) {
            const tui = new TuiDashboard(ctx, agent, process.cwd());
            tui.start();
            process.stdin.on("data", (data) => {
                const str = data.toString("utf8");
                for (let i = 0; i < str.length; i++) {
                    const key = str[i];
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
                    }
                    else {
                        if (!tui.handleKey(key)) {
                            tui.stop();
                            process.exit(0);
                        }
                    }
                }
            });
        }
        else {
            await runWithOutput(ctx, agent, request, opts);
        }
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("ECONNREFUSED") || msg.includes("fetch failed")) {
            clearStatus();
            console.error(`${C.red}Error:${C.reset} Cannot connect to model provider.`);
            console.error(`${C.dim}Ensure omniroute or your provider is running, or set ${C.cyan}--baseURL${C.dim} to a reachable endpoint.${C.reset}`);
            omnirouteService?.stop();
            process.exit(1);
        }
        clearStatus();
        console.error(`${C.red}Fatal:${C.reset}`, msg);
        omnirouteService?.stop();
        process.exit(1);
    }
    if (omnirouteService && omnirouteService.isStarted()) {
        omnirouteService.stop();
    }
}
main().catch((err) => {
    clearStatus();
    console.error(`${C.red}Fatal:${C.reset}`, err);
    process.exit(1);
});
//# sourceMappingURL=cli.js.map