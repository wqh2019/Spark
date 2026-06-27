import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { devTools, setDevProjectDir, detectFormatterConfigs } from "../../src/tools/dev.js";
import type { Tool } from "../../src/tools/index.js";

function getTool(name: string): Tool {
  const tool = devTools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool not found: ${name}`);
  return tool;
}

describe("devTools export", () => {
  it("exports all 9 dev tools", () => {
    const names = devTools.map((t) => t.name);
    expect(names).toContain("git_status");
    expect(names).toContain("git_diff");
    expect(names).toContain("git_add");
    expect(names).toContain("git_commit");
    expect(names).toContain("git_log");
    expect(names).toContain("git_checkout");
    expect(names).toContain("format");
    expect(names).toContain("lint");
    expect(names).toContain("test");
    expect(devTools).toHaveLength(9);
  });

  it("format, lint, git_add, git_commit, git_checkout require confirmation", () => {
    expect(getTool("format").requiresConfirmation).toBe(true);
    expect(getTool("lint").requiresConfirmation).toBe(true);
    expect(getTool("git_add").requiresConfirmation).toBe(true);
    expect(getTool("git_commit").requiresConfirmation).toBe(true);
    expect(getTool("git_checkout").requiresConfirmation).toBe(true);
  });

  it("git_status, git_diff, git_log, and test do not require confirmation", () => {
    expect(getTool("git_status").requiresConfirmation).toBeFalsy();
    expect(getTool("git_diff").requiresConfirmation).toBeFalsy();
    expect(getTool("git_log").requiresConfirmation).toBeFalsy();
    expect(getTool("test").requiresConfirmation).toBeFalsy();
  });
});

describe("git_status", () => {
  it("returns string output", async () => {
    setDevProjectDir(process.cwd());
    const gitStatus = getTool("git_status");
    const result = await gitStatus.execute({});
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});

describe("git_diff", () => {
  it("returns string output", async () => {
    setDevProjectDir(process.cwd());
    const gitDiff = getTool("git_diff");
    const result = await gitDiff.execute({});
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});

describe("git_log (C4 new tool)", () => {
  it("returns string output", async () => {
    setDevProjectDir(process.cwd());
    const gitLog = getTool("git_log");
    const result = await gitLog.execute({});
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("respects max_count parameter", async () => {
    setDevProjectDir(process.cwd());
    const gitLog = getTool("git_log");
    const result = await gitLog.execute({ max_count: 3 });
    const lines = result.trim().split("\n");
    // Should have at most 3 lines (oneline format = 1 line per commit)
    expect(lines.length).toBeLessThanOrEqual(3);
  });
});

describe("git_add (C4 new tool)", () => {
  it("validates path arguments", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "spark-dev-test-"));
    setDevProjectDir(tempDir);
    try {
      const gitAdd = getTool("git_add");
      // Path outside project should be rejected
      const result = await gitAdd.execute({ path: "../../etc" });
      expect(result).toContain("outside project");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
      setDevProjectDir(process.cwd());
    }
  });
});

describe("git_commit (C4 new tool)", () => {
  it("rejects missing message", async () => {
    // git_commit is defined with required: ["message"]
    const gitCommit = getTool("git_commit");
    expect(gitCommit.required).toContain("message");
  });
});

describe("git_checkout (C4 new tool)", () => {
  it("validates target argument", async () => {
    const gitCheckout = getTool("git_checkout");
    // Injection attempt should be rejected
    const result = await gitCheckout.execute({
      target: "HEAD; rm -rf /",
    });
    expect(result).toContain("invalid target");
  });

  it("rejects missing target", () => {
    const gitCheckout = getTool("git_checkout");
    expect(gitCheckout.required).toContain("target");
  });
});

describe("detectFormatterConfigs", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "spark-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns false for both when no config found", () => {
    expect(detectFormatterConfigs(tempDir)).toEqual({ prettier: false, eslint: false });
  });

  it("detects prettier config", () => {
    writeFileSync(join(tempDir, ".prettierrc"), "{}");
    expect(detectFormatterConfigs(tempDir)).toEqual({ prettier: true, eslint: false });
  });

  it("detects eslint config", () => {
    writeFileSync(join(tempDir, ".eslintrc.json"), "{}");
    expect(detectFormatterConfigs(tempDir)).toEqual({ prettier: false, eslint: true });
  });

  it("detects both prettier and eslint configs", () => {
    writeFileSync(join(tempDir, ".prettierrc"), "{}");
    writeFileSync(join(tempDir, ".eslintrc.json"), "{}");
    expect(detectFormatterConfigs(tempDir)).toEqual({ prettier: true, eslint: true });
  });

  it("detects alternative eslint config files", () => {
    writeFileSync(join(tempDir, "eslint.config.js"), "");
    expect(detectFormatterConfigs(tempDir)).toEqual({ prettier: false, eslint: true });
  });

  it("detects alternative prettier config files", () => {
    writeFileSync(join(tempDir, "prettier.config.js"), "");
    expect(detectFormatterConfigs(tempDir)).toEqual({ prettier: true, eslint: false });
  });
});

describe("format tool skips when no config", () => {
  it("returns skip message when no config found", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "spark-test-"));
    setDevProjectDir(tempDir);
    try {
      const format = getTool("format");
      const result = await format.execute({});
      expect(result).toContain("No prettier or eslint configuration found");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
      setDevProjectDir(process.cwd());
    }
  });
});

describe("lint tool skips when no eslint config", () => {
  it("returns skip message when no eslint config found", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "spark-test-"));
    setDevProjectDir(tempDir);
    try {
      const lint = getTool("lint");
      const result = await lint.execute({});
      expect(result).toContain("No eslint configuration found");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
      setDevProjectDir(process.cwd());
    }
  });
});
