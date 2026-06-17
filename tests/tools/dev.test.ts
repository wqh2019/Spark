import { describe, it, expect } from "vitest";
import { devTools, setDevProjectDir } from "../../src/tools/dev.js";
import type { Tool } from "../../src/tools/index.js";

function getTool(name: string): Tool {
  const tool = devTools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool not found: ${name}`);
  return tool;
}

describe("devTools export", () => {
  it("exports all 3 dev tools", () => {
    const names = devTools.map((t) => t.name);
    expect(names).toContain("git_status");
    expect(names).toContain("git_diff");
    expect(names).toContain("format");
    expect(devTools).toHaveLength(3);
  });

  it("format requires confirmation", () => {
    const format = getTool("format");
    expect(format.requiresConfirmation).toBe(true);
  });

  it("git_status does not require confirmation", () => {
    const gitStatus = getTool("git_status");
    expect(gitStatus.requiresConfirmation).toBeFalsy();
  });

  it("git_diff does not require confirmation", () => {
    const gitDiff = getTool("git_diff");
    expect(gitDiff.requiresConfirmation).toBeFalsy();
  });
});

describe("git_status", () => {
  it("returns string output", async () => {
    // Point to project root so git status works
    setDevProjectDir(process.cwd());
    const gitStatus = getTool("git_status");
    const result = await gitStatus.execute({});
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});

describe("git_diff", () => {
  it("returns string output", async () => {
    // Point to project root so git diff works
    setDevProjectDir(process.cwd());
    const gitDiff = getTool("git_diff");
    const result = await gitDiff.execute({});
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});
