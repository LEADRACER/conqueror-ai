export type Color = "reset" | "bold" | "dim" | "underline" | "blink" | "black" | "red" | "green" | "yellow" | "blue" | "magenta" | "cyan" | "white" | "brightBlack" | "brightRed" | "brightGreen" | "brightYellow" | "brightBlue" | "brightMagenta" | "brightCyan" | "brightWhite";
export declare class Style {
    static color(text: string, color: Color): string;
    static bold(text: string): string;
    static dim(text: string): string;
    static cyan(text: string): string;
    static yellow(text: string): string;
    static green(text: string): string;
    static red(text: string): string;
    static gray(text: string): string;
    static magenta(text: string): string;
    static blue(text: string): string;
    static reset(text: string): string;
    static brightYellow(text: string): string;
    static code(color: Color): string;
}
export declare class TerminalUtils {
    static get size(): {
        cols: number;
        rows: number;
    };
    static clear(): void;
    static hideCursor(): void;
    static showCursor(): void;
    static moveCursor(row: number, col: number): void;
    static clearLine(): void;
    static clearToEOL(): void;
    static clearToEndOfScreen(): void;
    static setRawMode(enabled: boolean): void;
    static drawBox(x: number, y: number, width: number, height: number, title: string, border?: "single" | "double" | "rounded", color?: Color, titleColor?: Color): void;
    static writeAt(x: number, y: number, text: string): void;
}
export declare function wrapText(text: string, width: number): string[];
//# sourceMappingURL=tui-utils.d.ts.map