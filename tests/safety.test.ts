import { describe, it, expect } from "vitest";
import { SafetyChecker, requiresConfirmation } from "../src/safety.js";

describe("SafetyChecker", () => {
  const projectRoot = process.cwd();
  let checker: SafetyChecker;

  beforeEach(() => {
    checker = new SafetyChecker({ projectRoot });
  });

  // --- checkPath ---

  it("allows paths inside project root", () => {
    expect(() => checker.checkPath(projectRoot + "/src/index.ts")).not.toThrow();
    expect(() => checker.checkPath(projectRoot + "/package.json")).not.toThrow();
  });

  it("blocks paths outside project root", () => {
    expect(() => checker.checkPath("/etc/passwd")).toThrow("outside project");
    expect(() => checker.checkPath("/tmp/evil")).toThrow("outside project");
  });

  it("blocks path traversal with ..", () => {
    expect(() => checker.checkPath(projectRoot + "/../../../etc/passwd")).toThrow(
      "outside project",
    );
  });

  it("resolves relative paths against project root", () => {
    // Relative paths resolve to CWD which should be the project root
    expect(() => checker.checkPath("src/index.ts")).not.toThrow();
  });

  // --- checkCommand ---

  it("allows safe commands", () => {
    expect(() => checker.checkCommand("npm test")).not.toThrow();
    expect(() => checker.checkCommand("git status")).not.toThrow();
    expect(() => checker.checkCommand("ls -la")).not.toThrow();
    expect(() => checker.checkCommand("echo hello")).not.toThrow();
  });

  it("blocks rm -rf /", () => {
    expect(() => checker.checkCommand("rm -rf /")).toThrow("Blocked command");
  });

  it("blocks rm -rf /*", () => {
    expect(() => checker.checkCommand("rm -rf /*")).toThrow("Blocked command");
  });

  it("blocks sudo commands", () => {
    expect(() => checker.checkCommand("sudo rm something")).toThrow(
      "Blocked command",
    );
  });

  it("blocks mkfs", () => {
    expect(() => checker.checkCommand("mkfs /dev/sda")).toThrow(
      "Blocked command",
    );
  });

  it("blocks dd if=", () => {
    expect(() => checker.checkCommand("dd if=/dev/zero of=/dev/sda")).toThrow(
      "Blocked command",
    );
  });

  it("blocks case-insensitively", () => {
    expect(() => checker.checkCommand("SUDO apt install")).toThrow(
      "Blocked command",
    );
  });

  it("allows custom blocked commands", () => {
    const customChecker = new SafetyChecker({
      projectRoot,
      blockedCommands: ["dangerous_cmd"],
    });
    expect(() => customChecker.checkCommand("dangerous_cmd --flag")).toThrow(
      "Blocked command",
    );
    // Default blocked patterns no longer apply
    expect(() => customChecker.checkCommand("rm -rf /")).not.toThrow();
  });

  // --- checkFileSize ---

  it("allows files within size limit", () => {
    expect(() => checker.checkFileSize(1024)).not.toThrow();
    expect(() => checker.checkFileSize(10 * 1024 * 1024)).not.toThrow();
  });

  it("blocks files exceeding size limit", () => {
    expect(() => checker.checkFileSize(10 * 1024 * 1024 + 1)).toThrow(
      "exceeds limit",
    );
  });

  it("respects custom maxFileSize", () => {
    const smallChecker = new SafetyChecker({ projectRoot, maxFileSize: 100 });
    expect(() => smallChecker.checkFileSize(100)).not.toThrow();
    expect(() => smallChecker.checkFileSize(101)).toThrow("exceeds limit");
  });

  // --- requiresConfirmation ---

  it("marks write_file as requiring confirmation", () => {
    expect(requiresConfirmation("write_file")).toBe(true);
  });

  it("marks edit_file as requiring confirmation", () => {
    expect(requiresConfirmation("edit_file")).toBe(true);
  });

  it("marks run_command as requiring confirmation", () => {
    expect(requiresConfirmation("run_command")).toBe(true);
  });

  it("marks format as requiring confirmation", () => {
    expect(requiresConfirmation("format")).toBe(true);
  });

  it("marks read_file as not requiring confirmation", () => {
    expect(requiresConfirmation("read_file")).toBe(false);
  });

  it("marks list_dir as not requiring confirmation", () => {
    expect(requiresConfirmation("list_dir")).toBe(false);
  });

  it("marks glob_files as not requiring confirmation", () => {
    expect(requiresConfirmation("glob_files")).toBe(false);
  });

  it("marks grep_content as not requiring confirmation", () => {
    expect(requiresConfirmation("grep_content")).toBe(false);
  });

  it("marks git_status as not requiring confirmation", () => {
    expect(requiresConfirmation("git_status")).toBe(false);
  });

  it("marks git_diff as not requiring confirmation", () => {
    expect(requiresConfirmation("git_diff")).toBe(false);
  });

  it("returns false for unknown tools", () => {
    expect(requiresConfirmation("unknown_tool")).toBe(false);
  });
});
