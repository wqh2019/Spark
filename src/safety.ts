import { resolve, sep } from "node:path";

const DEFAULT_BLOCKED_COMMANDS = [
  "rm -rf /",
  "rm -rf /*",
  "rm -rf --no-preserve-root",
  "sudo",
  "sudo !!",
  "mkfs",
  "dd if=",
  "dd of=",
  "shutdown",
  "shutdown -h",
  "shutdown -r",
  "reboot",
  "halt",
  "poweroff",
  "init 0",
  "init 6",
  "chmod 777 /",
  "chmod -R 777 /",
  "chown -R",
  "> /dev/sda",
  "> /dev/sdb",
  ":(){:|:&};:",
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
   * Uses path separator boundary check to prevent sibling directory prefix bypass.
   * Throws an Error if the path is outside the project root.
   */
  checkPath(filePath: string): void {
    const resolved = resolve(filePath);
    // Boundary check: must be exactly projectRoot or start with projectRoot + separator
    if (!(resolved === this.projectRoot || resolved.startsWith(this.projectRoot + sep))) {
      throw new Error(`Path is outside project: ${filePath}`);
    }
  }

  // Regex patterns for pipe-to-interpreter injection detection (case-insensitive)
  private static readonly PIPE_TO_SHELL =
    /\|\s*(?:sh|bash|zsh|ksh|csh|dash|cmd|eval|python|perl|ruby|php|node)(?:\s|$)/i;
  private static readonly BASE64_PIPE =
    /(?:base64|xxd)\s+(?:-d|--decode)\s+.*\|/i;
  private static readonly CURL_TO_SHELL =
    /(?:curl|wget)\s+.*\|\s*(?:sh|bash)/i;
  private static readonly FORK_BOMB =
    /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;/;

  /**
   * Validates that the given command does not match any blocked command pattern.
   * Uses multi-layer detection:
   *   1. Whitespace normalization (prevents e.g. "rm  -rf  /")
   *   2. Pipe-to-interpreter injection detection (sh/bash/python via pipe)
   *   3. base64/curl smuggling detection
   *   4. Fork bomb detection
   *   5. Configurable blocked command list (original + extended)
   * Throws an Error if a blocked command is detected.
   */
  checkCommand(command: string): void {
    // Normalise consecutive whitespace to a single space for substring matching
    const normalised = command.replace(/\s+/g, " ").trim();
    const lower = normalised.toLowerCase();

    // Pipe to shell / interpreter injection
    if (SafetyChecker.PIPE_TO_SHELL.test(normalised)) {
      throw new Error(`Blocked command: pipe to shell/interpreter detected`);
    }

    // Base64 / xxd decode smuggling
    if (SafetyChecker.BASE64_PIPE.test(normalised)) {
      throw new Error(`Blocked command: base64/xxd decode pipe detected`);
    }

    // curl / wget piped to shell
    if (SafetyChecker.CURL_TO_SHELL.test(normalised)) {
      throw new Error(`Blocked command: remote script execution detected`);
    }

    // Fork bomb patterns
    if (SafetyChecker.FORK_BOMB.test(normalised)) {
      throw new Error(`Blocked command: fork bomb detected`);
    }

    // Configurable blocked commands (substring match on normalised whitespace)
    for (const blocked of this.blockedCommands) {
      // Also normalise the blocked pattern so extra whitespace in pattern is handled
      const blockedNorm = blocked.replace(/\s+/g, " ").toLowerCase();
      if (lower.includes(blockedNorm)) {
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
  "lint",
  "git_add",
  "git_commit",
  "git_checkout",
]);

/**
 * Returns true if the given tool name requires user confirmation before execution.
 */
export function requiresConfirmation(toolName: string): boolean {
  return CONFIRMATION_REQUIRED.has(toolName);
}
