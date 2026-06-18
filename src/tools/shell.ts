import { exec } from "node:child_process";
import type { Tool } from "./index.js";
import { SafetyChecker } from "../safety.js";

let projectDir = process.cwd();
let safetyChecker = new SafetyChecker({ projectRoot: projectDir });

export function setShellProjectDir(dir: string): void {
  projectDir = dir;
  safetyChecker = new SafetyChecker({ projectRoot: dir });
}

const DEFAULT_TIMEOUT = 120_000;

const runCommand: Tool = {
  name: "run_command",
  description:
    "Execute a shell command. Uses cmd /c on Windows, /bin/bash -c on other platforms.",
  parameters: {
    command: { type: "string", description: "Shell command to execute" },
    timeout: {
      type: "number",
      description: "Timeout in milliseconds (default: 120000)",
    },
  },
  required: ["command"],
  requiresConfirmation: true,
  async execute(args) {
    const command = String(args.command);
    const timeout = args.timeout ? Number(args.timeout) : DEFAULT_TIMEOUT;

    try {
      safetyChecker.checkCommand(command);
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }

    return new Promise((resolve) => {
      const isWindows = process.platform === "win32";
      const shellCmd = isWindows ? `cmd /c ${command}` : `/bin/bash -c ${command}`;

      exec(
        shellCmd,
        { timeout, maxBuffer: 10 * 1024 * 1024 },
        (error, stdout, stderr) => {
          if (error) {
            if (error.killed) {
              resolve(`Command timed out after ${timeout}ms`);
              return;
            }
            if (error.code !== undefined && error.code !== 0) {
              resolve(`Command exited with code ${error.code}`);
              return;
            }
          }

          let output = "";
          if (stdout) output += stdout;
          if (stderr) output += (output ? "\n" : "") + stderr;
          resolve(output || "(no output)");
        },
      );
    });
  },
};

export const shellTools: Tool[] = [runCommand];
