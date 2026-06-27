import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock child_process so we can assert execFile is/isn't called and with what
// arguments, without depending on real git/prettier/eslint binaries.
vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

import { execFile } from "node:child_process";
import { createDevTools } from "../../src/tools/dev.js";
import type { ToolContext } from "../../src/tools/index.js";
import type { Tool } from "../../src/tools/index.js";
import { SafetyChecker } from "../../src/safety.js";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const isWindows = process.platform === "win32";

function makeContext(dir: string): ToolContext {
  return {
    projectDir: dir,
    safetyChecker: new SafetyChecker({ projectRoot: dir }),
  };
}

function getTool(tools: Tool[], name: string): Tool {
  const t = tools.find((x) => x.name === name);
  if (!t) throw new Error(`Tool not found: ${name}`);
  return t;
}

// Configure the execFile mock to invoke its callback with the given result.
function mockExecFileResult(result: {
  err?: Error | null;
  stdout?: string;
  stderr?: string;
}): void {
  vi.mocked(execFile).mockImplementation((((
    _file: string,
    _args: string[],
    _opts: unknown,
    cb: (err: Error | null, stdout: string, stderr: string) => void,
  ) => {
    cb(result.err ?? null, result.stdout ?? "", result.stderr ?? "");
    return undefined as unknown as import("node:child_process").ChildProcess;
  }) as unknown) as typeof execFile);
}

describe("devTools command injection guards", () => {
  let tempDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tempDir = mkdtempSync(join(tmpdir(), "spark-inj-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("git_diff", () => {
    it("rejects shell injection in target", async () => {
      const ctx = makeContext(tempDir);
      const tools = createDevTools(ctx);
      const gitDiff = getTool(tools, "git_diff");
      const result = await gitDiff.execute({ target: "HEAD; rm -rf /" });
      expect(result).toContain("invalid git ref");
      expect(execFile).not.toHaveBeenCalled();
    });

    it("rejects git option injection in target", async () => {
      const ctx = makeContext(tempDir);
      const tools = createDevTools(ctx);
      const gitDiff = getTool(tools, "git_diff");
      const result = await gitDiff.execute({ target: "--output=/tmp/evil" });
      expect(result).toContain("invalid git ref");
      expect(execFile).not.toHaveBeenCalled();
    });

    it("accepts valid refs and calls execFile with arg array", async () => {
      mockExecFileResult({ stdout: "diff output" });
      const ctx = makeContext(tempDir);
      const tools = createDevTools(ctx);
      const gitDiff = getTool(tools, "git_diff");

      await gitDiff.execute({ target: "main" });
      expect(execFile).toHaveBeenCalledWith(
        "git",
        ["diff", "main"],
        expect.any(Object),
        expect.any(Function),
      );

      vi.clearAllMocks();
      mockExecFileResult({ stdout: "diff output" });
      await gitDiff.execute({ target: "origin/main" });
      expect(execFile).toHaveBeenCalledWith(
        "git",
        ["diff", "origin/main"],
        expect.any(Object),
        expect.any(Function),
      );
    });

    it("defaults target to HEAD when not provided", async () => {
      mockExecFileResult({ stdout: "diff output" });
      const ctx = makeContext(tempDir);
      const tools = createDevTools(ctx);
      await getTool(tools, "git_diff").execute({});
      expect(execFile).toHaveBeenCalledWith(
        "git",
        ["diff", "HEAD"],
        expect.any(Object),
        expect.any(Function),
      );
    });
  });

  describe("format path validation", () => {
    it("rejects path outside project", async () => {
      writeFileSync(join(tempDir, ".prettierrc"), "{}");
      const ctx = makeContext(tempDir);
      const tools = createDevTools(ctx);
      const result = await getTool(tools, "format").execute({ path: "../../etc" });
      expect(result).toContain("outside project");
      expect(execFile).not.toHaveBeenCalled();
    });

    it.runIf(isWindows)("rejects path with cmd metacharacters on Windows", async () => {
      writeFileSync(join(tempDir, ".prettierrc"), "{}");
      const ctx = makeContext(tempDir);
      const tools = createDevTools(ctx);
      const result = await getTool(tools, "format").execute({ path: "foo&bar" });
      expect(result).toContain("metacharacters");
      expect(execFile).not.toHaveBeenCalled();
    });

    it("accepts path with spaces and unicode", async () => {
      writeFileSync(join(tempDir, ".prettierrc"), "{}");
      mkdirSync(join(tempDir, "中文 目录"), { recursive: true });
      writeFileSync(join(tempDir, "中文 目录", "file.ts"), "export const x = 1;\n");

      mockExecFileResult({ stdout: "formatted" });
      const ctx = makeContext(tempDir);
      const tools = createDevTools(ctx);
      const result = await getTool(tools, "format").execute({ path: "中文 目录" });
      expect(result).not.toContain("Error:");
      expect(execFile).toHaveBeenCalledWith(
        "npx",
        ["prettier", "--write", "中文 目录"],
        expect.any(Object),
        expect.any(Function),
      );
    });
  });

  describe("lint path validation", () => {
    it("rejects path outside project", async () => {
      writeFileSync(join(tempDir, ".eslintrc.json"), "{}");
      const ctx = makeContext(tempDir);
      const tools = createDevTools(ctx);
      const result = await getTool(tools, "lint").execute({ path: "../../etc" });
      expect(result).toContain("outside project");
      expect(execFile).not.toHaveBeenCalled();
    });

    it("accepts path with spaces and unicode", async () => {
      writeFileSync(join(tempDir, ".eslintrc.json"), "{}");
      mkdirSync(join(tempDir, "中文 目录"), { recursive: true });

      mockExecFileResult({ stdout: "linted" });
      const ctx = makeContext(tempDir);
      const tools = createDevTools(ctx);
      const result = await getTool(tools, "lint").execute({ path: "中文 目录" });
      expect(result).not.toContain("Error:");
      expect(execFile).toHaveBeenCalledWith(
        "npx",
        ["eslint", "中文 目录"],
        expect.any(Object),
        expect.any(Function),
      );
    });
  });
});
