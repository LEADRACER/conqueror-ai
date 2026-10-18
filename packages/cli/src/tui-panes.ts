import { Style, TerminalUtils, type Color } from "./tui-utils.js";
import type { Terminal } from "./tui-terminal.js";
import type { CommandPaletteItem } from "./tui-palette.js";

const C = Style;

export interface ToolTag {
  name: string;
}

export interface StatusBarState {
  model: string;
  /** null = probing, false = no reachable gateway, true = connected */
  reachable: boolean | null;
  step: number;
  maxSteps: number;
  running: boolean;
  focus: string;
}

export interface ExtensionRow {
  name: string;
  displayName: string;
  description: string;
}

export interface PaletteOverlayState {
  query: string;
  results: CommandPaletteItem[];
  index: number;
}

export interface SettingsOverlayState {
  /** registered provider ids, in registry order */
  providers: string[];
  provider: string;
  reachable: boolean | null;
}

function plain(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

/** Pure drawing primitives + pane renderers for the TUI. No key handling state. */
export const Panes = {
  bordered(
    x: number,
    y: number,
    width: number,
    height: number,
    title: string,
    color: Color
  ): void {
    const colorCode = C.code(color);
    const resetCode = C.code("reset");
    const titleStr = " " + title + " ";

    let top = colorCode;
    for (let i = 0; i < width; i++) {
      if (i === 0) top += "+";
      else if (i === 1) {
        top += titleStr;
        i += titleStr.length - 1;
      } else if (i === width - 1) top += "+";
      else top += "-";
    }
    TerminalUtils.moveCursor(x, y);
    process.stdout.write(top + resetCode);

    for (let row = 1; row < height - 1; row++) {
      TerminalUtils.moveCursor(x, y + row);
      process.stdout.write(colorCode + "|" + resetCode + " ".repeat(width - 2) + colorCode + "|" + resetCode);
    }

    TerminalUtils.moveCursor(x, y + height - 1);
    process.stdout.write(colorCode + "+" + "-".repeat(width - 2) + "+" + resetCode);
  },

  tools(x: number, y: number, width: number, height: number, tools: ToolTag[]): void {
    const items: string[] = [];
    items.push(C.cyan("Ctrl+E  extensions"));
    items.push(C.cyan("Ctrl+P  palette"));
    items.push(C.cyan("Ctrl+T  terminal"));
    items.push(C.cyan("Ctrl+O  settings"));
    items.push("");
    for (const t of tools) {
      const icon = t.name.startsWith("vscode") ? C.magenta("[VSC]") :
        t.name.startsWith("subagent") ? C.cyan("[SUB]") :
        t.name.startsWith("opencode") ? C.green("[OC]") :
        t.name.startsWith("mcp") ? C.yellow("[MCP]") :
        t.name.startsWith("http") ? C.blue("[API]") :
        t.name.startsWith("web") ? C.magenta("[WEB]") :
        t.name.startsWith("memory") ? C.yellow("[MEM]") :
        t.name.startsWith("browser") ? C.blue("[BRW]") : "     ";
      items.push(icon + " " + C.bold(t.name));
    }
    for (let i = 0; i < height; i++) {
      TerminalUtils.moveCursor(x, y + i);
      process.stdout.write((items[i] ?? "").slice(0, width).padEnd(width));
    }
  },

  extensions(x: number, y: number, width: number, height: number, query: string, results: ExtensionRow[], selected: number, loading: boolean): void {
    TerminalUtils.moveCursor(x, y);
    const searchBox = C.cyan("Search: ") + (loading ? C.gray("searching…") : C.gray(query || "type a name, Enter to install"));
    process.stdout.write(searchBox.slice(0, width).padEnd(width));

    const rows = Math.floor((height - 1) / 2);
    const visible = results.slice(0, rows);
    for (let i = 0; i < rows + 1; i++) {
      TerminalUtils.moveCursor(x, y + 1 + i);
      process.stdout.write(" ".repeat(width));
    }
    for (let i = 0; i < visible.length; i++) {
      const ext = visible[i]!;
      const rowY = y + 1 + i * 2;
      const prefix = i === selected ? C.green("▶ ") : "  ";
      TerminalUtils.moveCursor(x, rowY);
      process.stdout.write((prefix + C.bold(ext.displayName || ext.name || "?")).slice(0, width).padEnd(width));
      TerminalUtils.moveCursor(x, rowY + 1);
      process.stdout.write(("  " + C.gray((ext.description || ext.name || "").slice(0, width - 4))).slice(0, width).padEnd(width));
    }
  },

  output(x: number, y: number, width: number, height: number, lines: string[]): void {
    const visible = lines.slice(-height);
    for (let i = 0; i < height; i++) {
      TerminalUtils.moveCursor(x, y + i);
      process.stdout.write((visible[i] ?? "").slice(0, width).padEnd(width));
    }
  },

  terminal(x: number, y: number, width: number, height: number, terminal: Terminal): void {
    const lines = terminal.getLines();
    const visible = lines.slice(-height);
    for (let i = 0; i < height; i++) {
      TerminalUtils.moveCursor(x, y + i);
      process.stdout.write(C.gray((visible[i] ?? "").slice(0, width).padEnd(width)));
    }
  },

  inputLine(y: number, cols: number, input: string, terminalFocus: boolean): void {
    TerminalUtils.moveCursor(0, y);
    const prefix = terminalFocus ? C.gray("$ ") : C.cyan("alex> ");
    const used = plain(prefix).length + input.length;
    process.stdout.write(prefix + C.cyan(input) + " ".repeat(Math.max(1, cols - used - 2)));
  },

  statusBar(y: number, cols: number, s: StatusBarState): void {
    TerminalUtils.moveCursor(0, y);
    const model =
      s.reachable === true
        ? C.green(s.model)
        : s.reachable === false
          ? C.yellow(s.model + C.dim(" · no model"))
          : C.green(s.model);
    const step = C.yellow("step " + s.step + "/" + s.maxSteps);
    const running = s.running ? C.red("running") : C.green("idle");
    const mode = s.focus === "extensions" ? C.cyan(" [ext]") :
      s.focus === "palette" ? C.cyan(" [cmd]") :
      s.focus === "terminal" ? C.yellow(" [term]") :
      s.focus === "settings" ? C.blue(" [settings]") : "";
    const plainLen = plain(model + step + running + mode).length + 6;
    process.stdout.write(
      "│ " + model + " │ " + step + " │ " + running + mode +
      " ".repeat(Math.max(1, cols - plainLen)) + "│"
    );
  },

  paletteOverlay(width: number, height: number, o: PaletteOverlayState): void {
    const paletteWidth = Math.min(width - 4, 62);
    const paletteHeight = Math.min(15, height - 6);
    const paletteX = Math.floor((width - paletteWidth) / 2);
    const paletteY = Math.floor((height - paletteHeight) / 2);

    TerminalUtils.moveCursor(paletteX, paletteY);
    process.stdout.write("+" + "-".repeat(paletteWidth - 2) + "+");

    TerminalUtils.moveCursor(paletteX, paletteY + 1);
    const plainTitle = "| Command Palette   filter: " + o.query;
    process.stdout.write(
      C.dim("| ") + C.bold("Command Palette") + C.dim("   filter: ") + C.cyan(o.query) +
      " ".repeat(Math.max(1, paletteWidth - 2 - plainTitle.length)) + C.dim("|")
    );

    const slots = Math.max(1, paletteHeight - 4);
    const results = o.results.slice(0, slots);
    for (let i = 0; i < results.length; i++) {
      TerminalUtils.moveCursor(paletteX, paletteY + 3 + i);
      const item = results[i]!;
      const prefix = i === o.index ? C.green("> ") : "  ";
      const plainItem = (i === o.index ? "> " : "  ") + item.label + " [" + item.category + "]";
      process.stdout.write(
        C.dim("|") + prefix + C.bold(item.label) + " " + C.gray("[" + item.category + "]") +
        " ".repeat(Math.max(1, paletteWidth - 2 - plainItem.length)) + C.dim("|")
      );
    }
    for (let i = results.length; i < slots; i++) {
      TerminalUtils.moveCursor(paletteX, paletteY + 3 + i);
      process.stdout.write(C.dim("|" + " ".repeat(paletteWidth - 2) + "|"));
    }

    TerminalUtils.moveCursor(paletteX, paletteY + paletteHeight - 1);
    process.stdout.write("+" + "-".repeat(paletteWidth - 2) + "+");
    TerminalUtils.moveCursor(paletteX + 1, paletteY + paletteHeight);
    process.stdout.write(C.gray("Enter run · j/k select · Esc close"));
  },

  settingsOverlay(width: number, height: number, s: SettingsOverlayState): void {
    const w = Math.min(width - 6, 66);
    const x = Math.floor((width - w) / 2);
    const y = Math.max(1, Math.floor((height - 8) / 2));
    const conn =
      s.reachable === true ? C.green("● connected") :
      s.reachable === false ? C.yellow("○ no model reachable") :
      C.gray("◌ probing…");
    const lines = [
      C.bold("Settings — provider: " + s.provider) + "  " + conn,
      "",
      ...s.providers.map((p, i) =>
        "  " + C.cyan(String(i + 1)) + ") " + p +
        (p === "opencode" ? "   (built-in gateway)" : p === "omniroute" && process.env.OMNIROUTE_URL ? "   (" + process.env.OMNIROUTE_URL + ")" : "")
      ),
      "",
      C.gray("1..9 pick + re-probe · Esc close"),
    ];
    TerminalUtils.moveCursor(x, y);
    process.stdout.write("+" + "-".repeat(w - 2) + "+");
    for (let i = 0; i < lines.length; i++) {
      TerminalUtils.moveCursor(x, y + 1 + i);
      const l = lines[i] ?? "";
      process.stdout.write(
        C.dim("|") + l + " ".repeat(Math.max(0, w - 3 - plain(l).length + 1)) + C.dim("|")
      );
    }
    TerminalUtils.moveCursor(x, y + lines.length + 1);
    process.stdout.write("+" + "-".repeat(w - 2) + "+");
  },
};
