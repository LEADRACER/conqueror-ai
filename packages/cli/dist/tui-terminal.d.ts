export declare class Terminal {
    cwd: string;
    private onOutput;
    private buffer;
    private cursorRow;
    private scrollOffset;
    private shell;
    private shellBuffer;
    height: number;
    width: number;
    constructor(cwd: string, height: number, width: number, onOutput?: (text: string) => void);
    startShell(): void;
    writeInput(input: string): void;
    private scrollIfNeeded;
    resize(height: number, width: number): void;
    getLines(): string[];
    kill(): void;
}
//# sourceMappingURL=tui-terminal.d.ts.map