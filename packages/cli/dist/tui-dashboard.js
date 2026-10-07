import { Terminal } from "./tui-terminal.js";
import { CommandPalette } from "./tui-palette.js";
import { Style, TerminalUtils } from "./tui-utils.js";
const C = Style;
export class TuiDashboard {
    ctx;
    agent;
    terminal;
    palette;
    outputLines = [];
    toolCalls = [];
    input = "";
    focus = "input";
    paletteQuery = "";
    paletteResults = [];
    paletteIndex = 0;
    model = "gpt-4o";
    provider = "omniroute";
    step = 0;
    maxSteps = 50;
    status = "Ready";
    running = false;
    history = [];
    lastError = "";
    constructor(ctx, agent, cwd) {
        this.ctx = ctx;
        this.agent = agent;
        this.terminal = new Terminal(cwd, 8, 40, (text) => { this.onTerminalOutput(text); });
        this.palette = new CommandPalette(ctx);
    }
    onTerminalOutput(_text) {
        if (this.focus === "terminal") {
            this.render();
        }
    }
    start() {
        this.terminal.startShell();
        TerminalUtils.clear();
        TerminalUtils.hideCursor();
        TerminalUtils.setRawMode(true);
        process.stdin.resume();
        this.render();
    }
    stop() {
        this.terminal.kill();
        TerminalUtils.showCursor();
        TerminalUtils.setRawMode(false);
        TerminalUtils.clear();
        process.stdout.write("Goodbye!\n");
    }
    handleKey(key) {
        if (this.focus === "palette") {
            return this.handlePaletteKey(key);
        }
        if (this.focus === "terminal" && this.handleTerminalKey(key)) {
            return true;
        }
        return this.handleGlobalKey(key);
    }
    handleGlobalKey(key) {
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
        if (this.focus === "input" && key === "\t") {
            const order = ["input", "terminal"];
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
    handleInputKey(key) {
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
    handleTerminalKey(key) {
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
    handlePaletteKey(key) {
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
    renderInputLine() {
        const { cols } = TerminalUtils.size;
        const inputWidth = Math.max(1, cols - 15);
        TerminalUtils.moveCursor(0, TerminalUtils.size.rows - 2);
        const display = this.input;
        process.stdout.write(C.cyan("alex> ") + C.cyan(display));
        const used = 6 + display.length;
        process.stdout.write(" ".repeat(Math.max(0, cols - used)));
    }
    renderTerminalInput() {
        const { cols, rows } = TerminalUtils.size;
        TerminalUtils.moveCursor(0, rows - 2);
        const display = this.input;
        process.stdout.write(C.gray("$ ") + C.cyan(display));
        const used = 2 + display.length;
        process.stdout.write(" ".repeat(Math.max(0, cols - used)));
    }
    async submitQuery(input) {
        this.running = true;
        this.step = 0;
        this.status = "Processing...";
        this.input = "";
        this.outputLines = [];
        this.toolCalls = [];
        this.render();
        const onProgress = (msg) => {
            this.step++;
            if (msg.role === "assistant") {
                if (msg.content) {
                    this.outputLines.push(C.cyan("alex: ") + msg.content);
                }
                if (msg.toolCalls && msg.toolCalls.length > 0) {
                    for (const call of msg.toolCalls) {
                        this.toolCalls.push({ name: call.name, args: call.arguments });
                        this.outputLines.push(C.yellow("[tool] ") + C.bold(call.name) + C.gray(" " + JSON.stringify(call.arguments)));
                    }
                }
            }
            else if (msg.role === "tool") {
                const preview = (msg.content ?? "").slice(0, 100);
                this.outputLines.push(C.gray("[result] ") + preview);
            }
        };
        const onChunk = (delta) => {
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
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this.lastError = msg;
            this.status = "Error";
            this.outputLines.push(C.red("Error: " + msg));
        }
        finally {
            this.running = false;
            this.render();
        }
    }
    render() {
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
        this.renderToolsPanel(toolPanelX + 1, panelTop + 1, toolPanelWidth - 2, mainPanelHeight - 2);
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
    renderCompact() {
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
    drawBorder(x, y, width, height, title, color) {
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
            }
            else if (i === 0) {
                line += chars.topLeft;
            }
            else if (i === width - 1) {
                line += chars.topRight;
            }
            else {
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
            }
            else if (i === width - 1) {
                botLine += chars.botRight;
            }
            else {
                botLine += "-";
            }
        }
        process.stdout.write(botLine + resetCode + "\n");
    }
    renderToolsPanel(x, y, width, height) {
        const tools = this.ctx.listTools();
        const visible = tools
            .map((t) => {
            const icon = t.name.startsWith("vscode") ? C.magenta("[VSC]") :
                t.name.startsWith("subagent") ? C.cyan("[SUB]") :
                    t.name.startsWith("opencode") ? C.green("[OC]") :
                        t.name.startsWith("mcp") ? C.yellow("[MCP]") :
                            t.name.startsWith("http") ? C.blue("[API]") :
                                t.name.startsWith("web") ? C.magenta("[WEB]") : "     ";
            return icon + " " + C.bold(t.name);
        })
            .slice(0, height);
        for (let i = 0; i < visible.length && i < height; i++) {
            TerminalUtils.moveCursor(x, y + i);
            process.stdout.write((visible[i] ?? "").slice(0, width).padEnd(width));
        }
    }
    renderOutputPanel(x, y, width, height) {
        const lines = this.outputLines.slice(-height);
        for (let i = 0; i < height; i++) {
            TerminalUtils.moveCursor(x, y + i);
            const line = lines[i] ?? "";
            process.stdout.write(line.slice(0, width).padEnd(width));
        }
    }
    renderTerminal(x, y, width, height) {
        const lines = this.terminal.getLines();
        const visible = lines.slice(-height);
        for (let i = 0; i < height; i++) {
            TerminalUtils.moveCursor(x, y + i);
            const line = visible[i] ?? "";
            process.stdout.write(C.gray(line.slice(0, width).padEnd(width)));
        }
    }
    renderStatus(y, cols) {
        TerminalUtils.moveCursor(0, y);
        const status = C.dim("|");
        const model = C.green(this.model);
        const provider = C.magenta(this.provider);
        const step = C.yellow("step " + this.step + "/" + this.maxSteps);
        const running = this.running ? C.red("running") : C.green("idle");
        const statusText = provider + " " + model + " | " + step + " | " + running;
        process.stdout.write(status + " " + statusText + " ".repeat(Math.max(0, cols - statusText.length - 5)) + C.dim("|"));
    }
    renderPalette() {
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
            const item = results[i];
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
//# sourceMappingURL=tui-dashboard.js.map