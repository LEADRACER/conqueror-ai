# Alex Agents

## Commands
- `npm run build` — compile all packages in dependency order
- `npm run typecheck` — type-check all packages without emit
- `npm run lint` — ESLint (configured when available)
- `npm test` — smoke test: type-check all packages
- `npm run alex -- <request>` — run Alex CLI for a single task
- `npm run alex -i` — launch the TUI dashboard (interactive mode)
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
- Sub-agents spawn as separate `alex` processes via the `subagent_start` tool
- VS Code extension management tools use the `code` CLI
- Browser automation uses Playwright with headless Chromium (auto-launched via `browser_launch`)
- Use `--skill browser` to activate browser automation tools, or call `browser_*` tools directly
- Persistent memory layer: `memory_store`, `memory_search`, `memory_forget`, `memory_summary` tools auto-inject relevant memories into agent context
- Memory stored in `~/.config/alex/memory.json` (or `.kilo/memory.json` relative to project)
