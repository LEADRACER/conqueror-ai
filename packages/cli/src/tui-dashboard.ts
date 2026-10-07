import type { AlexContext, Message, ToolCall } from "@alex-ai/core";
import { AgentLoop } from "@alex-ai/runtime";
import { Terminal } from "./tui-terminal.js";
import { CommandPalette } from "./tui-palette.js";
import { Style, TerminalUtils } from "./tui-utils.js";

type Focus = "input" | "terminal" | "palette" | "extensions";
const C = Style;

interface ExtensionInfo {
  name: string;
  displayName: string;
  description: string;
}

export class TuiDashboard {
  private ctx: AlexContext;
  private agent: AgentLoop;
  private terminal: Terminal;
  private palette: CommandPalette;
  private outputLines: string[] = [];
  private toolCalls: { name: string; args: Record<string, unknown> }[] = [];
  private input = "";
  private focus: Focus = "input";
  private paletteQuery = "";
  private paletteResults: ReturnType<CommandPalette["search"]> = [];
  private paletteIndex = 0;
  private model = "gpt-4o";
  private provider = "omniroute";
  private step = 0;
  private maxSteps = 50;
  private status = "Ready";
  private running = false;
  private history: string[] = [];
  private lastError = "";
  private extSearchQuery = "";
  private extResults: ExtensionInfo[] = [];
  private extSelectedIndex = 0;
  private extLoading = false;

  constructor(ctx: AlexContext, agent: AgentLoop, cwd: string) {
    this.ctx = ctx;
    this.agent = agent;
    this.terminal = new Terminal(cwd, 8, 40, (text) => { this.onTerminalOutput(text); });
    this.palette = new CommandPalette(ctx);
  }

  private onTerminalOutput(_text: string): void {
    if (this.focus === "terminal") {
      this.render();
    }
  }

  start(): void {
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
  }

  private handleGlobalKey(key: string): boolean {
    if (key === "\x03" || key === "\x11") {
      return false;
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
      this.toolCalls = [];
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
      this.focus = "extensions";
      this.extSearchQuery = "";
      this.extResults = [];
      this.extSelectedIndex = 0;
      this.extLoading = false;
      this.render();
      return true;
    }
    if (this.focus === "input" && key === "\t") {
      const order: Focus[] = ["input", "terminal"];
      const orderIdx = order.indexOf(this.focus);
      const nextFocus = order[(orderIdx + 1) % order.length];
      if (nextFocus) {
        this.focus = nextFocus;
      }
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
        this.history.push(trimmed);
        this.submitQuery(trimmed);
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
    if (key.length === 1 && key >= " " && key <= "~") {
      this.input += key;
      this.renderInputLine();
      return true;
    }
    return true;
  }

  private async searchExtensions(query: string): Promise<void> {
    if (!query.trim()) {
      this.extResults = [];
      return;
    }
    this.extLoading = true;
    this.render();
    try {
      const result = await this.ctx.callTool("vscode_search_marketplace", { query });
      const text = typeof result === "string" ? result : result.output;
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(text);
      } catch {
      }
      if (Array.isArray(parsed)) {
        this.extResults = parsed.map((e) => ({
          name: (e as { id?: string }).id ?? (e as { extensionId?: string }).extensionId ?? "",
          displayName: (e as { displayName?: string }).displayName ??
            (e as { extensionId?: string }).extensionId ??
            (e as { name?: string }).name ?? "",
          description: (e as { description?: string }).description ?? "",
        }));
      } else if (typeof parsed === "object" && parsed !== null) {
        const arr = (parsed as { extensions?: unknown[] }).extensions;
        if (arr) {
          this.extResults = arr.map((e) => {
            const ext = e as { extensionId?: string; displayName?: string; description?: string };
            return {
              name: ext.extensionId ?? "",
              displayName: ext.displayName ?? ext.extensionId ?? "",
              description: ext.description ?? "",
            };
          });
        }
      }
      this.extSelectedIndex = 0;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.outputLines.push(C.red("Extension search error: " + msg));
    } finally {
      this.extLoading = false;
      this.render();
    }
  }

  private handleExtensionKey(key: string): boolean {
    if (key === "\x1b") {
      this.focus = "input";
      this.extSearchQuery = "";
      this.render();
      return true;
    }
    if (key === "\r") {
      if (this.extLoading) {
        return true;
      }
      const selected = this.extResults[this.extSelectedIndex];
      if (selected) {
        this.installExtension(selected.name);
      }
      return true;
    }
    if (key === " ") {
      this.focus = "input";
      this.extSearchQuery = "";
      this.extResults = [];
      this.render();
      return true;
    }
    if (key === "k") {
      this.extSelectedIndex = Math.max(0, this.extSelectedIndex - 1);
      this.render();
      return true;
    }
    if (key === "j") {
      this.extSelectedIndex = Math.min(this.extResults.length - 1, this.extSelectedIndex + 1);
      this.render();
      return true;
    }
    if (key === "\x7f") {
      this.extSearchQuery = this.extSearchQuery.slice(0, -1);
      this.searchExtensions(this.extSearchQuery);
      return true;
    }
    if (key === "\r" === false && key.length === 1 && key >= " " && key <= "~") {
      this.extSearchQuery += key;
      this.searchExtensions(this.extSearchQuery);
      return true;
    }
    return true;
  }

  private async installExtension(extensionId: string): Promise<void> {
    if (!extensionId) {
      this.outputLines.push(C.red("Cannot install: no extension ID"));
      return;
    }
    this.outputLines.push(C.cyan("> Installing extension: ") + C.bold(extensionId));
    this.render();
    try {
      const result = await this.ctx.callTool("vscode_install", { extensionId });
      const text = typeof result === "string" ? result : result.output;
      this.outputLines.push(C.green("✓ ") + text.slice(0, 200));
      this.outputLines.push(C.gray(`Installed ${extensionId} into VS Code`));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.outputLines.push(C.red("Install failed: " + msg));
    }
    this.focus = "input";
    this.extSearchQuery = "";
    this.extResults = [];
    this.render();
  }

  private handleTerminalKey(key: string): boolean {
    if (key === "\r") {
      const trimmed = this.input.trim();
      if (trimmed) {
        this.terminal.writeInput(trimmed);
        this.input = "";
        this.render();
      }
      return true;
    }
    if (key === "\x7f") {
      this.input = this.input.slice(0, -1);
      this.renderTerminalInput();
      return true;
    }
    if (key === "\x15") {
      this.input = "";
      this.renderTerminalInput();
      return true;
    }
    if (key.length === 1 && key >= " " && key <= "~") {
      this.input += key;
      this.renderTerminalInput();
      return true;
    }
    return false;
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
      if (selected && selected.action) {
        selected.action().then((result) => {
          this.outputLines.push(C.cyan("> " + selected.label) + ":");
          this.outputLines.push(result);
          this.paletteQuery = "";
          this.focus = "input";
          this.render();
        });
      }
      this.focus = "input";
      this.paletteQuery = "";
      this.render();
      return true;
    }
    if (key === "\x7f") {
      this.paletteQuery = this.paletteQuery.slice(0, -1);
      this.paletteResults = this.palette.search(this.paletteQuery);
      this.paletteIndex = 0;
      this.render();
      return true;
    }
    if (key === "k") {
      this.paletteIndex = Math.max(0, this.paletteIndex - 1);
      this.render();
      return true;
    }
    if (key === "j") {
      this.paletteIndex = Math.min(this.paletteResults.length - 1, this.paletteIndex + 1);
      this.render();
      return true;
    }
    if (key.length === 1 && key >= " " && key <= "~") {
      this.paletteQuery += key;
      this.paletteResults = this.palette.search(this.paletteQuery);
      this.paletteIndex = 0;
      this.render();
      return true;
    }
    return true;
  }

  private renderInputLine(): void {
    const { cols } = TerminalUtils.size;
    const inputWidth = Math.max(1, cols - 15);
    TerminalUtils.moveCursor(0, TerminalUtils.size.rows - 2);
    const display = this.input;
    process.stdout.write(C.cyan("alex> ") + C.cyan(display));
    const used = 6 + display.length;
    process.stdout.write(" ".repeat(Math.max(0, cols - used)));
  }

  private renderTerminalInput(): void {
    const { cols, rows } = TerminalUtils.size;
    TerminalUtils.moveCursor(0, rows - 2);
    const display = this.input;
    process.stdout.write(C.gray("$ ") + C.cyan(display));
    const used = 2 + display.length;
    process.stdout.write(" ".repeat(Math.max(0, cols - used)));
  }

  private async submitQuery(input: string): Promise<void> {
    this.running = true;
    this.step = 0;
    this.status = "Processing...";
    this.input = "";
    this.outputLines = [];
    this.toolCalls = [];
    this.render();

    const onProgress = (msg: Message) => {
      this.step++;
      if (msg.role === "assistant") {
        if (msg.content) {
          this.outputLines.push(C.cyan("alex: ") + msg.content);
        }
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          for (const call of msg.toolCalls) {
            this.toolCalls.push({ name: call.name, args: call.arguments });
            this.outputLines.push(
              C.yellow("[tool] ") + C.bold(call.name) + C.gray(" " + JSON.stringify(call.arguments))
            );
          }
        }
      } else if (msg.role === "tool") {
        const preview = (msg.content ?? "").slice(0, 100);
        this.outputLines.push(C.gray("[result] ") + preview);
      }
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
        onChunk,
      });
      this.status = "Complete";
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.lastError = msg;
      this.status = "Error";
      this.outputLines.push(C.red("Error: " + msg));
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

    const toolPanelWidth = Math.floor(cols * 0.28);
    const mainWidth = cols - toolPanelWidth - 2;
    const toolPanelX = 0;
    const mainX = toolPanelWidth + 1;
    const panelTop = 1;
    const panelHeight = rows - 4;
    const terminalHeight = Math.max(4, Math.floor(rows * 0.25));
    const mainPanelHeight = panelHeight - terminalHeight;
    const statusY = rows - 1;

    process.stdout.write("\x1b[H");

    this.drawBorder(toolPanelX, panelTop, toolPanelWidth, mainPanelHeight, "TOOLS", "cyan");
    this.drawBorder(mainX, panelTop, mainWidth, mainPanelHeight, "AGENT OUTPUT", "blue");
    this.drawBorder(0, panelTop + mainPanelHeight, cols, terminalHeight, "TERMINAL", "yellow");

    if (this.focus === "extensions") {
      this.renderExtensionsPanel(toolPanelX + 1, panelTop + 1, toolPanelWidth - 2, mainPanelHeight - 2);
    } else {
      this.renderToolsPanel(toolPanelX + 1, panelTop + 1, toolPanelWidth - 2, mainPanelHeight - 2);
    }
    this.renderOutputPanel(mainX + 1, panelTop + 1, mainWidth - 2, mainPanelHeight - 2);
    this.renderTerminal(1, panelTop + mainPanelHeight + 1, cols - 2, terminalHeight - 2);
    this.renderStatus(statusY, cols);

    if (this.focus === "palette") {
      this.renderPalette();
    }

    TerminalUtils.moveCursor(0, statusY);
    process.stdout.write(C.dim("│"));
    process.stdout.write(C.cyan(" alex> "));
    const display = this.input;
    process.stdout.write(C.cyan(display));
    const used = 8 + display.length;
    process.stdout.write(" ".repeat(Math.max(0, cols - used - 1)));
    process.stdout.write(C.dim("│"));
  }

  private renderCompact(): void {
    const { cols, rows } = TerminalUtils.size;
    TerminalUtils.clear();
    this.renderStatus(rows - 2, cols);
    const lines = this.outputLines.slice(-rows + 3);
    for (let i = 0; i < lines.length; i++) {
      TerminalUtils.moveCursor(0, i);
      process.stdout.write((lines[i] ?? "").slice(0, cols - 1));
    }
    TerminalUtils.moveCursor(0, rows - 1);
    process.stdout.write(C.cyan("alex> ") + this.input.slice(0, cols - 10));
  }

  private drawBorder(
    x: number,
    y: number,
    width: number,
    height: number,
    title: string,
    color: "cyan" | "blue" | "yellow" | "green" | "red" | "magenta"
  ): void {
    const colorCode = C.code(color);
    const resetCode = C.code("reset");
    const chars = { topLeft: "+", topRight: "+", botLeft: "+", botRight: "+", midLeft: "|", midRight: "|" };
    const titleStr = " " + title + " ";

    TerminalUtils.moveCursor(x, y);
    let line = colorCode;
    for (let i = 0; i < width; i++) {
      if (i === 1) {
        line += titleStr;
        i += titleStr.length - 1;
      } else if (i === 0) {
        line += chars.topLeft;
      } else if (i === width - 1) {
        line += chars.topRight;
      } else {
        line += "-";
      }
    }
    process.stdout.write(line + resetCode + "\n");

    for (let row = 1; row < height - 1; row++) {
      TerminalUtils.moveCursor(x, y + row);
      process.stdout.write(colorCode + chars.midLeft + resetCode + " ".repeat(width - 2) + colorCode + chars.midRight + resetCode + "\n");
    }

    TerminalUtils.moveCursor(x, y + height - 1);
    let botLine = colorCode;
    for (let i = 0; i < width; i++) {
      if (i === 0) {
        botLine += chars.botLeft;
      } else if (i === width - 1) {
        botLine += chars.botRight;
      } else {
        botLine += "-";
      }
    }
    process.stdout.write(botLine + resetCode + "\n");
  }

  private renderToolsPanel(x: number, y: number, width: number, height: number): void {
    const tools = this.ctx.listTools();
    let items: string[] = [];

    items.push(C.cyan("◆ [EXT] VS Code Extensions") + C.gray(" (Ctrl+E)"));
    items.push("");

    items.push(...tools.map((t) => {
      const icon = t.name.startsWith("vscode") ? C.magenta("[VSC]") :
        t.name.startsWith("subagent") ? C.cyan("[SUB]") :
        t.name.startsWith("opencode") ? C.green("[OC]") :
        t.name.startsWith("mcp") ? C.yellow("[MCP]") :
        t.name.startsWith("http") ? C.blue("[API]") :
        t.name.startsWith("web") ? C.magenta("[WEB]") :
        t.name.startsWith("browser") ? C.blue("[BRW]") :
        t.name.startsWith("memory") ? C.yellow("[MEM]") : "     ";
      return icon + " " + C.bold(t.name);
    }));

    const visible = items.slice(0, height);
    for (let i = 0; i < visible.length && i < height; i++) {
      TerminalUtils.moveCursor(x, y + i);
      process.stdout.write((visible[i] ?? "").slice(0, width).padEnd(width));
    }
  }

  private renderExtensionsPanel(x: number, y: number, width: number, height: number): void {
    const searchHeight = 1;
    const listHeight = height - searchHeight;
    const results = this.extResults.slice(0, listHeight - 2);

    TerminalUtils.moveCursor(x, y);
    const searchBox = C.cyan("🔍 ") + C.bold("Search:") + " " + C.gray(this.extSearchQuery || "type extension name...");
    process.stdout.write(searchBox.slice(0, width).padEnd(width));

    for (let i = 0; i < results.length && i < listHeight - 2; i++) {
      TerminalUtils.moveCursor(x, y + searchHeight + i);
      const ext = results[i]!;
      const prefix = i === this.extSelectedIndex ? C.green("▶ ") : "  ";
      const name = C.bold(ext.displayName || ext.name);
      const desc = C.gray((ext.description || "").slice(0, width - 20));
      const line = prefix + name + "\n" + " ".repeat(prefix.length) + desc;
      const lines = line.split("\n");
      for (let j = 0; j < lines.length && j < 2; j++) {
        if (y + searchHeight + i + j < y + height) {
          TerminalUtils.moveCursor(x, y + searchHeight + i + j);
          process.stdout.write((lines[j] ?? "").slice(0, width).padEnd(width));
        }
      }
    }

    for (let i = results.length + searchHeight; i < height; i++) {
      TerminalUtils.moveCursor(x, y + i);
      process.stdout.write(" ".repeat(width));
    }
  }

  private renderOutputPanel(x: number, y: number, width: number, height: number): void {
    const lines = this.outputLines.slice(-height);
    for (let i = 0; i < height; i++) {
      TerminalUtils.moveCursor(x, y + i);
      const line = lines[i] ?? "";
      process.stdout.write(line.slice(0, width).padEnd(width));
    }
  }

  private renderTerminal(x: number, y: number, width: number, height: number): void {
    const lines = this.terminal.getLines();
    const visible = lines.slice(-height);
    for (let i = 0; i < height; i++) {
      TerminalUtils.moveCursor(x, y + i);
      const line = visible[i] ?? "";
      process.stdout.write(C.gray(line.slice(0, width).padEnd(width)));
    }
  }

  private renderStatus(y: number, cols: number): void {
    TerminalUtils.moveCursor(0, y);
    const status = C.dim("|");
    const model = C.green(this.model);
    const provider = C.magenta(this.provider);
    const step = C.yellow("step " + this.step + "/" + this.maxSteps);
    const running = this.running ? C.red("running") : C.green("idle");
    let mode = "";
    if (this.focus === "extensions") {
      mode = C.cyan(" [ext] ");
    } else if (this.focus === "palette") {
      mode = C.cyan(" [cmd] ");
    } else if (this.focus === "terminal") {
      mode = C.yellow(" [term] ");
    }
    const statusText = provider + " " + model + " | " + step + " | " + running + mode;
    process.stdout.write(
      status + " " + statusText + " ".repeat(Math.max(0, cols - statusText.length - 5)) + C.dim("|")
    );
  }

  private renderPalette(): void {
    const { cols, rows } = TerminalUtils.size;
    const paletteWidth = Math.min(cols - 4, 60);
    const paletteHeight = Math.min(15, rows - 6);
    const paletteX = Math.floor((cols - paletteWidth) / 2);
    const paletteY = Math.floor((rows - paletteHeight) / 2);

    TerminalUtils.moveCursor(paletteX, paletteY);
    process.stdout.write(C.dim("+" + "-".repeat(paletteWidth - 2) + "+\n"));

    TerminalUtils.moveCursor(paletteX, paletteY + 1);
    const queryLine = C.dim("| ") + C.bold(" Command Palette") + C.dim(" -- filter: ") + C.cyan(this.paletteQuery);
    process.stdout.write(queryLine);
    process.stdout.write(" ".repeat(Math.max(1, paletteWidth - 2 - queryLine.length - 3)) + C.dim("|\n"));

    const results = this.paletteResults.slice(0, paletteHeight - 3);
    for (let i = 0; i < results.length; i++) {
      TerminalUtils.moveCursor(paletteX, paletteY + 3 + i);
      const item = results[i]!;
      const prefix = i === this.paletteIndex ? C.green("> ") : "  ";
      const label = C.bold(item.label);
      const category = C.gray("[" + item.category + "]");
      process.stdout.write(C.dim("|") + prefix + label + " " + category);
      process.stdout.write(" ".repeat(Math.max(1, paletteWidth - 2 - prefix.length - label.length - category.length - 3)) + C.dim("|\n"));
    }

    for (let i = results.length; i < paletteHeight - 3; i++) {
      TerminalUtils.moveCursor(paletteX, paletteY + 3 + i);
      process.stdout.write(C.dim("|" + " ".repeat(paletteWidth - 2) + "|\n"));
    }

    TerminalUtils.moveCursor(paletteX, paletteY + paletteHeight - 1);
    process.stdout.write(C.dim("+" + "-".repeat(paletteWidth - 2) + "+"));
  }
}
