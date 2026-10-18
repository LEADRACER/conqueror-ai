import { existsSync } from "node:fs";
import { spawn } from "node:child_process";

const MAX_BUFFER_LINES = 800;

export class Terminal {
  private buffer: string[] = [];
  private cursorRow = 0;
  private scrollOffset = 0;
  private shell: ReturnType<typeof spawn> | null = null;
  private shellBuffer = "";
  public height = 10;
  public width = 80;
  public onOutput: (text: string) => void = () => {};

  constructor(
    public cwd: string,
    height: number,
    width: number
  ) {
    this.height = height;
    this.width = width;
  }

  startShell(): void {
    if (this.shell) return;
    // Run the subshell in its own session so it never fights the TUI over the
    // controlling terminal's termios (bash -i grabs the tty via readline).
    const setsid = existsSync("/usr/bin/setsid") ? "/usr/bin/setsid" : null;
    const args = setsid
      ? [setsid, "--wait", "bash", "--norc", "-i"]
      : ["bash", "--norc", "-i"];
    const env = { ...(process.env as Record<string, string | undefined>), TERM: "dumb" };
    this.shell = spawn(args[0]!, args.slice(1), {
      cwd: this.cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.shell.stdout?.on("data", (data) => {
      this.appendBuffer(data.toString());
      this.onOutput(data.toString());
    });
    this.shell.stderr?.on("data", (data) => {
      this.appendBuffer(data.toString());
      this.onOutput(data.toString());
    });
    this.shell.on("exit", () => {
      this.shell = null;
    });
  }

  private appendBuffer(text: string): void {
    this.shellBuffer += text;
    const lines = this.shellBuffer.split("\n");
    if (lines.length > MAX_BUFFER_LINES) {
      this.shellBuffer = lines.slice(-Math.floor(MAX_BUFFER_LINES / 2)).join("\n");
    }
  }

  writeInput(input: string): void {
    if (!this.shell) {
      this.startShell();
    }
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

  private scrollIfNeeded(): void {
    if (this.cursorRow >= this.height - 2) {
      this.scrollOffset++;
    }
  }

  resize(height: number, width: number): void {
    this.height = height;
    this.width = width;
  }

  getLines(): string[] {
    return this.shellBuffer
      .split("\n")
      .filter((l) => l.length > 0)
      .slice(-Math.max(1, this.height - 2));
  }

  kill(): void {
    if (this.shell) {
      this.shell.kill();
      this.shell = null;
    }
  }
}
