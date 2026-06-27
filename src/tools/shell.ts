import { spawn } from "node:child_process";
import type { Tool } from "./index.js";
import { SafetyChecker } from "../safety.js";

let projectDir = process.cwd();
let safetyChecker = new SafetyChecker({ projectRoot: projectDir });

export function setShellProjectDir(dir: string): void {
  projectDir = dir;
  safetyChecker = new SafetyChecker({ projectRoot: dir });
}

const DEFAULT_TIMEOUT = 120_000;

/** Maximum characters collected from stderr before truncating (prevents output explosion). */
const MAX_STDERR_CHARS = 10_000;

const runCommand: Tool = {
  name: "run_command",
  description:
    "Execute a shell command with real-time streaming output. Uses cmd /c on Windows, /bin/bash -c on other platforms.",
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

    return new Promise((resolvePromise) => {
      const isWindows = process.platform === "win32";

      let shell: string;
      let shellArgs: string[];

      if (isWindows) {
        const escaped = command.replace(/%/g, "%%").replace(/"/g, '\\"');
        shell = "cmd";
        shellArgs = ["/d", "/c", escaped];
      } else {
        shell = "/bin/bash";
        shellArgs = ["-c", command];
      }

      const child = spawn(shell, shellArgs, {
        cwd: projectDir,
        timeout,
        windowsHide: true,
      });

      let stdout = "";
      let stderr = "";

      child.stdout?.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr?.on("data", (data: Buffer) => {
        const text = data.toString();
        // Limit stderr collection to prevent output explosion
        if (stderr.length < MAX_STDERR_CHARS) {
          stderr += text;
        }
      });

      child.on("error", (err) => {
        if ((err as NodeJS.ErrnoException).code === "ERR_CHILD_PROCESS_TIMEOUT") {
          resolvePromise(`Command timed out after ${timeout}ms`);
          return;
        }
        resolvePromise(`Error: ${err.message}`);
      });

      child.on("close", (code) => {
        if (code !== null && code !== 0) {
          let output = "";
          if (stderr) {
            output += stderr;
            if (stderr.length >= MAX_STDERR_CHARS) {
              output += "\n... (stderr truncated)";
            }
          }
          if (stdout) {
            output += (output ? "\n" : "") + stdout;
          }
          output += `\nCommand exited with code ${code}`;
          resolvePromise(output);
          return;
        }

        let output = "";
        if (stdout) output += stdout;
        if (stderr) {
          output += (output ? "\n" : "") + stderr;
        }
        resolvePromise(output || "(no output)");
      });
    });
  },
};

export const shellTools: Tool[] = [runCommand];
