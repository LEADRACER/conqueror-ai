export type Color =
  | "reset" | "bold" | "dim" | "underline" | "blink"
  | "black" | "red" | "green" | "yellow" | "blue" | "magenta" | "cyan" | "white"
  | "brightBlack" | "brightRed" | "brightGreen" | "brightYellow"
  | "brightBlue" | "brightMagenta" | "brightCyan" | "brightWhite";

const COLOR_CODES: Record<Color, string> = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  underline: "\x1b[4m",
  blink: "\x1b[5m",
  black: "\x1b[30m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  brightBlack: "\x1b[90m",
  brightRed: "\x1b[91m",
  brightGreen: "\x1b[92m",
  brightYellow: "\x1b[93m",
  brightBlue: "\x1b[94m",
  brightMagenta: "\x1b[95m",
  brightCyan: "\x1b[96m",
  brightWhite: "\x1b[97m",
};

export class Style {
  static color(text: string, color: Color): string {
    const prefix = COLOR_CODES[color] ?? "";
    return `${prefix}${text}${COLOR_CODES.reset}`;
  }

  static bold(text: string): string {
    return `${COLOR_CODES.bold}${text}${COLOR_CODES.reset}`;
  }

  static dim(text: string): string {
    return `${COLOR_CODES.dim}${text}${COLOR_CODES.reset}`;
  }

  static cyan(text: string): string {
    return `${COLOR_CODES.cyan}${text}${COLOR_CODES.reset}`;
  }

  static yellow(text: string): string {
    return `${COLOR_CODES.yellow}${text}${COLOR_CODES.reset}`;
  }

  static green(text: string): string {
    return `${COLOR_CODES.green}${text}${COLOR_CODES.reset}`;
  }

  static red(text: string): string {
    return `${COLOR_CODES.red}${text}${COLOR_CODES.reset}`;
  }

  static gray(text: string): string {
    return `${COLOR_CODES.brightBlack}${text}${COLOR_CODES.reset}`;
  }

  static magenta(text: string): string {
    return `${COLOR_CODES.magenta}${text}${COLOR_CODES.reset}`;
  }

  static blue(text: string): string {
    return `${COLOR_CODES.blue}${text}${COLOR_CODES.reset}`;
  }

  static reset(text: string): string {
    return `${COLOR_CODES.reset}${text}${COLOR_CODES.reset}`;
  }

  static brightYellow(text: string): string {
    return `${COLOR_CODES.brightYellow}${text}${COLOR_CODES.reset}`;
  }

  static code(color: Color): string {
    return COLOR_CODES[color] ?? "";
  }
}

export class TerminalUtils {
  static get size(): { cols: number; rows: number } {
    const stdout = process.stdout;
    if (stdout.columns && stdout.rows) {
      return { cols: stdout.columns, rows: stdout.rows };
    }
    const cols = Number.parseInt(process.env.COLUMNS ?? "80", 10);
    const rows = Number.parseInt(process.env.LINES ?? "24", 10);
    return { cols, rows };
  }

  static clear(): void {
    process.stdout.write("\x1b[2J\x1b[H");
  }

  static hideCursor(): void {
    process.stdout.write("\x1b[?25l");
  }

  static showCursor(): void {
    process.stdout.write("\x1b[?25h");
  }

  static moveCursor(row: number, col: number): void {
    process.stdout.write(`\x1b[${row + 1};${col + 1}H`);
  }

  static clearLine(): void {
    process.stdout.write("\x1b[2K");
  }

  static clearToEOL(): void {
    process.stdout.write("\x1b[0K");
  }

  static clearToEndOfScreen(): void {
    process.stdout.write("\x1b[0J");
  }

  static setRawMode(enabled: boolean): void {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(enabled);
    }
  }

  static drawBox(
    x: number,
    y: number,
    width: number,
    height: number,
    title: string,
    border: "single" | "double" | "rounded" = "single",
    color: Color = "cyan",
    titleColor: Color = "bold"
  ): void {
    const chars = getBoxChars(border);
    const borderColor = COLOR_CODES[color];
    const titleColorCode = COLOR_CODES[titleColor];

    const titleLine = ` ${title} `;
    const innerWidth = width - 2;
    let titleStart = x + 1;
    const titleSpaces = innerWidth - titleLine.length;
    if (titleSpaces > 0 && titleSpaces % 2 === 0) {
      titleStart = x + 1 + Math.floor(titleSpaces / 2);
    } else if (titleSpaces > 0) {
      titleStart = x + 1 + Math.floor(titleSpaces / 2);
    }

    process.stdout.write(
      `${borderColor}${chars.topLeft}${borderColor}` +
      `${titleColorCode}${titleLine}${borderColor}` +
      " ".repeat(Math.max(0, innerWidth - titleLine.length - 1)) +
      `${borderColor}${chars.topRight}${COLOR_CODES.reset}\n`
    );

    for (let row = y + 1; row < y + height - 1; row++) {
      process.stdout.write(
        `${borderColor}${chars.midLeft}${COLOR_CODES.reset}` +
        " ".repeat(width - 2) +
        `${borderColor}${chars.midRight}${COLOR_CODES.reset}\n`
      );
    }

    process.stdout.write(
      `${borderColor}${chars.botLeft}${COLOR_CODES.reset}` +
      " ".repeat(width - 2) +
      `${borderColor}${chars.botRight}${COLOR_CODES.reset}\n`
    );
  }

  static writeAt(x: number, y: number, text: string): void {
    process.stdout.write(`\x1b[${y + 1};${x + 1}H${text}`);
  }
}

function getBoxChars(border: "single" | "double" | "rounded"): {
  topLeft: string;
  topRight: string;
  botLeft: string;
  botRight: string;
  midLeft: string;
  midRight: string;
} {
  switch (border) {
    case "double":
      return {
        topLeft: "╔", topRight: "╗", botLeft: "╚", botRight: "╝",
        midLeft: "║", midRight: "║",
      };
    case "rounded":
      return {
        topLeft: "╭", topRight: "╮", botLeft: "╰", botRight: "╯",
        midLeft: "│", midRight: "│",
      };
    default:
      return {
        topLeft: "┌", topRight: "┐", botLeft: "└", botRight: "┘",
        midLeft: "│", midRight: "│",
      };
  }
}

export function wrapText(text: string, width: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (current.length + word.length + 1 <= width) {
      current = current ? `${current} ${word}` : word;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [""];
}
