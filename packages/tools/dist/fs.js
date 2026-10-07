import { z } from "zod";
import { defineTool } from "@alex-ai/core";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { spawn } from "node:child_process";
export const FsTools = [
    defineTool({
        name: "read_file",
        description: "Read the contents of a text file. Returns the file content as a string. " +
            "Provide a path relative to the project directory or an absolute path. " +
            "Optionally specify line ranges with offset and limit.",
        args: {
            path: z.string().describe("File path to read (absolute or relative)"),
            offset: z.number().int().min(1).optional(),
            limit: z.number().int().min(1).optional(),
        },
        async handler(args, ctx) {
            const fullPath = path.resolve(ctx.directory, args.path);
            const content = await fs.readFile(fullPath, "utf-8");
            if (args.offset || args.limit) {
                const lines = content.split("\n");
                const start = (args.offset ?? 1) - 1;
                const end = args.limit ? start + args.limit : lines.length;
                return lines.slice(start, end).join("\n");
            }
            return content;
        },
    }),
    defineTool({
        name: "write_file",
        description: "Write or overwrite a file with the given content. Parent directories " +
            "are created automatically.",
        args: {
            path: z.string().describe("File path to write (absolute or relative)"),
            content: z.string().describe("Text content to write"),
            append: z.boolean().optional().describe("If true, append to existing file"),
        },
        async handler(args, ctx) {
            const fullPath = path.resolve(ctx.directory, args.path);
            await fs.mkdir(path.dirname(fullPath), { recursive: true });
            if (args.append) {
                await fs.appendFile(fullPath, args.content, "utf-8");
            }
            else {
                await fs.writeFile(fullPath, args.content, "utf-8");
            }
            return `Wrote ${args.content.length} bytes to ${args.path}`;
        },
    }),
    defineTool({
        name: "list_dir",
        description: "List the contents of a directory. Returns directories first, then " +
            "files, each with a trailing slash indicating directories.",
        args: {
            path: z.string().describe("Directory path to list (absolute or relative)"),
        },
        async handler(args, ctx) {
            const fullPath = path.resolve(ctx.directory, args.path);
            const entries = await fs.readdir(fullPath, { withFileTypes: true });
            const dirs = [];
            const files = [];
            for (const e of entries) {
                if (e.isDirectory())
                    dirs.push(e.name + "/");
                else
                    files.push(e.name);
            }
            dirs.sort();
            files.sort();
            return [...dirs, ...files].join("\n");
        },
    }),
    defineTool({
        name: "edit_file",
        description: "Replace exact string occurrences in a file. Use to make targeted " +
            "edits without rewriting the entire file. Specify old_string exactly " +
            "as it appears; new_string is the replacement.",
        args: {
            path: z.string().describe("File path to edit"),
            old_string: z.string().describe("Exact text to find"),
            new_string: z.string().describe("Replacement text"),
            replace_all: z
                .boolean()
                .optional()
                .describe("If true, replace all occurrences (default: first only)"),
        },
        async handler(args, ctx) {
            const fullPath = path.resolve(ctx.directory, args.path);
            const content = await fs.readFile(fullPath, "utf-8");
            if (args.replace_all) {
                const regex = new RegExp(args.old_string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
                const newContent = content.replace(regex, args.new_string);
                await fs.writeFile(fullPath, newContent, "utf-8");
                return "Replaced all occurrences";
            }
            const idx = content.indexOf(args.old_string);
            if (idx === -1) {
                return { output: "No match found for old_string", metadata: { notFound: true } };
            }
            const newContent = content.slice(0, idx) + args.new_string + content.slice(idx + args.old_string.length);
            await fs.writeFile(fullPath, newContent, "utf-8");
            return "Edit applied";
        },
    }),
    defineTool({
        name: "delete_file",
        description: "Delete a file or directory (recursive).",
        args: {
            path: z.string().describe("Path to delete"),
        },
        async handler(args, ctx) {
            const fullPath = path.resolve(ctx.directory, args.path);
            await fs.rm(fullPath, { recursive: true, force: true });
            return `Deleted ${args.path}`;
        },
    }),
    defineTool({
        name: "grep_search",
        description: "Search file contents using ripgrep. Returns matching lines with file " +
            "paths and line numbers.",
        args: {
            pattern: z.string().describe("Regex pattern to search for"),
            path: z.string().optional().describe("Directory or file to search (default: project dir)"),
        },
        async handler(args, ctx) {
            const searchPath = args.path ?? ctx.directory;
            const { stdout } = await runSpawn("rg", ["-n", "--no-heading", "-r", args.pattern, searchPath]);
            return stdout || "(no matches)";
        },
    }),
];
function runSpawn(cmd, args) {
    return new Promise((resolve) => {
        const child = spawn(cmd, args, { shell: true });
        let stdout = "";
        let stderr = "";
        child.stdout?.on("data", (d) => (stdout += d.toString()));
        child.stderr?.on("data", (d) => (stderr += d.toString()));
        child.on("close", (code) => resolve({ stdout, stderr, exitCode: code ?? 0 }));
        child.on("error", (err) => resolve({ stdout: "", stderr: err.message, exitCode: -1 }));
    });
}
//# sourceMappingURL=fs.js.map