import { spawn } from "node:child_process";
export class Terminal {
    cwd;
    onOutput;
    buffer = [];
    cursorRow = 0;
    scrollOffset = 0;
    shell = null;
    shellBuffer = "";
    height = 10;
    width = 80;
    constructor(cwd, height, width, onOutput = () => { }) {
        this.cwd = cwd;
        this.onOutput = onOutput;
        this.height = height;
        this.width = width;
    }
    startShell() {
        if (this.shell)
            return;
        const options = {
            shell: "/bin/bash",
            cwd: this.cwd,
            env: { ...process.env },
            stdio: ["pipe", "pipe", "pipe"],
        };
        this.shell = spawn("bash", ["-i"], options);
        this.shell.stdout?.on("data", (data) => {
            this.shellBuffer += data.toString();
            this.onOutput(data.toString());
        });
        this.shell.stderr?.on("data", (data) => {
            this.shellBuffer += data.toString();
            this.onOutput(data.toString());
        });
        this.shell.on("exit", (code) => {
            this.shell = null;
        });
    }
    writeInput(input) {
        if (!this.shell || !this.shell.stdin) {
            this.buffer.push("$ " + input);
            this.buffer.push("[terminal not available]");
            this.cursorRow += 2;
            return;
        }
        this.shell.stdin.write(input + "\n");
        this.cursorRow++;
        this.scrollIfNeeded();
    }
    scrollIfNeeded() {
        if (this.cursorRow >= this.height - 2) {
            this.scrollOffset++;
        }
    }
    resize(height, width) {
        this.height = height;
        this.width = width;
    }
    getLines() {
        return this.shellBuffer
            .split("\n")
            .filter((l) => l.length > 0)
            .slice(-Math.max(1, this.height - 2));
    }
    kill() {
        if (this.shell) {
            this.shell.kill();
            this.shell = null;
        }
    }
}
//# sourceMappingURL=tui-terminal.js.map