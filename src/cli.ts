#!/usr/bin/env node

import { Command } from "commander";
import { createInterface } from "node:readline";
import { Agent } from "./agent.js";
import { loadConfig, createDefaultConfig } from "./config.js";
import { LogLevel, setLogLevel } from "./logger.js";
import chalk from "chalk";
import {
  ConversationMemory,
  listSessions,
  getLatestSessionId,
} from "./memory.js";
import {
  renderError,
  renderInfo,
  renderSuccess,
  renderDivider,
  closeConfirmReadline,
} from "./render.js";
import { runWithSignal } from "./run-with-signal.js";

const program = new Command();

program
  .name("spark")
  .description("A CLI coding agent powered by AI")
  .version("0.1.0")
  .argument("[query]", "One-shot query to execute")
  .option("--continue", "Continue the last session")
  .option("--session <id>", "Resume a specific session")
  .option("--model <name>", "Model to use")
  .option("--api-key <key>", "API key (overrides OPENAI_API_KEY)")
  .option("--base-url <url>", "API base URL (overrides OPENAI_BASE_URL)")
  .option("--auto-approve", "Skip all confirmation prompts")
  .option("--verbose", "Enable verbose debug logging")
  .option("--max-steps <n>", "Maximum agent steps", parseInt)
  .option("--setup", "Create a default config file at ~/.spark/config.json")
  .action(async (query, opts) => {
    // Handle --setup separately: create config template and exit
    if (opts.setup) {
      createDefaultConfig();
      console.log(chalk.green("✔ Config file created at ~/.spark/config.json"));
      console.log(`Edit it and replace "${chalk.yellow("sk-your-key-here")}" with your actual API key.`);
      return;
    }
    if (opts.verbose) {
      setLogLevel(LogLevel.DEBUG);
    }

    let config;
    try {
      config = loadConfig({
        apiKey: opts.apiKey,
        baseURL: opts.baseUrl,
        model: opts.model,
        maxSteps: opts.maxSteps,
        autoApprove: opts.autoApprove ? ["*"] : undefined,
      });
    } catch (err) {
      renderError(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }

    let sessionId: string | undefined;
    if (opts.session) {
      sessionId = opts.session;
    } else if (opts.continue) {
      sessionId = getLatestSessionId();
      if (!sessionId) {
        renderError("No previous session found to continue.");
        process.exit(1);
      }
      renderInfo(`Continuing session: ${sessionId}`);
    }

    const memory = new ConversationMemory(50, sessionId);
    if (sessionId) {
      memory.loadFromDisk();
    }

    const agent = new Agent(config, memory);

    if (query) {
      await runWithSignal(agent, query);
      return;
    }

    await interactiveLoop(agent);
  });

program
  .command("config")
  .description("View current configuration")
  .action(() => {
    try {
      const config = loadConfig();
      console.log("Current configuration:");
      console.log(
        `  API Key: ${config.apiKey ? "***" + config.apiKey.slice(-4) : "(not set)"}`,
      );
      console.log(`  Base URL: ${config.baseURL}`);
      console.log(`  Model: ${config.model}`);
      console.log(`  Max Steps: ${config.maxSteps}`);
      console.log(
        `  Auto Approve: ${config.autoApprove.length > 0 ? config.autoApprove.join(", ") : "(none)"}`,
      );
    } catch (err) {
      renderError(err instanceof Error ? err.message : String(err));
    }
  });

program
  .command("sessions")
  .description("List previous sessions")
  .action(() => {
    const sessions = listSessions();
    if (sessions.length === 0) {
      console.log("No sessions found.");
      return;
    }
    console.log("Sessions:");
    for (const id of sessions) {
      console.log(`  ${id}`);
    }
  });

export { runWithSignal } from "./run-with-signal.js";

// -----------------------------------------------------------------------
// Interactive loop with colon commands & readline history
// -----------------------------------------------------------------------

async function interactiveLoop(agent: Agent): Promise<void> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    // Enable persistent command history across sessions
    historySize: 100,
  });

  const question = (prompt: string): Promise<string> =>
    new Promise((resolve) => rl.question(prompt, resolve));

  renderDivider();
  renderInfo("Spark coding agent — Type your message, or use :help");
  renderInfo(`Session: ${agent.sessionId}`);
  renderInfo("Ctrl+C to interrupt | \"\"\" for multi-line input | :command");
  renderDivider();

  while (true) {
    const input = await question("\n> ");
    const trimmed = input.trim();

    if (!trimmed) continue;

    // --- Colon commands ---
    if (trimmed.startsWith(":")) {
      const handled = await handleColonCommand(trimmed, agent);
      if (handled === "exit") {
        rl.close();
        break;
      }
      continue;
    }

    // --- Exit ---
    if (trimmed === "exit" || trimmed === "quit") {
      renderInfo("Goodbye!");
      rl.close();
      break;
    }

    // --- Multi-line mode ---
    let message = input;
    if (trimmed === '"""') {
      const lines: string[] = [];
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const line = await question("... ");
        if (line.trim() === '"""') break;
        lines.push(line);
      }
      message = lines.join("\n");
      if (!message.trim()) continue;
    }

    await runWithSignal(agent, message);

    // Show session cost summary after each response
    const report = agent["tokenTracker"].getReport();
    if (report.stepCount > 0) {
      renderDivider();
      renderInfo(
        `Session: ${report.sessionTotalTokens.toLocaleString()} tokens · $${report.estimatedCost.toFixed(4)} · ${report.stepCount} steps`,
      );
    }
  }
}

/** Handle colon-prefixed commands. Returns "exit" to terminate the loop. */
async function handleColonCommand(
  cmd: string,
  agent: Agent,
): Promise<"exit" | void> {
  const parts = cmd.slice(1).split(/\s+/);
  const command = parts[0].toLowerCase();
  const args = parts.slice(1);

  switch (command) {
    case "help":
    case "?":
      console.log(`
  :help        Show this help
  :plan        Show current task plan
  :tokens      Show session token usage & cost
  :sessions    List previous sessions
  :session     <id>  Resume a specific session
  :continue    Continue the last session
  :clear       Clear the terminal screen
  :exit        Exit the program
      `);
      break;

    case "plan":
      console.log(agent["taskPlanner"].getSummary() || "No active plan.");
      break;

    case "tokens":
    case "cost":
      console.log(agent["tokenTracker"].getSummary());
      break;

    case "sessions": {
      const sessions = listSessions();
      if (sessions.length === 0) {
        renderInfo("No sessions found.");
      } else {
        renderInfo(`Sessions (${sessions.length}):`);
        for (const id of sessions) {
          console.log(`  ${id}`);
        }
      }
      break;
    }

    case "session":
      if (args.length === 0) {
        renderError("Usage: :session <id>");
      } else {
        renderInfo(`Session switching not yet supported in interactive mode. Use --session ${args[0]} on startup.`);
      }
      break;

    case "continue":
      renderInfo("Use 'spark --continue' at startup to continue the last session.");
      break;

    case "clear":
      // ANSI escape sequence to clear screen
      process.stdout.write("\x1b[2J\x1b[H");
      break;

    case "exit":
    case "quit":
      return "exit";

    default:
      renderError(`Unknown command: :${command}. Type :help for available commands.`);
  }
}

program.parse();

process.on("exit", () => closeConfirmReadline());
