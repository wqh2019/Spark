import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDevTools, detectFormatterConfigs } from "../../src/tools/dev.js";
import type { ToolContext } from "../../src/tools/index.js";
import type { Tool } from "../../src/tools/index.js";
import { SafetyChecker } from "../../src/safety.js";

function makeContext(dir: string): ToolContext {
  return {
    projectDir: dir,
    safetyChecker: new SafetyChecker({ projectRoot: dir }),
  };
}

function getTool(tools: Tool[], name: string): Tool {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool not found: ${name}`);
  return tool;
}

describe("createDevTools export", () => {
  const ctx = makeContext(process.cwd());

  it("exports all 11 dev tools", () => {
    const tools = createDevTools(ctx);
    const names = tools.map((t) => t.name);
    expect(names).toContain("git_status");
    expect(names).toContain("git_diff");
    expect(names).toContain("git_add");
    expect(names).toContain("git_commit");
    expect(names).toContain("git_log");
    expect(names).toContain("git_checkout");
    expect(names).toContain("git_stash");
    expect(names).toContain("git_stash_pop");
    expect(names).toContain("format");
    expect(names).toContain("lint");
    expect(names).toContain("test");
    expect(tools).toHaveLength(11);
  });

  it("format, lint, git_add, git_commit, git_checkout require confirmation", () => {
    const tools = createDevTools(ctx);
    expect(getTool(tools, "format").requiresConfirmation).toBe(true);
    expect(getTool(tools, "lint").requiresConfirmation).toBe(true);
    expect(getTool(tools, "git_add").requiresConfirmation).toBe(true);
    expect(getTool(tools, "git_commit").requiresConfirmation).toBe(true);
    expect(getTool(tools, "git_checkout").requiresConfirmation).toBe(true);
  });

  it("git_status, git_diff, git_log, and test do not require confirmation", () => {
    const tools = createDevTools(ctx);
    expect(getTool(tools, "git_status").requiresConfirmation).toBeFalsy();
    expect(getTool(tools, "git_diff").requiresConfirmation).toBeFalsy();
    expect(getTool(tools, "git_log").requiresConfirmation).toBeFalsy();
    expect(getTool(tools, "test").requiresConfirmation).toBeFalsy();
  });
});

describe("git_status", () => {
  it("returns string output", async () => {
    const ctx = makeContext(process.cwd());
    const tools = createDevTools(ctx);
    const gitStatus = getTool(tools, "git_status");
    const result = await gitStatus.execute({});
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});

describe("git_diff", () => {
  it("returns string output", async () => {
    const ctx = makeContext(process.cwd());
    const tools = createDevTools(ctx);
    const gitDiff = getTool(tools, "git_diff");
    const result = await gitDiff.execute({});
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});

describe("git_log (C4 new tool)", () => {
  it("returns string output", async () => {
    const ctx = makeContext(process.cwd());
    const tools = createDevTools(ctx);
    const gitLog = getTool(tools, "git_log");
    const result = await gitLog.execute({});
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("respects max_count parameter", async () => {
    const ctx = makeContext(process.cwd());
    const tools = createDevTools(ctx);
    const gitLog = getTool(tools, "git_log");
    const result = await gitLog.execute({ max_count: 3 });
    const lines = result.trim().split("\n");
    expect(lines.length).toBeLessThanOrEqual(3);
  });
});

describe("git_add (C4 new tool)", () => {
  it("validates path arguments", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "spark-dev-test-"));
    const ctx = makeContext(tempDir);
    const tools = createDevTools(ctx);
    try {
      const gitAdd = getTool(tools, "git_add");
      const result = await gitAdd.execute({ path: "../../etc" });
      expect(result).toContain("outside project");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe("git_commit (C4 new tool)", () => {
  it("rejects missing message", async () => {
    const ctx = makeContext(process.cwd());
    const gitCommit = getTool(createDevTools(ctx), "git_commit");
    expect(gitCommit.required).toContain("message");
  });
});

describe("git_checkout (C4 new tool)", () => {
  it("validates target argument", async () => {
    const ctx = makeContext(process.cwd());
    const gitCheckout = getTool(createDevTools(ctx), "git_checkout");
    const result = await gitCheckout.execute({
      target: "HEAD; rm -rf /",
    });
    expect(result).toContain("invalid target");
  });

  it("rejects missing target", () => {
    const ctx = makeContext(process.cwd());
    const gitCheckout = getTool(createDevTools(ctx), "git_checkout");
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
    const ctx = makeContext(tempDir);
    const tools = createDevTools(ctx);
    try {
      const format = getTool(tools, "format");
      const result = await format.execute({});
      expect(result).toContain("No prettier or eslint configuration found");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe("lint tool skips when no eslint config", () => {
  it("returns skip message when no eslint config found", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "spark-test-"));
    const ctx = makeContext(tempDir);
    const tools = createDevTools(ctx);
    try {
      const lint = getTool(tools, "lint");
      const result = await lint.execute({});
      expect(result).toContain("No eslint configuration found");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
