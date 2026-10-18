import type { AlexContext, Message, ToolCall } from "@alex-ai/core";
import { AgentLoop } from "@alex-ai/runtime";
import { Terminal } from "./tui-terminal.js";
import { CommandPalette } from "./tui-palette.js";
import { Style, TerminalUtils } from "./tui-utils.js";
import { Panes } from "./tui-panes.js";

type Focus = "input" | "terminal" | "palette" | "extensions" | "settings";
const C = Style;

interface ExtensionInfo {
  name: string;
  displayName: string;
  description: string;
}

const EXT_SEARCH_DEBOUNCE_MS = 300;

export class TuiDashboard {
  private ctx: AlexContext;
  private agent: AgentLoop;
  private terminal: Terminal;
  private palette: CommandPalette;
  private outputLines: string[] = [];
  private input = "";
  private focus: Focus = "input";
  private paletteQuery = "";
  private paletteResults: ReturnType<CommandPalette["search"]> = [];
  private paletteIndex = 0;
  private model = "gpt-4o";
  private provider = "opencode";
  /** null = probing, false = no reachable gateway, true = connected */
  private modelReachable: boolean | null = null;
  private step = 0;
  private maxSteps = 50;
  private lastError = "";
  private running = false;
  private extSearchQuery = "";
  private extResults: ExtensionInfo[] = [];
  private extSelectedIndex = 0;
  private extLoading = false;
  private extSearchTimer: ReturnType<typeof setTimeout> | null = null;
  private extSearchSeq = 0;

  constructor(ctx: AlexContext, agent: AgentLoop, cwd: string) {
    this.ctx = ctx;
    this.agent = agent;
    this.terminal = new Terminal(cwd, 8, 40);
    this.palette = new CommandPalette(ctx, {
      clearScreen: () => {
        this.outputLines = [];
        this.lastError = "";
        this.render();
      },
      openExtensions: () => {
        this.openExtensions();
        this.render();
      },
      switchProvider: (id: string) => {
        this.pickProvider(id);
      },
    });
    void this.probeModel();
  }

  /**
   * Non-blocking reachability probe so the status bar can honestly show
   * whether a model is usable. The TUI starts fine either way.
   */
  private async probeModel(): Promise<void> {
    const providerID = this.provider;
    const provider = this.ctx.providers.get(providerID);
    if (!provider) {
      this.modelReachable = false;
      this.render();
      return;
    }
    const opts = (provider as unknown as { options?: { baseURL?: string } }).options;
    const fallbackURL =
      providerID === "omniroute"
        ? process.env.OMNIROUTE_URL ?? "http://localhost:3000"
        : "http://localhost:4000";
    const baseURL = opts?.baseURL ?? fallbackURL;
    try {
      await fetch(new URL("/v1/models", baseURL).toString(), {
        signal: AbortSignal.timeout(2500),
      });
      this.modelReachable = true;
    } catch {
      this.modelReachable = false;
    }
    this.render();
  }

  private onTerminalOutput(_text: string): void {
    if (this.focus === "terminal") {
      this.render();
    }
  }

  start(): void {
    this.terminal.onOutput = (text) => this.onTerminalOutput(text);
    this.terminal.startShell();
    TerminalUtils.clear();
    TerminalUtils.hideCursor();
    TerminalUtils.setRawMode(true);
    process.stdin.resume();
    this.render();
  }

  stop(): void {
    this.terminal.kill();
    TerminalUtils.showCursor();
    TerminalUtils.setRawMode(false);
    TerminalUtils.clear();
    process.stdout.write("Goodbye!\n");
  }

  handleKey(key: string): boolean {
    try {
      if (this.focus === "palette") {
        return this.handlePaletteKey(key);
      }
      if (this.focus === "terminal" && this.handleTerminalKey(key)) {
        return true;
      }
      if (this.focus === "extensions") {
        return this.handleExtensionKey(key);
      }
      return this.handleGlobalKey(key);
    } catch {
      return true;
    }
  }

  private openExtensions(): void {
    this.focus = "extensions";
    this.extSearchQuery = "";
    this.extResults = [];
    this.extSelectedIndex = 0;
    this.extLoading = false;
  }

  private pickProvider(providerId: string): void {
    this.provider = providerId;
    this.modelReachable = null;
    void this.probeModel();
    this.render();
  }

  private handleGlobalKey(key: string): boolean {
    if (key === "\x03" || key === "\x11") {
      return false;
    }
    if (key === "\x0f") {
      this.focus = "settings";
      this.render();
      return true;
    }
    if (key === "\x10") {
      this.focus = "palette";
      this.paletteQuery = "";
      this.paletteResults = this.palette.getAll();
      this.paletteIndex = 0;
      this.render();
      return true;
    }
    if (key === "\x0c") {
      this.outputLines = [];
      this.lastError = "";
      this.render();
      return true;
    }
    if (key === "\x14") {
      this.focus = "terminal";
      this.render();
      return true;
    }
    if (key === "\x05") {
      this.openExtensions();
      this.render();
      return true;
    }
    if (this.focus === "settings") {
      const registered = this.ctx.providers.list().map((p) => p.id);
      const idx = Number.parseInt(key, 10);
      if (Number.isInteger(idx) && idx >= 1 && idx <= registered.length) {
        const target = registered[idx - 1];
        if (target) {
          this.pickProvider(target);
          this.focus = "input";
          return true;
        }
      }
      this.focus = "input";
      this.render();
      return true;
    }
    if (this.focus === "terminal") {
      // handleTerminalKey declined non-edit keys; Esc leaves the pane
      if (key === "\x1b") {
        this.focus = "input";
        this.render();
        return true;
      }
      return true;
    }
    if (this.focus === "input" && key === "\t") {
      this.focus = "terminal";
      this.render();
      return true;
    }
    if (this.focus === "input") {
      return this.handleInputKey(key);
    }
    return true;
  }

  private handleInputKey(key: string): boolean {
    if (key === "\r") {
      const trimmed = this.input.trim();
      if (trimmed) {
        this.submitQuery(trimmed);
      }
      return true;
    }
    if (key === "\x7f") {
      this.input = this.input.slice(0, -1);
      this.render();
      return true;
    }
    if (key === "\x15") {
      this.input = "";
      this.render();
      return true;
    }
    if (key.length === 1) {
      const code = key.codePointAt(0);
      if (code !== undefined && code >= 32 && code !== 127) {
        this.input += key;
        this.render();
      }
      return true;
    }
    return true;
  }

  private handleTerminalKey(key: string): boolean {
    if (key === "\r") {
      const trimmed = this.input.trim();
      if (trimmed) {
        this.input = "";
        this.terminal.writeInput(trimmed);
        this.render();
      }
      return true;
    }
    if (key === "\x7f") {
      this.input = this.input.slice(0, -1);
      this.renderInputLine();
      return true;
    }
    if (key === "\x15") {
      this.input = "";
      this.renderInputLine();
      return true;
    }
    if (key.length === 1) {
      const code = key.codePointAt(0);
      if (code !== undefined && code >= 32 && code !== 127) {
        this.input += key;
        this.renderInputLine();
        return true;
      }
    }
    return false;
  }

  private queueExtensionSearch(): void {
    if (this.extSearchTimer) {
      clearTimeout(this.extSearchTimer);
    }
    const seqAtQueue = ++this.extSearchSeq;
    this.extSearchTimer = setTimeout(() => {
      this.extSearchTimer = null;
      void this.runExtensionSearch(this.extSearchQuery, seqAtQueue);
    }, EXT_SEARCH_DEBOUNCE_MS);
  }

  private async runExtensionSearch(query: string, seq: number): Promise<void> {
    if (!query.trim()) {
      this.extResults = [];
      this.extLoading = false;
      this.render();
      return;
    }
    this.extLoading = true;
    this.render();
    try {
      const result = await this.ctx.callTool("vscode_search_marketplace", { query });
      if (seq !== this.extSearchSeq) return; // stale response
      const text = typeof result === "string" ? result : result.output;
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(text);
      } catch {
      }
      let found: ExtensionInfo[] = [];
      if (Array.isArray(parsed)) {
        found = parsed.map((e) => {
          const ext = e as { id?: string; extensionId?: string; displayName?: string; name?: string; description?: string };
          return {
            name: ext.id ?? ext.extensionId ?? "",
            displayName: ext.displayName ?? ext.extensionId ?? ext.name ?? "",
            description: ext.description ?? "",
          };
        });
      } else if (typeof parsed === "object" && parsed !== null) {
        const arr = (parsed as { extensions?: unknown[] }).extensions;
        if (Array.isArray(arr)) {
          found = arr.map((e) => {
            const ext = e as { extensionId?: string; displayName?: string; description?: string };
            return {
              name: ext.extensionId ?? "",
              displayName: ext.displayName ?? ext.extensionId ?? "",
              description: ext.description ?? "",
            };
          });
        }
      }
      this.extResults = found;
      this.extSelectedIndex = 0;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.outputLines.push(C.red("Extension search error: " + msg));
    } finally {
      if (seq === this.extSearchSeq) {
        this.extLoading = false;
        this.render();
      }
    }
  }

  private handleExtensionKey(key: string): boolean {
    if (key === "\x1b") {
      this.focus = "input";
      this.extSearchQuery = "";
      this.extResults = [];
      if (this.extSearchTimer) {
        clearTimeout(this.extSearchTimer);
        this.extSearchTimer = null;
      }
      this.render();
      return true;
    }
    if (key === "\r") {
      if (this.extLoading) {
        return true;
      }
      const selected = this.extResults[this.extSelectedIndex];
      if (selected) {
        void this.installExtension(selected.name);
      }
      return true;
    }
    if (key === "\x7f") {
      this.extSearchQuery = this.extSearchQuery.slice(0, -1);
      this.queueExtensionSearch();
      this.render();
      return true;
    }
    if (key === "\x02" || key === "\x10") {
      // let ctrl-combos fall through to global handling
      return this.handleGlobalKey(key);
    }
    if (key.length === 1) {
      const code = key.codePointAt(0);
      if (code !== undefined && code >= 32 && code !== 127) {
        this.extSearchQuery += key;
        if (key === " " && !this.extSearchQuery.trim()) {
          this.extSearchQuery = "";
        }
        this.queueExtensionSearch();
        this.render();
        return true;
      }
    }
    return true;
  }

  private async installExtension(extensionId: string): Promise<void> {
    if (!extensionId) {
      this.outputLines.push(C.red("Cannot install: no extension ID"));
      this.render();
      return;
    }
    this.outputLines.push(C.cyan("> Installing extension: ") + C.bold(extensionId));
    this.render();
    try {
      const result = await this.ctx.callTool("vscode_install", { extensionId });
      const text = typeof result === "string" ? result : result.output;
      this.outputLines.push(C.green("✓ ") + text.slice(0, 200));
      this.outputLines.push(C.gray("Installed " + extensionId + " into VS Code"));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.outputLines.push(C.red("Install failed: " + msg));
    }
    this.focus = "input";
    this.extSearchQuery = "";
    this.extResults = [];
    this.render();
  }

  private handlePaletteKey(key: string): boolean {
    if (key === "\x1b") {
      this.focus = "input";
      this.paletteQuery = "";
      this.render();
      return true;
    }
    if (key === "\r") {
      const selected = this.paletteResults[this.paletteIndex];
      this.focus = "input";
      this.paletteQuery = "";
      if (selected?.action) {
        const item = selected;
        const action: () => Promise<string> = selected.action;
        void action().then((result) => {
          this.outputLines.push(C.cyan("> " + item.label) + ":");
          this.outputLines.push(result);
          this.render();
        }).catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          this.outputLines.push(C.red("> " + item.label + " failed: " + msg));
          this.render();
        });
      } else {
        this.render();
      }
      return true;
    }
    if (key === "\x7f") {
      this.paletteQuery = this.paletteQuery.slice(0, -1);
      this.paletteResults = this.palette.search(this.paletteQuery);
      this.paletteIndex = this.clampPaletteIndex();
      this.render();
      return true;
    }
    if (key === "k" || key === "\x1b[A") {
      this.paletteIndex = Math.max(0, this.paletteIndex - 1);
      this.render();
      return true;
    }
    if (key === "j" || key === "\x1b[B") {
      this.paletteIndex = Math.min(Math.max(0, this.paletteResults.length - 1), this.paletteIndex + 1);
      this.render();
      return true;
    }
    if (key.length === 1) {
      const code = key.codePointAt(0);
      if (code !== undefined && code >= 32 && code !== 127) {
        this.paletteQuery += key;
        this.paletteResults = this.palette.search(this.paletteQuery);
        this.paletteIndex = this.clampPaletteIndex();
        this.render();
        return true;
      }
    }
    return true;
  }

  private clampPaletteIndex(): number {
    if (this.paletteResults.length === 0) return 0;
    return Math.min(this.paletteIndex, this.paletteResults.length - 1);
  }

  private renderInputLine(): void {
    const { cols, rows } = TerminalUtils.size;
    if (cols < 40 || rows < 12) {
      TerminalUtils.moveCursor(0, rows - 1);
      const prefix = this.focus === "terminal" ? "$ " : "alex> ";
      process.stdout.write(C.cyan(prefix + this.input.slice(0, cols - 10)));
      return;
    }
    Panes.inputLine(rows - 2, cols, this.input, this.focus === "terminal");
  }

  private async submitQuery(input: string): Promise<void> {
    this.running = true;
    this.step = 0;
    this.input = "";
    this.outputLines = [];
    this.lastError = "";
    this.render();

    const onProgress = (msg: Message) => {
      this.step++;
      if (msg.role === "assistant") {
        if (msg.content) {
          this.outputLines.push(C.cyan("alex: ") + msg.content);
        }
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          for (const call of msg.toolCalls) {
            this.outputLines.push(
              C.yellow("[tool] ") + C.bold(call.name) + C.gray(" " + JSON.stringify(call.arguments))
            );
          }
        }
      } else if (msg.role === "tool") {
        const preview = (msg.content ?? "").slice(0, 100);
        this.outputLines.push(C.gray("[result] ") + preview);
      }
      this.render();
    };

    const onChunk = (delta: { content?: string; reasoning?: string; toolCall?: ToolCall }) => {
      if (delta.content) {
        this.outputLines.push(delta.content);
      }
      this.render();
    };

    try {
      await this.agent.run(input, onProgress, {
        stream: true,
        timeout: 120000,
        provider: this.provider,
        model: this.model,
        onChunk,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.lastError = msg;
      const hint =
        msg.includes("fetch failed") || msg.includes("not registered")
          ? C.gray(" — no model reachable. Point OMNIROUTE_URL at an OpenAI-compatible gateway (Ctrl+O to pick a provider).")
          : "";
      this.outputLines.push(C.red("Error: " + msg) + hint);
    } finally {
      this.running = false;
      this.render();
    }
  }

  render(): void {
    const { cols, rows } = TerminalUtils.size;
    if (cols < 40 || rows < 12) {
      this.renderCompact();
      return;
    }

    TerminalUtils.clear();
    process.stdout.write("\x1b[H");

    const toolPanelWidth = Math.min(Math.max(24, Math.floor(cols * 0.28)), 40);
    const mainX = toolPanelWidth + 1;
    const mainWidth = cols - mainX - 1;
    const totalPanel = rows - 2; // rows 0..rows-3; rows-2 input, rows-1 status
    const terminalHeight = Math.min(Math.max(4, Math.floor(rows * 0.25)), totalPanel - 8);
    const mainPanelHeight = totalPanel - terminalHeight + 1;

    Panes.bordered(0, 0, toolPanelWidth, mainPanelHeight,
      this.focus === "extensions" ? "EXTENSIONS" : "TOOLS",
      this.focus === "extensions" ? "magenta" : "cyan");
    Panes.bordered(mainX, 0, mainWidth, mainPanelHeight, "AGENT OUTPUT", "blue");
    Panes.bordered(0, mainPanelHeight - 1, cols, terminalHeight + 1, "TERMINAL", "yellow");

    if (this.focus === "extensions") {
      Panes.extensions(1, 1, toolPanelWidth - 2, mainPanelHeight - 2,
        this.extSearchQuery, this.extResults, this.extSelectedIndex, this.extLoading);
    } else {
      Panes.tools(1, 1, toolPanelWidth - 2, mainPanelHeight - 2, this.ctx.listTools());
    }
    Panes.output(mainX + 1, 1, mainWidth - 2, mainPanelHeight - 3, this.outputLines);
    Panes.terminal(1, mainPanelHeight, cols - 2, terminalHeight - 2, this.terminal);

    if (this.focus === "palette") {
      Panes.paletteOverlay(cols, rows, {
        query: this.paletteQuery,
        results: this.paletteResults,
        index: this.paletteIndex,
      });
    }
    if (this.focus === "settings") {
      Panes.settingsOverlay(cols, rows, {
        provider: this.provider,
        providers: this.ctx.providers.list().map((p) => p.id),
        reachable: this.modelReachable,
      });
    }

    Panes.inputLine(rows - 2, cols, this.input, this.focus === "terminal");
    Panes.statusBar(rows - 1, cols, {
      model: this.model,
      reachable: this.modelReachable,
      step: this.step,
      maxSteps: this.maxSteps,
      running: this.running,
      focus: this.focus,
    });
  }

  private renderCompact(): void {
    const { cols, rows } = TerminalUtils.size;
    TerminalUtils.clear();
    const lines = this.outputLines.slice(-rows + 3);
    for (let i = 0; i < lines.length; i++) {
      TerminalUtils.moveCursor(0, i);
      process.stdout.write((lines[i] ?? "").slice(0, cols - 1));
    }
    TerminalUtils.moveCursor(0, rows - 2);
    const prefix = this.focus === "terminal" ? "$ " : "alex> ";
    process.stdout.write(C.cyan(prefix + this.input.slice(0, cols - 10)));
    TerminalUtils.moveCursor(0, rows - 1);
    const status =
      (this.modelReachable === false ? C.yellow(this.model + " · no model") : C.green(this.model)) +
      (this.running ? C.red(" · running") : "");
    process.stdout.write(status.slice(0, cols - 1));
  }
}
