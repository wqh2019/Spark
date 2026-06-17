import { describe, it, expect } from "vitest";
import { SafetyChecker, requiresConfirmation } from "../src/safety.js";

describe("SafetyChecker", () => {
  const projectRoot = "/home/user/project";

  describe("checkPath", () => {
    it("allows paths inside project root", () => {
      const checker = new SafetyChecker({ projectRoot });
      expect(() => checker.checkPath("/home/user/project/src/index.ts")).not.toThrow();
    });

    it("rejects paths outside project root", () => {
      const checker = new SafetyChecker({ projectRoot });
      expect(() => checker.checkPath("/etc/passwd")).toThrow(/outside project/i);
    });

    it("rejects path traversal with ..", () => {
      const checker = new SafetyChecker({ projectRoot });
      expect(() => checker.checkPath("/home/user/project/../../etc/passwd")).toThrow(
        /outside project/i
      );
    });

    it("allows the project root itself", () => {
      const checker = new SafetyChecker({ projectRoot });
      expect(() => checker.checkPath(projectRoot)).not.toThrow();
    });

    it("rejects a path that is a sibling of project root", () => {
      const checker = new SafetyChecker({ projectRoot });
      expect(() => checker.checkPath("/home/user/other")).toThrow(/outside project/i);
    });
  });

  describe("checkCommand", () => {
    it("allows normal commands", () => {
      const checker = new SafetyChecker({ projectRoot });
      expect(() => checker.checkCommand("ls -la")).not.toThrow();
      expect(() => checker.checkCommand("npm test")).not.toThrow();
      expect(() => checker.checkCommand("git status")).not.toThrow();
    });

    it("rejects rm -rf /", () => {
      const checker = new SafetyChecker({ projectRoot });
      expect(() => checker.checkCommand("rm -rf /")).toThrow(/blocked/i);
    });

    it("rejects rm -rf /*", () => {
      const checker = new SafetyChecker({ projectRoot });
      expect(() => checker.checkCommand("rm -rf /*")).toThrow(/blocked/i);
    });

    it("rejects sudo", () => {
      const checker = new SafetyChecker({ projectRoot });
      expect(() => checker.checkCommand("sudo apt install foo")).toThrow(/blocked/i);
    });

    it("rejects mkfs", () => {
      const checker = new SafetyChecker({ projectRoot });
      expect(() => checker.checkCommand("mkfs.ext4 /dev/sda1")).toThrow(/blocked/i);
    });

    it("rejects dd if=", () => {
      const checker = new SafetyChecker({ projectRoot });
      expect(() => checker.checkCommand("dd if=/dev/zero of=/dev/sda")).toThrow(/blocked/i);
    });

    it("rejects fork bomb", () => {
      const checker = new SafetyChecker({ projectRoot });
      expect(() => checker.checkCommand(":(){:|:&};:")).toThrow(/blocked/i);
    });

    it("rejects > /dev/sda", () => {
      const checker = new SafetyChecker({ projectRoot });
      expect(() => checker.checkCommand("> /dev/sda")).toThrow(/blocked/i);
    });

    it("blocks commands case-insensitively", () => {
      const checker = new SafetyChecker({ projectRoot });
      expect(() => checker.checkCommand("SUDO rm -rf /")).toThrow(/blocked/i);
    });

    it("allows custom blocked commands via constructor", () => {
      const checker = new SafetyChecker({ projectRoot, blockedCommands: ["dangerous"] });
      expect(() => checker.checkCommand("dangerous operation")).toThrow(/blocked/i);
      // Normal commands still allowed
      expect(() => checker.checkCommand("npm test")).not.toThrow();
    });
  });

  describe("maxFileSize", () => {
    it("defaults to 10MB", () => {
      const checker = new SafetyChecker({ projectRoot });
      expect(checker.maxFileSize).toBe(10 * 1024 * 1024);
    });

    it("accepts custom maxFileSize", () => {
      const checker = new SafetyChecker({ projectRoot, maxFileSize: 1024 });
      expect(checker.maxFileSize).toBe(1024);
    });
  });
});

describe("requiresConfirmation", () => {
  it("returns true for write_file", () => {
    expect(requiresConfirmation("write_file")).toBe(true);
  });

  it("returns true for edit_file", () => {
    expect(requiresConfirmation("edit_file")).toBe(true);
  });

  it("returns true for run_command", () => {
    expect(requiresConfirmation("run_command")).toBe(true);
  });

  it("returns true for format", () => {
    expect(requiresConfirmation("format")).toBe(true);
  });

  it("returns false for read_file", () => {
    expect(requiresConfirmation("read_file")).toBe(false);
  });

  it("returns false for glob", () => {
    expect(requiresConfirmation("glob")).toBe(false);
  });

  it("returns false for grep", () => {
    expect(requiresConfirmation("grep")).toBe(false);
  });

  it("returns false for list_dir", () => {
    expect(requiresConfirmation("list_dir")).toBe(false);
  });

  it("returns false for git_status", () => {
    expect(requiresConfirmation("git_status")).toBe(false);
  });

  it("returns false for git_diff", () => {
    expect(requiresConfirmation("git_diff")).toBe(false);
  });

  it("returns false for unknown tool names", () => {
    expect(requiresConfirmation("unknown")).toBe(false);
  });
});
