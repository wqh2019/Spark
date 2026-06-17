import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { shellTools, setShellProjectDir } from "../../src/tools/shell.js";
import type { Tool } from "../../src/tools/index.js";

function getTool(name: string): Tool {
  const tool = shellTools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool not found: ${name}`);
  return tool;
}

describe("shellTools export", () => {
  it("exports run_command tool", () => {
    expect(shellTools).toHaveLength(1);
    expect(shellTools[0].name).toBe("run_command");
  });

  it("run_command requires confirmation", () => {
    const runCommand = getTool("run_command");
    expect(runCommand.requiresConfirmation).toBe(true);
  });
});

describe("run_command", () => {
  let tempDir: string;
  let runCommand: Tool;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "spark-shell-test-"));
    setShellProjectDir(tempDir);
    runCommand = getTool("run_command");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("executes a command and returns output", async () => {
    const result = await runCommand.execute({ command: "echo hello" });
    expect(result.trim()).toBe("hello");
  });

  it("returns non-zero exit code info", async () => {
    // Use a command that exits with non-zero code
    const isWindows = process.platform === "win32";
    const command = isWindows ? "exit /b 1" : "exit 1";
    const result = await runCommand.execute({ command });
    expect(result).toContain("Command exited with code 1");
  });

  it("handles timeout", async () => {
    // Use a command that sleeps longer than the timeout
    const isWindows = process.platform === "win32";
    // On Windows, `ping -n` can be used as a delay; on Unix, `sleep`
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
    // We verify the tool definition specifies the correct default in description
    const runCmd = getTool("run_command");
    const timeoutParam = runCmd.parameters.timeout as Record<string, unknown>;
    expect(timeoutParam).toBeDefined();
    expect(String(timeoutParam.description)).toContain("120000");
  });
});
