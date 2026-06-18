import { resolve } from "node:path";

const DEFAULT_BLOCKED_COMMANDS = [
  "rm -rf /",
  "rm -rf /*",
  "sudo",
  "mkfs",
  "dd if=",
  ":(){:|:&};:",
  "> /dev/sda",
];

const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export interface SafetyCheckerOptions {
  projectRoot: string;
  blockedCommands?: string[];
  maxFileSize?: number;
}

export class SafetyChecker {
  readonly projectRoot: string;
  readonly blockedCommands: string[];
  readonly maxFileSize: number;

  constructor({ projectRoot, blockedCommands, maxFileSize }: SafetyCheckerOptions) {
    this.projectRoot = resolve(projectRoot);
    this.blockedCommands = blockedCommands ?? DEFAULT_BLOCKED_COMMANDS;
    this.maxFileSize = maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
  }

  /**
   * Validates that the given file path resolves to a location inside projectRoot.
   * Throws an Error if the path is outside the project root.
   */
  checkPath(filePath: string): void {
    const resolved = resolve(filePath);
    if (!resolved.startsWith(this.projectRoot)) {
      throw new Error(`Path is outside project: ${filePath}`);
    }
  }

  /**
   * Validates that the given command does not match any blocked command pattern.
   * Uses case-insensitive substring matching.
   * Throws an Error if a blocked command is detected.
   */
  checkCommand(command: string): void {
    const lower = command.toLowerCase();
    for (const blocked of this.blockedCommands) {
      if (lower.includes(blocked.toLowerCase())) {
        throw new Error(`Blocked command: ${command}`);
      }
    }
  }

  /**
   * Validates that the given file size does not exceed maxFileSize.
   * Throws an Error if the file exceeds the limit.
   */
  checkFileSize(size: number): void {
    if (size > this.maxFileSize) {
      throw new Error(
        `File size ${size} bytes exceeds limit of ${this.maxFileSize} bytes`,
      );
    }
  }
}

const CONFIRMATION_REQUIRED = new Set([
  "write_file",
  "edit_file",
  "run_command",
  "format",
]);

/**
 * Returns true if the given tool name requires user confirmation before execution.
 */
export function requiresConfirmation(toolName: string): boolean {
  return CONFIRMATION_REQUIRED.has(toolName);
}
