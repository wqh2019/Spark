import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createShellTools } from "../../src/tools/shell.js";
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

describe("createShellTools export", () => {
  it("exports run_command tool", () => {
    const ctx = makeContext(process.cwd());
    const tools = createShellTools(ctx);
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("run_command");
  });

  it("run_command requires confirmation", () => {
    const ctx = makeContext(process.cwd());
    const runCommand = getTool(createShellTools(ctx), "run_command");
    expect(runCommand.requiresConfirmation).toBe(true);
  });
});

describe("run_command", () => {
  let tempDir: string;
  let runCommand: Tool;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "spark-shell-test-"));
    const ctx = makeContext(tempDir);
    runCommand = getTool(createShellTools(ctx), "run_command");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("executes a command and returns output", async () => {
    const result = await runCommand.execute({ command: "echo hello" });
    expect(result.trim()).toBe("hello");
  });

  it("returns non-zero exit code info", async () => {
    const isWindows = process.platform === "win32";
    const command = isWindows ? "exit /b 1" : "exit 1";
    const result = await runCommand.execute({ command });
    expect(result).toContain("Command exited with code 1");
  });

  it("handles timeout", async () => {
    const isWindows = process.platform === "win32";
    const command = isWindows
      ? "ping -n 10 127.0.0.1 >nul"
      : "sleep 10";
    const result = await runCommand.execute({ command, timeout: 1000 });
    expect(result).toContain("Command timed out after 1000ms");
  }, 15000);

  it("returns (no output) for commands with no output", async () => {
    const isWindows = process.platform === "win32";
    const command = isWindows ? "cd ." : "true";
    const result = await runCommand.execute({ command });
    expect(result).toBe("(no output)");
  });

  it("uses default timeout of 120000ms", async () => {
    const ctx = makeContext(process.cwd());
    const runCmd = getTool(createShellTools(ctx), "run_command");
    const timeoutParam = runCmd.parameters.timeout as Record<string, unknown>;
    expect(timeoutParam).toBeDefined();
    expect(String(timeoutParam.description)).toContain("120000");
  });
});
