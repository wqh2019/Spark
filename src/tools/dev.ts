import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Tool, ToolContext } from "./index.js";

export function createDevTools(ctx: ToolContext): Tool[] {
  const { projectDir, safetyChecker } = ctx;

  const isWindows = process.platform === "win32";

  // git refs: branch / commit SHA / tag / HEAD / origin/main / v1.0.0
  // Rejects shell metacharacters AND git option injection (e.g. --output=).
  const GIT_REF_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_./-]*$/;
  // Windows cmd dangerous characters (only checked on Windows where npx/npm run
  // with shell:true). Spaces, unicode, parentheses, and # are allowed.
  const WIN_SHELL_META = /[&|<>"^%]/;

  // Valid git paths: alphanum, underscore, hyphen, dot, slash, @
  const GIT_PATH_PATTERN = /^[A-Za-z0-9_./@-]+$/;

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

  const gitAdd: Tool = {
    name: "git_add",
    description: "Stage file(s) for commit using git add.",
    parameters: {
      path: {
        type: "string",
        description: "File or directory to stage (default: .)",
      },
    },
    requiresConfirmation: true,
    async execute(args) {
      const target = args.path ? String(args.path) : ".";
      const pathError = validatePathArg(target);
      if (pathError) return pathError;
      return runExec("git", ["add", target]);
    },
  };

  const gitCommit: Tool = {
    name: "git_commit",
    description: "Create a git commit with a message.",
    parameters: {
      message: {
        type: "string",
        description: "Commit message",
      },
      all: {
        type: "boolean",
        description: "Auto-stage all tracked files (git commit -a, default: false)",
      },
      allow_empty: {
        type: "boolean",
        description: "Allow empty commit (default: false)",
      },
    },
    requiresConfirmation: true,
    required: ["message"],
    async execute(args) {
      const message = String(args.message);
      const gitArgs = ["commit"];

      if (args.all === true) {
        gitArgs.push("-a");
      }

      if (args.allow_empty === true) {
        gitArgs.push("--allow-empty");
      }

      gitArgs.push("-m", message);
      return runExec("git", gitArgs);
    },
  };

  const gitLog: Tool = {
    name: "git_log",
    description: "Show commit log. Supports limiting the number of commits and filtering by path.",
    parameters: {
      max_count: {
        type: "number",
        description: "Maximum number of commits to show (default: 10)",
      },
      path: {
        type: "string",
        description: "Filter log by file path",
      },
      format: {
        type: "string",
        description: "Log format: 'oneline' (default), 'short', 'medium', 'full', or 'format:<string>'",
      },
    },
    requiresConfirmation: false,
    async execute(args) {
      const maxCount = typeof args.max_count === "number" ? args.max_count : 10;
      const format = args.format ? String(args.format) : "oneline";
      const gitArgs = ["log", `--max-count=${maxCount}`];

      if (format.startsWith("format:")) {
        gitArgs.push(`--pretty=${format}`);
      } else {
        gitArgs.push(`--pretty=${format}`);
      }

      if (args.path) {
        const pathStr = String(args.path);
        if (!GIT_PATH_PATTERN.test(pathStr)) {
          return `Error: invalid path (rejected): ${pathStr}`;
        }
        gitArgs.push("--", pathStr);
      }

      return runExec("git", gitArgs);
    },
  };

  const gitCheckout: Tool = {
    name: "git_checkout",
    description: "Switch branches or restore working tree files.",
    parameters: {
      target: {
        type: "string",
        description: "Branch name, commit SHA, or file path to checkout",
      },
      create_branch: {
        type: "boolean",
        description: "Create a new branch (git checkout -b, default: false)",
      },
    },
    requiresConfirmation: true,
    required: ["target"],
    async execute(args) {
      const target = String(args.target);
      const gitArgs = ["checkout"];

      if (args.create_branch === true) {
        gitArgs.push("-b");
      }

      if (!GIT_REF_PATTERN.test(target)) {
        return `Error: invalid target (rejected): ${target}`;
      }

      gitArgs.push(target);
      return runExec("git", gitArgs);
    },
  };

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

  return [
    gitStatus,
    gitDiff,
    gitAdd,
    gitCommit,
    gitLog,
    gitCheckout,
    format,
    lint,
    testTool,
  ];
}

/**
 * Detect whether the project at the given directory has prettier and/or eslint config files.
 * Exported for testing.
 */
export function detectFormatterConfigs(dir: string): { prettier: boolean; eslint: boolean } {
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

  return {
    prettier: PRETTIER_CONFIG_FILES.some((file) => existsSync(resolve(dir, file))),
    eslint: ESLINT_CONFIG_FILES.some((file) => existsSync(resolve(dir, file))),
  };
}
