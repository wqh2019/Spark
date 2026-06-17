import { glob as globFn } from "glob";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { registerTool } from "./index.js";
import type { Tool } from "./index.js";
import { SafetyChecker } from "../safety.js";

let projectDir = process.cwd();
let safetyChecker = new SafetyChecker({ projectRoot: projectDir });

export function setSearchProjectDir(dir: string): void {
  projectDir = dir;
  safetyChecker = new SafetyChecker({ projectRoot: dir });
}

const SKIP_DIRS = new Set([".git", "node_modules", "__pycache__", ".venv"]);

const globFiles: Tool = {
  name: "glob_files",
  description: "Search for files matching a glob pattern.",
  parameters: {
    pattern: {
      type: "string",
      description: "Glob pattern (e.g. **/*.ts, src/**/*.py)",
    },
    path: {
      type: "string",
      description: "Base directory to search in (default: .)",
    },
  },
  required: ["pattern"],
  requiresConfirmation: false,
  async execute(args) {
    const pattern = String(args.pattern);
    const basePath = resolve(projectDir, String(args.path ?? "."));

    try {
      safetyChecker.checkPath(basePath);
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }

    try {
      const matches = await globFn(pattern, { cwd: basePath, nodir: true });
      if (matches.length === 0) {
        return `No files matching "${pattern}" found in ${basePath}`;
      }
      return matches.sort().join("\n");
    } catch (err) {
      return `Glob error: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

/** Recursively walk a directory, collecting all file paths (relative to root), skipping SKIP_DIRS. */
function walkDir(root: string, prefix = ""): string[] {
  const results: string[] = [];
  let entries;
  try {
    entries = readdirSync(join(root, prefix), { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      results.push(...walkDir(root, prefix ? `${prefix}/${entry.name}` : entry.name));
    } else if (entry.isFile()) {
      results.push(prefix ? `${prefix}/${entry.name}` : entry.name);
    }
  }
  return results;
}

const grepContent: Tool = {
  name: "grep_content",
  description: "Search file contents using a regular expression pattern.",
  parameters: {
    pattern: {
      type: "string",
      description: "Regular expression pattern to search for",
    },
    path: {
      type: "string",
      description: "Directory to search in (default: .)",
    },
  },
  required: ["pattern"],
  requiresConfirmation: false,
  async execute(args) {
    const pattern = String(args.pattern);
    const searchPath = resolve(projectDir, String(args.path ?? "."));

    try {
      safetyChecker.checkPath(searchPath);
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }

    let regex: RegExp;
    try {
      regex = new RegExp(pattern, "i");
    } catch {
      return `Invalid regex pattern: ${pattern}`;
    }

    const files = walkDir(searchPath);
    const results: string[] = [];
    let matchCount = 0;
    let fileCount = 0;

    for (const file of files) {
      const fullPath = resolve(searchPath, file);
      const fileMatches: string[] = [];
      try {
        const content = readFileSync(fullPath, "utf-8");
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (regex.test(lines[i])) {
            // Reset lastIndex since we're reusing the regex
            regex.lastIndex = 0;
            fileMatches.push(`${file}:${i + 1}: ${lines[i].trim()}`);
            matchCount++;
          } else {
            regex.lastIndex = 0;
          }
        }
      } catch {
        // Skip unreadable files
      }
      if (fileMatches.length > 0) {
        results.push(...fileMatches);
        fileCount++;
      }
    }

    if (results.length === 0) {
      return `No matches for "${pattern}" in ${files.length} files`;
    }

    results.push(`Found ${matchCount} matches in ${fileCount} files`);
    return results.join("\n");
  },
};

export const searchTools: Tool[] = [globFiles, grepContent];

// Auto-register with the global registry for backward compatibility
for (const tool of searchTools) {
  registerTool(tool);
}
