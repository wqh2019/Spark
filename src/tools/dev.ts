import { exec } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
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
  description: "Show git diff of changes. Defaults to HEAD.",
  parameters: {
    target: {
      type: "string",
      description: "Branch, commit, or tag to diff against (default: HEAD)",
    },
  },
  requiresConfirmation: false,
  async execute(args) {
    const target = args.target ? String(args.target) : "HEAD";
    return runExec(`git diff ${target}`);
  },
};

const PRETTIER_CONFIG_FILES = [
  ".prettierrc",
  ".prettierrc.json",
  "prettier.config.js",
];

const ESLINT_CONFIG_FILES = [
  ".eslintrc",
  ".eslintrc.js",
  ".eslintrc.json",
  ".eslintrc.yml",
  "eslint.config.js",
];

export function detectFormatterConfigs(dir: string): { prettier: boolean; eslint: boolean } {
  return {
    prettier: PRETTIER_CONFIG_FILES.some((file) => existsSync(resolve(dir, file))),
    eslint: ESLINT_CONFIG_FILES.some((file) => existsSync(resolve(dir, file))),
  };
}

const format: Tool = {
  name: "format",
  description:
    "Run code formatter and linter. Detects prettier and/or eslint config; runs whichever is found.",
  parameters: {
    path: {
      type: "string",
      description: "File or directory to format (default: .)",
    },
  },
  requiresConfirmation: true,
  async execute(args) {
    const { prettier: hasPrettier, eslint: hasEslint } = detectFormatterConfigs(projectDir);
    const target = args.path ? String(args.path) : ".";

    if (!hasPrettier && !hasEslint) {
      return "No prettier or eslint configuration found. Skipping format.";
    }

    const results: string[] = [];

    if (hasPrettier) {
      const prettierResult = await runExec(`npx prettier --write ${target}`);
      results.push(`[prettier]\n${prettierResult}`);
    }

    if (hasEslint) {
      const eslintResult = await runExec(`npx eslint --fix ${target}`);
      results.push(`[eslint]\n${eslintResult}`);
    }

    return results.join("\n\n");
  },
};

const lint: Tool = {
  name: "lint",
  description:
    "Run eslint to check for issues. Detects project eslint config; skips if none found.",
  parameters: {
    path: {
      type: "string",
      description: "File or directory to lint (default: .)",
    },
  },
  requiresConfirmation: true,
  async execute(args) {
    const { eslint: hasEslint } = detectFormatterConfigs(projectDir);
    if (!hasEslint) {
      return "No eslint configuration found. Skipping lint.";
    }
    const target = args.path ? String(args.path) : ".";
    return runExec(`npx eslint ${target}`);
  },
};

const testTool: Tool = {
  name: "test",
  description: "Run project tests using npm test.",
  parameters: {},
  requiresConfirmation: false,
  async execute() {
    return runExec("npm test", 60_000);
  },
};

export const devTools: Tool[] = [gitStatus, gitDiff, format, lint, testTool];
