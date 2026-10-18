import type { AlexContext, ToolDefinition } from "@alex-ai/core";

export interface CommandPaletteItem {
  id: string;
  label: string;
  description: string;
  category: string;
  action: (() => Promise<string>) | null;
}

export interface PaletteHooks {
  clearScreen(): void;
  openExtensions(): void;
  switchProvider(id: string): void;
}

export class CommandPalette {
  private items: CommandPaletteItem[] = [];

  constructor(
    private ctx: AlexContext,
    private hooks: PaletteHooks
  ) {
    this.buildItems();
  }

  private buildItems(): void {
    const tools: ToolDefinition[] = this.ctx.listTools();
    const providers = this.ctx.providers.list();
    const skills = this.ctx.skills.list();

    this.items.push(
      {
        id: "cmd.clear",
        label: "Clear Screen",
        description: "Clear the output screen",
        category: "General",
        action: async () => {
          this.hooks.clearScreen();
          return "Screen cleared.";
        },
      },
      {
        id: "cmd.tools",
        label: "List All Tools",
        description: "Show all available tools",
        category: "General",
        action: () => {
          const list = tools.map((t) => " " + t.name + ": " + t.description).join("\n");
          return Promise.resolve("Available tools (" + tools.length + "):\n" + list);
        },
      },
      {
        id: "cmd.vscode.browse",
        label: "Browse VS Code Extensions",
        description: "Search and install VS Code extensions",
        category: "VS Code",
        action: async () => {
          this.hooks.openExtensions();
          return "Extensions browser opened.";
        },
      },
      {
        id: "cmd.vscode.list",
        label: "List Installed VS Code Extensions",
        description: "Show installed extensions via VS Code CLI",
        category: "VS Code",
        action: async () => {
          const result = await this.ctx.callTool("vscode_list_installed", {});
          if (typeof result === "object" && result !== null && "output" in result) {
            return "Installed extensions:\n" + String((result as { output: unknown }).output);
          }
          return "Installed extensions:\n" + String(result).slice(0, 500);
        },
      },
      {
        id: "cmd.providers",
        label: "List Providers",
        description: "Show all registered providers",
        category: "Providers",
        action: () => {
          const list = providers.map((p) => " " + p.id + " - " + p.name + " (" + p.models.join(", ") + ")").join("\n");
          return Promise.resolve("Registered providers:\n" + list);
        },
      },
      {
        id: "cmd.skills",
        label: "List Skills",
        description: "Show all registered skills",
        category: "Providers",
        action: () => {
          const list = skills.map((s) => " " + s.id + " - " + s.name).join("\n");
          return Promise.resolve("Registered skills:\n" + list);
        },
      }
    );

    for (const provider of providers) {
      this.items.push({
        id: "provider:" + provider.id,
        label: "Switch to " + provider.id,
        description: "Use " + provider.name + " as the active provider",
        category: "Providers",
        action: async () => {
          this.hooks.switchProvider(provider.id);
          return "Switched provider to " + provider.id + ".";
        },
      });
    }

    for (const skill of skills) {
      this.items.push({
        id: "skill:" + skill.id,
        label: "Activate " + skill.id + " skill",
        description: skill.description.slice(0, 60),
        category: "Skills",
        action: null,
      });
    }
  }

  search(query: string): CommandPaletteItem[] {
    const q = query.toLowerCase();
    if (!q) return this.items;
    return this.items.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q) ||
        item.id.toLowerCase().includes(q)
    );
  }

  getAll(): CommandPaletteItem[] {
    return this.items;
  }

  getCategories(): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const item of this.items) {
      if (!seen.has(item.category)) {
        seen.add(item.category);
        result.push(item.category);
      }
    }
    return result;
  }

  getCategoryItems(category: string): CommandPaletteItem[] {
    return this.items.filter((item) => item.category === category);
  }
}
