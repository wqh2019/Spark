import { exec } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { registerTool } from "./index.js";
import type { Tool } from "./index.js";

let projectDir = process.cwd();

export function setDevProjectDir(dir: string): void {
  projectDir = dir;
}

function runExec(command: string, timeout = 30_000): Promise<string> {
  return new Promise((resolve) => {
    exec(
      command,
      { cwd: projectDir, timeout, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          resolve(`Error: ${error.message}`);
          return;
        }
        let output = "";
        if (stdout) output += stdout;
        if (stderr) output += (output ? "\n" : "") + stderr;
        resolve(output || "(no output)");
      },
    );
  });
}

const gitStatus: Tool = {
  name: "git_status",
  description: "Show git working tree status.",
  parameters: {},
  requiresConfirmation: false,
  async execute() {
    return runExec("git status");
  },
};

const gitDiff: Tool = {
  name: "git_diff",
  description: "Show git diff of changes against HEAD.",
  parameters: {},
  requiresConfirmation: false,
  async execute() {
    return runExec("git diff HEAD");
  },
};

const PRETTIER_CONFIG_FILES = [
  ".prettierrc",
  ".prettierrc.json",
  "prettier.config.js",
];

const format: Tool = {
  name: "format",
  description:
    "Run code formatter using prettier. Detects project prettier config; skips if none found.",
  parameters: {},
  requiresConfirmation: true,
  async execute() {
    const hasConfig = PRETTIER_CONFIG_FILES.some((file) =>
      existsSync(resolve(projectDir, file)),
    );
    if (!hasConfig) {
      return "No prettier configuration found. Skipping format.";
    }
    return runExec("npx prettier --write .");
  },
};

export const devTools: Tool[] = [gitStatus, gitDiff, format];

// Auto-register with the global registry for backward compatibility
for (const tool of devTools) {
  registerTool(tool);
}
