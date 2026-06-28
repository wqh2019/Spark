import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Tool, ToolContext } from "./index.js";

export function createFileTools(ctx: ToolContext): Tool[] {
  const { safetyChecker } = ctx;

  const DEFAULT_READ_LIMIT = 2000;

  const readFile: Tool = {
    name: "read_file",
    description:
      "Read the contents of a file. Supports offset and limit for partial reads.",
    parameters: {
      file_path: {
        type: "string",
        description: "Absolute or relative path to the file to read",
      },
      offset: {
        type: "number",
        description: "Line offset to start reading from (0-based, default: 0)",
      },
      limit: {
        type: "number",
        description: `Maximum number of lines to read (default: ${DEFAULT_READ_LIMIT})`,
      },
    },
    required: ["file_path"],
    requiresConfirmation: false,
    async execute(args) {
      const filePath = String(args.file_path);
      const offset = typeof args.offset === "number" ? args.offset : 0;
      const limit = typeof args.limit === "number" ? args.limit : DEFAULT_READ_LIMIT;

      try {
        safetyChecker.checkPath(resolve(filePath));
      } catch (err) {
        return err instanceof Error ? err.message : String(err);
      }

      try {
        if (!existsSync(filePath)) {
          return `Error reading file: File not found: ${filePath}`;
        }

        const fileSize = statSync(filePath).size;
        try {
          safetyChecker.checkFileSize(fileSize);
        } catch (err) {
          return err instanceof Error ? err.message : String(err);
        }

        // Binary content detection: check for null bytes in first 8KB
        const raw = readFileSync(filePath);
        if (isBinaryContent(raw)) {
          return `Binary file detected: ${filePath} (${fileSize} bytes). Use run_command with appropriate tools (e.g., xxd, file, exiftool) to inspect this file.`;
        }

        const content = raw.toString("utf-8");
        const lines = content.split("\n");
        const selected = lines.slice(offset, offset + limit);

        return selected
          .map((line, i) => {
            const lineNum = String(offset + i + 1).padStart(6) + "\t" + line;
            return lineNum;
          })
          .join("\n");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return `Error reading file: ${message}`;
      }
    },
  };

  const writeFile: Tool = {
    name: "write_file",
    description:
      "Write content to a file. Creates the file and parent directories if needed.",
    parameters: {
      file_path: {
        type: "string",
        description: "Path to the file to write",
      },
      content: {
        type: "string",
        description: "Content to write to the file",
      },
    },
    requiresConfirmation: true,
    required: ["file_path", "content"],
    async execute(args) {
      const filePath = String(args.file_path);
      const content = String(args.content);

      try {
        safetyChecker.checkPath(resolve(filePath));
      } catch (err) {
        return err instanceof Error ? err.message : String(err);
      }

      // Protect sensitive files from accidental overwrite
      const sensitiveCheck = checkSensitiveFile(filePath);
      if (sensitiveCheck) return sensitiveCheck;

      try {
        const dir = dirname(filePath);
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }

        writeFileSync(filePath, content, "utf-8");
        const lineCount = content.split("\n").length;
        return `Successfully wrote ${content.length} characters (${lineCount} lines) to ${filePath}`;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return `Error writing file: ${message}`;
      }
    },
  };

  const editFile: Tool = {
    name: "edit_file",
    description:
      "Replace content in a file. Supports exact string replacement (old_string/new_string) and line number based editing (start_line/end_line).",
    parameters: {
      file_path: {
        type: "string",
        description: "Path to the file to edit",
      },
      old_string: {
        type: "string",
        description:
          "Exact string to find and replace. Not needed when using line number mode (start_line/end_line).",
      },
      new_string: {
        type: "string",
        description: "String to replace with (for string mode) or new content (for line mode)",
      },
      replace_all: {
        type: "boolean",
        description: "Replace all occurrences (default: false, string mode only)",
      },
      start_line: {
        type: "number",
        description:
          "Start line number (1-based) for line-based editing. Requires end_line. The lines from start_line to end_line (inclusive) will be replaced with new_string.",
      },
      end_line: {
        type: "number",
        description:
          "End line number (1-based, inclusive) for line-based editing. Requires start_line.",
      },
    },
    requiresConfirmation: true,
    required: ["file_path"],
    async execute(args) {
      const filePath = String(args.file_path);
      const newStr = String(args.new_string ?? "");

      try {
        safetyChecker.checkPath(resolve(filePath));
      } catch (err) {
        return err instanceof Error ? err.message : String(err);
      }

      try {
        if (!existsSync(filePath)) {
          return `Error editing file: File not found: ${filePath}`;
        }

        const fileSize = statSync(filePath).size;
        try {
          safetyChecker.checkFileSize(fileSize);
        } catch (err) {
          return err instanceof Error ? err.message : String(err);
        }

        let content = readFileSync(filePath, "utf-8");

        // --- Line number mode ---
        const startLine = typeof args.start_line === "number" ? args.start_line : 0;
        const endLine = typeof args.end_line === "number" ? args.end_line : 0;
        if (startLine > 0 && endLine > 0) {
          const lines = content.replace(/\r\n/g, "\n").split("\n");
          if (startLine < 1 || startLine > lines.length) {
            return `Error editing file: start_line ${startLine} is out of range (file has ${lines.length} lines)`;
          }
          if (endLine < startLine || endLine > lines.length) {
            return `Error editing file: end_line ${endLine} is out of range (file has ${lines.length} lines)`;
          }

          const newLines = newStr.split("\n");
          const before = lines.slice(0, startLine - 1);
          const after = lines.slice(endLine);
          const updated = [...before, ...newLines, ...after];
          writeFileSync(filePath, updated.join("\n"), "utf-8");
          return `Successfully edited ${filePath} (replaced lines ${startLine}-${endLine})`;
        }

        // --- String replacement mode ---
        const oldStr = String(args.old_string ?? "");
        if (!oldStr) {
          return `Error editing file: old_string is required for string replacement mode`;
        }

        const replaceAll = args.replace_all === true;

        // Normalize CRLF to LF for matching
        const normalizedContent = content.replace(/\r\n/g, "\n");
        const normalizedOldStr = oldStr.replace(/\r\n/g, "\n");

        // Try exact match first
        let matchIndex = normalizedContent.indexOf(normalizedOldStr);

        // Fallback: fuzzy match (whitespace-normalized) if exact match fails
        if (matchIndex === -1) {
          const fuzzyContent = normalizedContent.replace(/\s+/g, " ");
          const fuzzyOldStr = normalizedOldStr.replace(/\s+/g, " ");
          matchIndex = fuzzyContent.indexOf(fuzzyOldStr);

          if (matchIndex !== -1) {
            // Found fuzzy match — reconstruct the actual matched string from original content
            const beforeFuzzy = normalizedContent.slice(0, matchIndex);
            const afterFuzzy = normalizedContent.slice(matchIndex + fuzzyOldStr.length);
            // The actual matched region may differ in whitespace; use the replacement on normalized
            const beforeLen = beforeFuzzy.length;
            const afterLen = afterFuzzy.length;
            // Find actual boundaries by scanning content
            const actualStart = normalizedContent.slice(0, matchIndex + fuzzyOldStr.length).search(/\S\s*$/);
            const fuzzyRe = new RegExp(fuzzyOldStr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+"));
            const actualMatch = normalizedContent.match(fuzzyRe);
            if (actualMatch) {
              const actual = actualMatch[0];
              const newContent = replaceAll
                ? normalizedContent.replace(fuzzyRe, newStr)
                : normalizedContent.replace(actual, newStr);
              writeFileSync(filePath, newContent, "utf-8");
              return `Successfully edited ${filePath} (fuzzy match: whitespace differences tolerated)`;
            }
          }

          return `Error editing file: String not found in ${filePath}. Tips:
- Check for trailing/leading whitespace differences
- Use start_line/end_line for line-based editing
- The file may have been modified since you last read it`;
        }

        if (!replaceAll) {
          const secondIdx = normalizedContent.indexOf(normalizedOldStr, matchIndex + 1);
          if (secondIdx !== -1) {
            return `Error editing file: Multiple occurrences found in ${filePath}. Use replace_all: true to replace all.`;
          }
        }

        const newContent = replaceAll
          ? normalizedContent.split(normalizedOldStr).join(newStr)
          : normalizedContent.replace(normalizedOldStr, newStr);

        writeFileSync(filePath, newContent, "utf-8");
        return `Successfully edited ${filePath}`;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return `Error editing file: ${message}`;
      }
    },
  };

  const listDir: Tool = {
    name: "list_dir",
    description: "List files and directories in a path.",
    parameters: {
      dir_path: {
        type: "string",
        description: 'Directory path to list (default: ".")',
      },
    },
    requiresConfirmation: false,
    async execute(args) {
      const dirPath = args.dir_path ? String(args.dir_path) : ".";

      try {
        safetyChecker.checkPath(resolve(dirPath));
      } catch (err) {
        return err instanceof Error ? err.message : String(err);
      }

      try {
        if (!existsSync(dirPath)) {
          return `Error listing directory: Directory not found: ${dirPath}`;
        }
        if (!statSync(dirPath).isDirectory()) {
          return `Error listing directory: Not a directory: ${dirPath}`;
        }

        const entries = readdirSync(dirPath, { withFileTypes: true });
        return entries
          .map((e) => {
            if (e.isDirectory()) {
              return `${e.name}/`;
            }
            try {
              const fullPath = join(dirPath, e.name);
              const stat = statSync(fullPath);
              return `${e.name} (${stat.size} bytes)`;
            } catch {
              return e.name;
            }
          })
          .join("\n");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return `Error listing directory: ${message}`;
      }
    },
  };

  return [readFile, writeFile, editFile, listDir];
}

/**
 * Detect binary content by scanning for null bytes in the first 8KB.
 * Returns true if the content appears to be binary.
 */
function isBinaryContent(buf: Buffer): boolean {
  const checkLen = Math.min(buf.length, 8192);
  for (let i = 0; i < checkLen; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

/**
 * Check if the file path targets a sensitive/protected file.
 * Returns an error message string, or null if safe.
 */
function checkSensitiveFile(filePath: string): string | null {
  const basename = filePath.split(/[\\/]/).pop() ?? "";
  const SENSITIVE: string[] = [".env", ".env.local", ".env.production"];
  if (SENSITIVE.includes(basename)) {
    return `Error: Writing to "${basename}" is blocked for security. Use run_command to manage this file if needed.`;
  }
  // Check if inside .git directory
  const parts = filePath.split(/[\\/]/);
  if (parts.includes(".git")) {
    return `Error: Writing to files inside .git directory is blocked.`;
  }
  return null;
}
