import { resolve } from "node:path";
import os from "node:os";
import { AccessDeniedError } from "./errors.js";

const ALLOWED_ROOTS: string[] = [process.cwd(), "/tmp"];

export function validateWorkspacePath(inputPath: string): void {
  if (inputPath.includes("\x00")) {
    throw new AccessDeniedError("null byte in path");
  }
  const resolved = resolve(inputPath);
  const underAllowed = ALLOWED_ROOTS.some((root) => resolved === root || resolved.startsWith(root + "/"));
  const underHome = resolved.startsWith(os.homedir() + "/");
  if (!underAllowed && !underHome) {
    throw new AccessDeniedError(`path escapes allowed roots: ${resolved}`);
  }
}

/** Guard args object against prompt-injected tool calls to harmless-named tools. */
export async function guardArgs(toolName: string, args: Record<string, unknown>): Promise<void> {
  for (const key of ["path", "file_path", "filePath", "filename", "target", "dir", "directory"]) {
    const val = args[key];
    if (typeof val === "string") {
      try {
        validateWorkspacePath(val);
      } catch (err) {
        throw new AccessDeniedError(`${toolName}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
}
