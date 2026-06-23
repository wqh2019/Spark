import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock child_process so we can assert execFile is/isn't called and with what
// arguments, without depending on real git/prettier/eslint binaries.
vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

import { execFile } from "node:child_process";
import { devTools, setDevProjectDir } from "../../src/tools/dev.js";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const isWindows = process.platform === "win32";

function getTool(name: string) {
  const t = devTools.find((x) => x.name === name);
  if (!t) throw new Error(`Tool not found: ${name}`);
  return t;
}

// Configure the execFile mock to invoke its callback with the given result.
function mockExecFileResult(result: {
  err?: Error | null;
  stdout?: string;
  stderr?: string;
}): void {
  vi.mocked(execFile).mockImplementation(((
    _file: string,
    _args: string[],
    _opts: unknown,
    cb: (err: Error | null, stdout: string, stderr: string) => void,
  ) => {
    cb(result.err ?? null, result.stdout ?? "", result.stderr ?? "");
    return undefined as unknown as import("node:child_process").ChildProcess;
  }) as unknown as typeof execFile);
}

describe("devTools command injection guards", () => {
  let tempDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tempDir = mkdtempSync(join(tmpdir(), "spark-inj-"));
    setDevProjectDir(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    setDevProjectDir(process.cwd());
  });

  describe("git_diff", () => {
    it("rejects shell injection in target", async () => {
      const gitDiff = getTool("git_diff");
      const result = await gitDiff.execute({ target: "HEAD; rm -rf /" });
      expect(result).toContain("invalid git ref");
      expect(execFile).not.toHaveBeenCalled();
    });

    it("rejects git option injection in target", async () => {
      const gitDiff = getTool("git_diff");
      const result = await gitDiff.execute({ target: "--output=/tmp/evil" });
      expect(result).toContain("invalid git ref");
      expect(execFile).not.toHaveBeenCalled();
    });

    it("accepts valid refs and calls execFile with arg array", async () => {
      mockExecFileResult({ stdout: "diff output" });
      const gitDiff = getTool("git_diff");

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
      await getTool("git_diff").execute({});
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
      const result = await getTool("format").execute({ path: "../../etc" });
      expect(result).toContain("outside project");
      expect(execFile).not.toHaveBeenCalled();
    });

    it.runIf(isWindows)("rejects path with cmd metacharacters on Windows", async () => {
      writeFileSync(join(tempDir, ".prettierrc"), "{}");
      const result = await getTool("format").execute({ path: "foo&bar" });
      expect(result).toContain("metacharacters");
      expect(execFile).not.toHaveBeenCalled();
    });

    it("accepts path with spaces and unicode", async () => {
      writeFileSync(join(tempDir, ".prettierrc"), "{}");
      mkdirSync(join(tempDir, "中文 目录"), { recursive: true });
      writeFileSync(join(tempDir, "中文 目录", "file.ts"), "export const x = 1;\n");

      mockExecFileResult({ stdout: "formatted" });
      const result = await getTool("format").execute({ path: "中文 目录" });
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
      const result = await getTool("lint").execute({ path: "../../etc" });
      expect(result).toContain("outside project");
      expect(execFile).not.toHaveBeenCalled();
    });

    it("accepts path with spaces and unicode", async () => {
      writeFileSync(join(tempDir, ".eslintrc.json"), "{}");
      mkdirSync(join(tempDir, "中文 目录"), { recursive: true });

      mockExecFileResult({ stdout: "linted" });
      const result = await getTool("lint").execute({ path: "中文 目录" });
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
