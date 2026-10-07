import type { AlexContext, ToolDefinition } from "@alex-ai/core";

export interface CommandPaletteItem {
  id: string;
  label: string;
  description: string;
  category: string;
  action: (() => Promise<string>) | null;
}

export class CommandPalette {
  private items: CommandPaletteItem[] = [];

  constructor(private ctx: AlexContext) {
    this.buildItems();
  }

  private buildItems(): void {
    const tools: ToolDefinition[] = this.ctx.listTools();
    const providers = this.ctx.providers.list();
    const skills = this.ctx.skills.list();

    this.items.push(
      {
        id: "cmd.palette",
        label: "Command Palette",
        description: "Open the command palette",
        category: "General",
        action: null,
      },
      {
        id: "cmd.clear",
        label: "Clear Screen",
        description: "Clear the output screen",
        category: "General",
        action: null,
      },
      {
        id: "cmd.tools",
        label: "List All Tools",
        description: "Show all available tools",
        category: "General",
        action: () => {
          const list = tools.map((t) => `  ${t.name}: ${t.description}`).join("\n");
          return Promise.resolve(`Available tools (${tools.length}):\n${list}`);
        },
      },
      {
        id: "cmd.providers",
        label: "List Providers",
        description: "Show all registered providers",
        category: "Providers",
        action: () => {
          const list = providers.map((p) => `  ${p.id} - ${p.name} (${p.models.join(", ")})`).join("\n");
          return Promise.resolve(`Registered providers:\n${list}`);
        },
      },
      {
        id: "cmd.skills",
        label: "List Skills",
        description: "Show all registered skills",
        category: "Providers",
        action: () => {
          const list = skills.map((s) => `  ${s.id} - ${s.name}`).join("\n");
          return Promise.resolve(`Registered skills:\n${list}`);
        },
      }
    );

    for (const tool of tools) {
      this.items.push({
        id: "tool:" + tool.name,
        label: "Run " + tool.name,
        description: tool.description.slice(0, 60),
        category: "Tools",
        action: null,
      });
    }

    for (const provider of providers) {
      this.items.push({
        id: "provider:" + provider.id,
        label: "Switch to " + provider.id,
        description: "Use " + provider.name + " as the active provider",
        category: "Providers",
        action: null,
      });
    }

    for (const skill of skills) {
      this.items.push({
        id: "skill:" + skill.id,
        label: "Enable " + skill.id + " skill",
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
