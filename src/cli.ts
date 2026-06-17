#!/usr/bin/env node

import { Command } from "commander";
import { createInterface } from "node:readline";
import { Agent } from "./agent.js";
import { loadConfig } from "./config.js";
import { ConversationMemory, listSessions, getLatestSessionId } from "./memory.js";
import { renderError, renderInfo } from "./render.js";

const program = new Command();

program
  .name("spark")
  .description("A CLI coding agent powered by AI")
  .version("0.1.0")
  .argument("[query]", "One-shot query to execute")
  .option("--continue", "Continue the last session")
  .option("--session <id>", "Resume a specific session")
  .option("--model <name>", "Model to use")
  .option("--auto-approve", "Skip all confirmation prompts")
  .option("--max-steps <n>", "Maximum agent steps", parseInt)
  .action(async (query, opts) => {
    let config;
    try {
      config = loadConfig({
        model: opts.model,
        maxSteps: opts.maxSteps,
        autoApprove: opts.autoApprove ? ["*"] : undefined,
      });
    } catch (err) {
      renderError(
        err instanceof Error ? err.message : String(err),
      );
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
      await agent.run(query);
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
      renderError(
        err instanceof Error ? err.message : String(err),
      );
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

async function interactiveLoop(agent: Agent): Promise<void> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (prompt: string): Promise<string> =>
    new Promise((resolve) => rl.question(prompt, resolve));

  renderInfo("Spark coding agent. Type your message, or 'exit' to quit.");
  renderInfo(`Session: ${agent.sessionId}`);

  while (true) {
    const input = await question("\n> ");
    const trimmed = input.trim();

    if (!trimmed) continue;
    if (trimmed === "exit" || trimmed === "quit") {
      renderInfo("Goodbye!");
      rl.close();
      break;
    }

    try {
      await agent.run(trimmed);
    } catch (err) {
      renderError(err instanceof Error ? err.message : String(err));
    }
  }
}

program.parse();
