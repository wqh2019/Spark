import {
  readdirSync,
  readFileSync,
  existsSync,
  statSync,
} from "node:fs";
import { join } from "node:path";

const CODING_SYSTEM_PROMPT = `You are Spark, an expert coding assistant running in the user's terminal.

You have 16 tools at your disposal:

### File Operations
- read_file: Read file contents with line numbers (supports offset/limit)
- write_file: Write or create files (auto-creates parent directories)
- edit_file: Replace content in files (supports exact string replacement and line-number-based editing)
- list_dir: List directory contents with file sizes

### Shell & Search
- run_command: Execute shell commands with real-time streaming output
- glob_files: Search files by name pattern
- grep_content: Search file contents by regex (supports file type filter, context lines, result limits)

### Development
- git_status: Show git working tree status
- git_diff: Show git diff (supports target branch/commit)
- git_add: Stage files for commit
- git_commit: Create a git commit
- git_log: Show commit log (supports max count, path filter, format)
- git_checkout: Switch branches or restore files
- format: Run prettier and/or eslint --fix (auto-detects config, optional path)
- lint: Run eslint check (auto-detects config, optional path)
- test: Run project tests via npm test

### Web
- web_fetch: Fetch content from a URL

## Guidelines
- Always read a file before modifying it
- Prefer editing existing files over creating new ones
- Run relevant tests after making changes
- Be concise in your responses
- When executing commands, prefer non-destructive operations
- If a task is ambiguous, ask for clarification before proceeding
- Report what you did and what the results were

## Working Directory
You operate in the user's current working directory. All file paths are relative to this directory unless otherwise specified.

## Safety
- Some operations require user confirmation (write_file, edit_file, run_command, format, lint, git_add, git_commit, git_checkout)
- The user can auto-approve operations with the --auto-approve flag
- Never attempt to bypass safety checks

## Task Management
You have task-planning tools (todo_create_plan, todo_get_list, todo_update, todo_mark_done, todo_add_checkpoint). For complex multi-step tasks:
1. Start by creating a plan with todo_create_plan
2. Track progress by updating task status as you work
3. Add checkpoints to record important decisions
4. Review the plan with todo_get_list when needed
5. Mark tasks done when complete`;

// ---------------------------------------------------------------------------
// Dynamic project context (cached, refreshed every ~5 s)
// ---------------------------------------------------------------------------

interface CacheEntry {
  timestamp: number;
  content: string;
}

let projectStructureCache: CacheEntry | null = null;
let packageJsonCache: CacheEntry | null = null;
const CACHE_TTL = 5000;

function readProjectStructure(cwd: string): string {
  const now = Date.now();
  if (
    projectStructureCache &&
    now - projectStructureCache.timestamp < CACHE_TTL
  ) {
    return projectStructureCache.content;
  }

  try {
    const entries = readdirSync(cwd, { withFileTypes: true });
    const files: string[] = [];
    const dirs: string[] = [];
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      if (entry.isDirectory()) dirs.push(entry.name + "/");
      else files.push(entry.name);
    }
    // Prefer a compact single-line listing
    const all = [...dirs.sort(), ...files.sort()];
    const result =
      all.length > 0
        ? `Project structure:\n${all.map((e) => `  ${e}`).join("\n")}`
        : "(empty directory)";
    projectStructureCache = { timestamp: now, content: result };
    return result;
  } catch {
    return "(unable to read project structure)";
  }
}

function readPackageJson(cwd: string): string {
  const now = Date.now();
  if (
    packageJsonCache &&
    now - packageJsonCache.timestamp < CACHE_TTL
  ) {
    return packageJsonCache.content;
  }

  const pkgPath = join(cwd, "package.json");
  if (!existsSync(pkgPath)) return "";

  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    const parts: string[] = [];
    if (pkg.name) parts.push(`name: ${pkg.name}`);
    if (pkg.version) parts.push(`version: ${pkg.version}`);
    if (pkg.scripts) {
      const scripts = Object.entries(pkg.scripts as Record<string, string>)
        .map(([k, v]) => `    ${k}: ${v}`)
        .join("\n");
      parts.push(`scripts:\n${scripts}`);
    }
    if (pkg.dependencies) {
      const deps = Object.keys(pkg.dependencies as Record<string, string>).join(
        ", ",
      );
      parts.push(`dependencies: ${deps}`);
    }
    if (pkg.devDependencies) {
      const deps = Object.keys(
        pkg.devDependencies as Record<string, string>,
      ).join(", ");
      parts.push(`devDependencies: ${deps}`);
    }
    const result =
      parts.length > 0
        ? `Package info:\n  ${parts.join("\n  ")}`
        : "";
    packageJsonCache = { timestamp: now, content: result };
    return result;
  } catch {
    return "";
  }
}

/**
 * Build a project context block containing top-level file listing and
 * package.json summary. Cached to avoid repeated I/O during multi-step runs.
 */
export function buildProjectContext(cwd: string): string {
  const lines: string[] = [readProjectStructure(cwd)];
  const pkg = readPackageJson(cwd);
  if (pkg) lines.push(pkg);
  return lines.join("\n\n");
}

// ---------------------------------------------------------------------------
// Prompt assembly
// ---------------------------------------------------------------------------

export function buildSystemPrompt(cwd: string): string {
  return `${CODING_SYSTEM_PROMPT}\n\nCurrent working directory: ${cwd}`;
}

/**
 * Build a system prompt that also includes the current project context
 * (file layout, package.json) and the active task plan state.
 *
 * Called every agent step so the LLM always has up-to-date context.
 */
export function buildDynamicSystemPrompt(
  cwd: string,
  projectContext: string,
  taskSummary: string,
): string {
  const sections: string[] = [buildSystemPrompt(cwd)];

  if (projectContext) {
    sections.push(`## Project Context\n${projectContext}`);
  }

  if (taskSummary) {
    sections.push(taskSummary);
  }

  return sections.join("\n\n");
}
