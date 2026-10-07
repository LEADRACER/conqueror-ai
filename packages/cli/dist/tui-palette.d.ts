import type { AlexContext } from "@alex-ai/core";
export interface CommandPaletteItem {
    id: string;
    label: string;
    description: string;
    category: string;
    action: (() => Promise<string>) | null;
}
export declare class CommandPalette {
    private ctx;
    private items;
    constructor(ctx: AlexContext);
    private buildItems;
    search(query: string): CommandPaletteItem[];
    getAll(): CommandPaletteItem[];
    getCategories(): string[];
    getCategoryItems(category: string): CommandPaletteItem[];
}
//# sourceMappingURL=tui-palette.d.ts.map