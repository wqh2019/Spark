import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Tool } from "./index.js";
import { SafetyChecker } from "../safety.js";

let projectDir = process.cwd();
let safetyChecker = new SafetyChecker({ projectRoot: projectDir });

export function setDevProjectDir(dir: string): void {
  projectDir = dir;
  safetyChecker = new SafetyChecker({ projectRoot: dir });
}

const isWindows = process.platform === "win32";

// git refs: branch / commit SHA / tag / HEAD / origin/main / v1.0.0
// Rejects shell metacharacters AND git option injection (e.g. --output=).
const GIT_REF_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_./-]*$/;
// Windows cmd dangerous characters (only checked on Windows where npx/npm run
// with shell:true). Spaces, unicode, parentheses, and # are allowed.
const WIN_SHELL_META = /[&|<>"^%]/;

function runExec(file: string, args: string[], timeout = 30_000): Promise<string> {
  // npm/npx are .cmd scripts on Windows and require shell:true (Node CVE hardening).
  // git is a real binary and runs without a shell on every platform.
  const useShell = isWindows && (file === "npm" || file === "npx");
  return new Promise((resolvePromise) => {
    execFile(
      file,
      args,
      { cwd: projectDir, timeout, maxBuffer: 1024 * 1024, shell: useShell },
      (error, stdout, stderr) => {
        if (error) {
          resolvePromise(`Error: ${error.message}`);
          return;
        }
        let output = "";
        if (stdout) output += stdout;
        if (stderr) output += (output ? "\n" : "") + stderr;
        resolvePromise(output || "(no output)");
      },
    );
  });
}

// Validates a file/directory path argument: must stay inside the project
// sandbox, and on Windows must not carry cmd metacharacters. Returns an error
// message string when invalid, or null when valid.
function validatePathArg(target: string): string | null {
  try {
    safetyChecker.checkPath(resolve(projectDir, target));
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  if (isWindows && WIN_SHELL_META.test(target)) {
    return `Error: path contains shell metacharacters: ${target}`;
  }
  return null;
}

const gitStatus: Tool = {
  name: "git_status",
  description: "Show git working tree status.",
  parameters: {},
  requiresConfirmation: false,
  async execute() {
    return runExec("git", ["status"]);
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
    if (!GIT_REF_PATTERN.test(target)) {
      return `Error: invalid git ref (rejected): ${target}`;
    }
    return runExec("git", ["diff", target]);
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

    const pathError = validatePathArg(target);
    if (pathError) return pathError;

    const results: string[] = [];

    if (hasPrettier) {
      const prettierResult = await runExec("npx", ["prettier", "--write", target]);
      results.push(`[prettier]\n${prettierResult}`);
    }

    if (hasEslint) {
      const eslintResult = await runExec("npx", ["eslint", "--fix", target]);
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
    const pathError = validatePathArg(target);
    if (pathError) return pathError;
    return runExec("npx", ["eslint", target]);
  },
};

const testTool: Tool = {
  name: "test",
  description: "Run project tests using npm test.",
  parameters: {},
  requiresConfirmation: false,
  async execute() {
    return runExec("npm", ["test"], 60_000);
  },
};

export const devTools: Tool[] = [gitStatus, gitDiff, format, lint, testTool];
