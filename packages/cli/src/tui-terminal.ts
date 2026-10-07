import { spawn } from "node:child_process";
import type { SpawnOptions } from "node:child_process";

export class Terminal {
  private buffer: string[] = [];
  private cursorRow = 0;
  private scrollOffset = 0;
  private shell: ReturnType<typeof spawn> | null = null;
  private shellBuffer = "";
  public height = 10;
  public width = 80;

  constructor(
    public cwd: string,
    height: number,
    width: number,
    private onOutput: (text: string) => void = () => {}
  ) {
    this.height = height;
    this.width = width;
  }

  startShell(): void {
    if (this.shell) return;
    const options: SpawnOptions = {
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

  writeInput(input: string): void {
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
