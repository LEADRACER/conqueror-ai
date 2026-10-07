# Alex - Universal Multihanded Agent Framework

## Vision

Alex is a **multihanded universal agent** that:
- Registers as a **skill provider inside Kilo** (`@kilocode/plugin` Hooks API)
- Registers as a **skill provider inside OpenCode** (`@opencode-ai/plugin` v2/promise API)
- Routes LLM calls through **omniroute** (358 providers via OpenAI-compatible API + API keys)
- Exposes a **standalone CLI** for headless / automation use

> "Linearly complex" means every added capability (tool, skill, provider) is a self-contained module that plugs into a uniform interface. Adding N modules costs O(N) to the codebase — tools are discovered dynamically by description, not wired pairwise.

---

## Architecture Overview

```
/packages
   /core           Shared types, TaskGraph, AgentContext, Tool interface
   /experience     Persistent memory layer (MemoryManager, JSON file store)
   /providers      Provider adapters (omniroute, OpenCode, OpenAI-compatible)
  /skills         Self-contained capability modules (coding, research, automation, creative, browser, memory)
  /tools          Generic tool wrappers (shell, fs, web, mcp, api, vscode, interop, browser)
  /bridges        Host integration — how Alex surfaces inside Kilo / OpenCode
    /kilo         Kilo plugin (Hook API) → re-exports core tools as Kilo tools
    /opencode     OpenCode plugin → registers tools + omniroute provider
  /runtime        Standalone orchestration engine (agent loop, tool dispatch)
  /unified        Unified context builder (all tools + providers + skills merged)
  /cli            Entry point: `alex` CLI

/scripts
  /build          Build all packages
```

### Layer model (linear composition)

```
┌────────────────────────────────────────────────┐
│  HOST: Kilo / OpenCode / CLI                   │
│    (bridge layer — thin adapter)               │
├───────────────────────────────────────────────┤
│  Runtime: planning + agent loop + tool dispatch│
│    (generic, host-agnostic)                    │
├────────────────────────────────────────────────┤
│  Skills: each bundles tools + system prompt   │
│    coding • research • web • automation ...    │
├────────────────────────────────────────────────┤
│  Tools: filesystem • shell • web • mcp • api  │
├────────────────────────────────────────────────┤
│  Providers: omniroute (OpenAI-compatible)      │
│              bedrock    (AWS)                  │
│              direct     (REST)                 │
└────────────────────────────────────────────────┘
```

---

## Implementation Plan

### Phase 1 — Foundation (`/packages/core`)

1. **Types**: `Tool`, `ToolContext`, `Provider`, `Skill`, `AgentConfig`, `Message`
2. **AgentContext**: shared runtime state (directory, env, abort signal, metadata)
3. **TaskGraph**: lightweight DAG for tracking sub-tasks (linear growth)
4. **Registry**: `SkillRegistry` + `ToolRegistry` — registration is O(1), lookup is O(1)

### Phase 2 — Providers (`/packages/providers`)

1. **omniroute**: OpenAI-compatible client, uses API key. Exposes `chat()` / `stream()`
2. **direct**: thin OpenAI-compatible wrapper (works with any compatible endpoint)
3. **ProviderSelector**: picks the best provider per task (config-driven, pluggable)

### Phase 3 — Skills + Tools (`/packages/skills`, `/packages/tools`)

Each skill is a folder: `index.ts` (registers tools + returns system prompt).
Each tool implements `{ name, description, args (zod), execute(ctx) }`.

- `tools/shell` — runs commands via child_process
- `tools/fs` — read/write/list/grep/edit
- `tools/web` — fetch URLs, scrape, summarize
- `tools/mcp` — connect to MCP servers, expose as tools
- `tools/api` — generic HTTP client tool
- `tools/vscode` — VS Code extension management (install, list, search, command)
- `tools/browser` — Live browser automation via Playwright Chromium (navigate, click, type, screenshot, evaluate)
- `tools/browser` — Live browser automation via Playwright Chromium (navigate, click, type, screenshot, evaluate, CDP hijack)
- `tools/memory` — Persistent memory layer (store, search, forget, summary)
- `tools/subagent` — Spawn co-worker sub-agents as separate Alex processes
- `tools/interop` — cross-host dispatch (opencode_run, kilo_run)
- `skills/coding` — coding tools + system prompt
- `skills/research` — web + synthesis tools
- `skills/automation` — shell + scheduling + scripting
- `skills/creative` — writing + image generation tools

### Phase 4 — Runtime (`/packages/runtime`)

1. **Planner**: breaks a user request into sub-tasks
2. **AgentLoop**: tool-calling loop over registered providers
3. **ToolDispatch**: routes tool calls by name, collects results
4. **Experience Layer**: short-term (turn) + long-term persistent memory (JSON file store with keyword search)

### Phase 5 — Bridges (linear adapters)

#### 5a. `/packages/bridges/kilo`

- Exports a Kilo plugin that:
  - Reads `input.$` (BunShell), `input.directory`, `input.client` (KiloClient)
  - Registers all core `tools` as Kilo `ToolDefinition`s
  - Exposes `skill` (coding, research, etc.) as Kilo tools
  - Uses `auth` hook to register omniroute as a provider API-key auth
- Config in `.kilo/kilo.jsonc` → `"plugin"` entry

#### 5b. `/packages/bridges/opencode`

- Uses `@opencode-ai/plugin/v2/promise`:
  - `skill.transform(draft)` → register skill directories (each skill = a directory of tools)
  - `catalog.transform(draft)` → register omniroute as a provider + models
  - `aisdk.hooks({ sdk, language })` → provide a `LanguageModelV3` backed by omniroute OpenAI-compatible
  - `integration.transform` + `integration.connection` → register omniroute API key as a credential integration
  - `command.transform` → register `alex` commands inside OpenCode
  - `tool` (v1 Hooks) → export `alex_*` tools for direct invocation

### Phase 6 — CLI (`/packages/cli`)

- `alex <prompt>` — runs a single task, streams to stdout
- Uses omniroute as default provider (or reads from env)
- Loads all built-in skills + tools

---

## Tech Stack

| Layer      | Tech                                   |
|------------|----------------------------------------|
| Language   | TypeScript (ESM)                       |
| Package mgt| npm workspaces                         |
| Schema     | zod (as used by both plugins)          |
| Effects    | native Promise (interop with Effect)  |
| HTTP       | undici / native fetch                  |
| Shell      | child_process                          |
| MCP        | @modelcontextprotocol/sdk              |
| AI provider| Omniroute (OpenAI-compatible)            |
| TUI        | Pure ANSI (no external deps)            |

## Deliverables (Milestone order)

1. `package.json` workspace + tsconfig
2. `/packages/core` — types + registry + context
3. `/packages/providers/omniroute` — OpenAI-compatible client
4. `/packages/tools/fs` + `/packages/tools/shell` + `/packages/tools/web`
5. `/packages/skills/coding` — coding tools + system prompt
6. `/packages/runtime` — planner + agent loop + tool dispatch
7. `/packages/bridges/kilo` — Kilo plugin adapter
8. `/packages/bridges/opencode` — OpenCode plugin adapter
9. `/packages/cli` — standalone `alex` command + TUI dashboard
10. `/packages/unified` — unified context builder (all tools + providers merged)
11. `AGENTS.md` — lint / typecheck / build / run commands

## Cross-Host Unified Usage

When Alex runs inside Kilo, inside OpenCode, or standalone, it has access to the same
20-tool set — all 12 core tools, 5 VS Code extension tools, 2 cross-host dispatch, 8 browser automation tools
tools, and 2 sub-agent management tools. All route through omniroute as the unified provider.

- **Inside Kilo**: use native tools + Kilo's built-in tools + `opencode_run` to delegate to OpenCode
- **Inside OpenCode**: use native tools + OpenCode's built-ins + `opencode_run` to delegate to OpenCode
- **Standalone CLI**: `alex "..." --interop` enables cross-host tools

## Linearity Proof (design guarantee)

- Each tool = 1 entry in `ToolRegistry` (O(1)).
- Each skill = 1 entry in `SkillRegistry`, references ≤ k tools (O(k), k small constant).
- Provider = 1 entry in `ProviderRegistry`.
- Discovery is by LLM reading tool descriptions — no pairwise wiring.
- Cross-tool calls are always via the generic `ToolContext.callTool()` — no hard coupling.

**Result: N tools, S skills, P providers → build cost O(N + S + P), not O(N²).**
