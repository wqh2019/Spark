import { glob as globFn } from "glob";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Tool, ToolContext } from "./index.js";

export function createSearchTools(ctx: ToolContext): Tool[] {
  const { projectDir, safetyChecker } = ctx;

  const DEFAULT_SKIP_DIRS = [
    "**/node_modules/**",
    "**/.git/**",
    "**/__pycache__/**",
    "**/.venv/**",
    "**/dist/**",
    "**/.next/**",
  ];

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
        const matches = await globFn(pattern, {
          cwd: basePath,
          nodir: true,
          ignore: DEFAULT_SKIP_DIRS,
        });
        if (matches.length === 0) {
          return `No files matching "${pattern}" found in ${basePath}`;
        }
        return matches.sort().join("\n");
      } catch (err) {
        return `Glob error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };

  const grepContent: Tool = {
    name: "grep_content",
    description:
      "Search file contents using a regular expression pattern. Supports file type filtering, context lines, and result limits.",
    parameters: {
      pattern: {
        type: "string",
        description: "Regular expression pattern to search for",
      },
      path: {
        type: "string",
        description: "Directory to search in (default: .)",
      },
      file_pattern: {
        type: "string",
        description: "Optional glob pattern to filter files (e.g. **/*.ts, src/**/*.py)",
      },
      max_results: {
        type: "number",
        description: "Maximum number of matching lines to return (default: 200)",
      },
      context_before: {
        type: "number",
        description: "Number of context lines before each match (default: 0)",
      },
      context_after: {
        type: "number",
        description: "Number of context lines after each match (default: 0)",
      },
      context_around: {
        type: "number",
        description:
          "Number of context lines before and after each match (overrides context_before/context_after)",
      },
    },
    required: ["pattern"],
    requiresConfirmation: false,
    async execute(args) {
      const patternText = String(args.pattern);
      const searchPath = resolve(projectDir, String(args.path ?? "."));
      const filePattern = args.file_pattern ? String(args.file_pattern) : "**/*";
      const maxResults = typeof args.max_results === "number" ? args.max_results : 200;
      const contextAround =
        typeof args.context_around === "number" ? args.context_around : 0;
      const contextBefore =
        contextAround > 0
          ? contextAround
          : typeof args.context_before === "number"
            ? args.context_before
            : 0;
      const contextAfter =
        contextAround > 0
          ? contextAround
          : typeof args.context_after === "number"
            ? args.context_after
            : 0;

      try {
        safetyChecker.checkPath(searchPath);
      } catch (err) {
        return err instanceof Error ? err.message : String(err);
      }

      let regex: RegExp;
      try {
        regex = new RegExp(patternText, "i");
      } catch {
        return `Invalid regex pattern: ${patternText}`;
      }

      // Find matching files using glob (async, respects .gitignore)
      let files: string[];
      try {
        files = await globFn(filePattern, {
          cwd: searchPath,
          nodir: true,
          ignore: DEFAULT_SKIP_DIRS,
          dot: false,
        });
      } catch (err) {
        return `Glob error: ${err instanceof Error ? err.message : String(err)}`;
      }

      if (files.length === 0) {
        return `No files matching "${filePattern}" found in ${searchPath}`;
      }

      const results: string[] = [];
      let matchCount = 0;
      let fileCount = 0;

      for (const file of files) {
        if (matchCount >= maxResults) break;

        const fullPath = resolve(searchPath, file);

        let content: string;
        try {
          content = await readFile(fullPath, "utf-8");
        } catch {
          continue; // Skip unreadable files
        }

        const lines = content.split("\n");
        const fileMatchLines: number[] = [];

        for (let i = 0; i < lines.length; i++) {
          if (matchCount >= maxResults) break;

          regex.lastIndex = 0;
          if (regex.test(lines[i])) {
            fileMatchLines.push(i);
            matchCount++;
          }
        }

        if (fileMatchLines.length > 0) {
          fileCount++;

          // Build output with context lines
          const seenLines = new Set<number>();
          for (const mLine of fileMatchLines) {
            // Context before
            const ctxStart = Math.max(0, mLine - contextBefore);
            for (let ci = ctxStart; ci < mLine; ci++) {
              if (!seenLines.has(ci)) {
                seenLines.add(ci);
                results.push(`${file}:${ci + 1}: ${lines[ci].trim()}`);
              }
            }

            // Match line
            if (!seenLines.has(mLine)) {
              seenLines.add(mLine);
              results.push(`${file}:${mLine + 1}: ${lines[mLine].trim()}`);
            }

            // Context after
            const ctxEnd = Math.min(lines.length - 1, mLine + contextAfter);
            for (let ci = mLine + 1; ci <= ctxEnd; ci++) {
              if (!seenLines.has(ci)) {
                seenLines.add(ci);
                results.push(`${file}:${ci + 1}: ${lines[ci].trim()}`);
              }
            }
          }
        }
      }

      if (results.length === 0) {
        return `No matches for "${patternText}" in ${files.length} files`;
      }

      // Truncate results to maxResults if over (in case context lines caused overflow)
      const truncated = results.slice(0, maxResults);
      truncated.push(
        `Found ${matchCount} matches in ${fileCount} files (scanned ${files.length} files)`,
      );
      return truncated.join("\n");
    },
  };

  return [globFiles, grepContent];
}
