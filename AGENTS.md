# Alex Agents

## Commands
- `npm run build` — compile all packages in dependency order
- `npm run typecheck` — type-check all packages without emit
- `npm run lint` — ESLint (configured when available)
- `npm test` — type-check all packages + run `node:test` suite (`packages/dashboard/test/*.mjs`, 27 tests: state store, approvals gating, path containment, HTTP API, plan parsing)
- `npm run alex -- <request>` — run Alex CLI for a single task (auto-starts omniroute unless `--no-auto-start`)
- `npm run alex -i` — launch the TUI dashboard (interactive mode)
- `npm run web` / `npm run alex web` — launch the web operations console (`http://127.0.0.1:3007`)
- `npm run alex web -- --port <n> --host <addr> --token <t>` — web console options (non-loopback host requires `--token`)
- `npm run alex <request> --interop` — enable cross-host tools (opencode_run)
- `npm run alex <request> --use-opencode` — use OpenCode as the model provider
- `npm run alex <request> --no-auto-start` — skip auto-starting omniroute (use existing provider)
- `npm run alex <request> --provider <id>` — select a specific provider (omniroute, opencode)
- `npm run alex <request> --timeout <ms>` — set task timeout
- `npm run alex <request> --max-steps <n>` — limit agent iterations

## Web Operations Console (packages/dashboard)
- Serves a single-page UI from `packages/dashboard/ui` (vanilla JS, no deps) and a REST + SSE API under `/api/*`
- Binds to `127.0.0.1` by default; non-loopback binding requires `--token` or `ALEX_DASHBOARD_TOKEN`
- Persistent state: `~/.config/alex/dashboard-state.json` (missions, tasks, projects, workflows, conversations, runs, approvals, activity events)
- Memory store: `~/.kilo/memory.json` via `MemoryManager` (also exposed through the console Memory view)
- Approval gates: sensitive tools (shell, write/edit/delete file, http_request, vscode install/uninstall, subagent_start, opencode_run, browser_evaluate) pause runs server-side until approved in the Approvals view; the set is configurable in Settings → Models view
- Workflow scheduler: interval-based (30s tick), runs steps as sequential agent runs; server timezone shown in the UI
- OmniRoute integration: health/listing via `GET /v1/models` on the configured gateway; auto-start attempts `npx omniroute` unless `--no-auto-start`
- Mission planning: "Plan" on a mission starts a planning run (`POST /api/missions/:id/plan`); completed plan runs are parsed (`{"tasks":["..."]}` JSON, numbered/bulleted fallback) into real tasks linked to the mission
- Usage tracking: per-run token totals are attached by the agent loop to the final assistant message metadata and shown on runs/history
- Context compaction: agent loop auto-compacts long histories — tool-result cap (default 8000 chars) plus token-budget-based dropping of oldest tool-call rounds (kept: system prompt, memory block, original request, recent turns; an honest `[context compacted: N step(s) elided]` stub marks the boundary). Policy via `AgentConfig.compact = { thresholdTokens (24k), keepRecentUnits (6), toolResultMaxChars (8000) }`; savings surface on run rows in the console
- `npm run alex <request> --interop` — enable cross-host tools (opencode_run)
- `npm run alex <request> --use-opencode` — use OpenCode as the model provider
- `npm run alex <request> --no-auto-start` — skip auto-starting omniroute (use existing provider)
- `npm run alex <request> --provider <id>` — select a specific provider (omniroute, opencode)
- `npm run alex <request> --timeout <ms>` — set task timeout
- `npm run alex <request> --max-steps <n>` — limit agent iterations

## TUI Shortcuts
- `Ctrl+P` — open command palette
- `Ctrl+T` — focus terminal panel
- `Ctrl+E` — open VS Code extension browser (search + install)
- `Ctrl+L` — clear output
- `Ctrl+Q` or `Ctrl+C` — quit
- `Tab` — cycle between input and terminal
- `Esc` — close command palette / extensions browser

## Notes
- Target: Node 22 (ESM, NodeNext module resolution, es2022 lib)
- TypeScript target: es2022, module: NodeNext, moduleResolution: NodeNext
- Packages live under `packages/*` as npm workspace members
- Bridges use symlinked `@kilocode/plugin` and `@opencode-ai/plugin` from global config
- Omniroute provider defaults to `http://localhost:3000/v1` (OpenAI-compatible)
- TUI is a pure-ANSI implementation (no external deps), supports streaming + tool visibility
- Sub-agents spawn as separate `alex` processes via the `subagent_start` tool- VS Code extension management tools use the `code` CLI
- Browser automation uses Playwright with headless Chromium (auto-launched via `browser_launch`)
- Use `--skill browser` to activate browser automation tools, or call `browser_*` tools directly
- Persistent memory layer: `memory_store`, `memory_search`, `memory_forget`, `memory_summary` tools auto-inject relevant memories into agent context
- Memory stored in `~/.config/alex/memory.json` (or `.kilo/memory.json` relative to project)
