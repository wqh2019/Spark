import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Tool } from "./index.js";
import { SafetyChecker } from "../safety.js";

let projectDir = process.cwd();
let safetyChecker = new SafetyChecker({ projectRoot: projectDir });

export function setProjectDir(dir: string, maxFileSize?: number): void {
  projectDir = dir;
  safetyChecker = new SafetyChecker({ projectRoot: dir, maxFileSize });
}

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

      const content = readFileSync(filePath, "utf-8");
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
    "Replace an exact string in a file. Set replace_all to true to replace all occurrences.",
  parameters: {
    file_path: {
      type: "string",
      description: "Path to the file to edit",
    },
    old_string: {
      type: "string",
      description: "Exact string to find and replace",
    },
    new_string: {
      type: "string",
      description: "String to replace with",
    },
    replace_all: {
      type: "boolean",
      description: "Replace all occurrences (default: false)",
    },
  },
  requiresConfirmation: true,
  required: ["file_path", "old_string", "new_string"],
  async execute(args) {
    const filePath = String(args.file_path);
    const oldStr = String(args.old_string);
    const newStr = String(args.new_string);
    const replaceAll = args.replace_all === true;

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

      const content = readFileSync(filePath, "utf-8");

      if (!content.includes(oldStr)) {
        return `Error editing file: String not found in ${filePath}`;
      }

      if (!replaceAll) {
        const firstIdx = content.indexOf(oldStr);
        const secondIdx = content.indexOf(oldStr, firstIdx + 1);
        if (secondIdx !== -1) {
          return `Error editing file: Multiple occurrences found in ${filePath}. Use replace_all: true to replace all.`;
        }
      }

      const newContent = replaceAll
        ? content.split(oldStr).join(newStr)
        : content.replace(oldStr, newStr);

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

export const fileTools: Tool[] = [readFile, writeFile, editFile, listDir];
