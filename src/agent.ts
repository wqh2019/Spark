import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.js";
import type { SparkConfig } from "./config.js";
import { LLMClient } from "./llm.js";
import { ConversationMemory, type Message, type ToolCall } from "./memory.js";
import { ToolRegistry, createToolRegistry } from "./tools/index.js";
import { requiresConfirmation } from "./safety.js";
import { buildSystemPrompt } from "./prompt.js";
import {
  renderTextDelta,
  renderTextComplete,
  renderToolStart,
  renderToolResult,
  renderError,
  renderInfo,
  confirmAction,
} from "./render.js";
import { setProjectDir } from "./tools/file.js";
import { setShellProjectDir } from "./tools/shell.js";
import { setSearchProjectDir } from "./tools/search.js";
import { setDevProjectDir } from "./tools/dev.js";

export interface AgentOptions {
  maxSteps?: number;
  autoApprove?: string[];
  systemPrompt?: string;
}

export class Agent {
  private llm: LLMClient;
  private memory: ConversationMemory;
  private registry: ToolRegistry;
  private maxSteps: number;
  private autoApprove: Set<string>;
  private systemPrompt: string;
  private approveAll = false;
  private cwd: string;

  constructor(
    config: SparkConfig,
    memory?: ConversationMemory,
    options?: AgentOptions,
  ) {
    this.cwd = process.cwd();
    this.llm = new LLMClient(config);
    this.memory = memory ?? new ConversationMemory();
    this.maxSteps = options?.maxSteps ?? config.maxSteps;
    this.autoApprove = new Set(options?.autoApprove ?? config.autoApprove);
    this.systemPrompt = options?.systemPrompt ?? buildSystemPrompt(this.cwd);
    this.registry = new ToolRegistry();

    // Initialize tool registry asynchronously at first use
    this.initRegistry();
    this.setProjectDirs();
  }

  private initialized = false;
  private initPromise: Promise<void> | null = null;

  private initRegistry(): void {
    this.initPromise = createToolRegistry().then((reg) => {
      this.registry = reg;
      this.initialized = true;
    });
  }

  private async ensureInit(): Promise<void> {
    if (!this.initialized) {
      await this.initPromise;
    }
  }

  private setProjectDirs(): void {
    setProjectDir(this.cwd);
    setShellProjectDir(this.cwd);
    setSearchProjectDir(this.cwd);
    setDevProjectDir(this.cwd);
  }

  get sessionId(): string {
    return this.memory.id;
  }

  async run(userMessage: string, signal?: AbortSignal): Promise<string> {
    await this.ensureInit();

    if (this.memory.getMessages().length === 0) {
      this.memory.addMessage("system", this.systemPrompt);
    }

    this.memory.addMessage("user", userMessage);

    let content = "";

    for (let step = 0; step < this.maxSteps; step++) {
      if (signal?.aborted) {
        renderInfo("Interrupted by user.");
        return content || "Interrupted by user.";
      }

      renderInfo(`Step ${step + 1}/${this.maxSteps}`);

      const messages = this.toOpenAIMessages(this.memory.getMessages());
      const toolSchemas = this.registry.getSchemas();

      content = "";
      let toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] | undefined;

      try {
        for await (const event of this.llm.chatStream(
          messages,
          toolSchemas.length > 0
            ? (toolSchemas as OpenAI.Chat.Completions.ChatCompletionTool[])
            : undefined,
        )) {
          if (event.type === "text_delta") {
            renderTextDelta(event.data as string);
            content += event.data;
          } else if (event.type === "tool_call") {
            toolCalls = event.data as OpenAI.Chat.Completions.ChatCompletionMessageToolCall[];
          } else if (event.type === "usage") {
            const u = event.data as { prompt_tokens: number; completion_tokens: number };
            renderInfo(`tokens: ${u.prompt_tokens} prompt + ${u.completion_tokens} completion`);
          } else if (event.type === "done") {
            content = (event.data as { content: string }).content ?? content;
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        renderError(msg);
        return msg;
      }
      renderTextComplete();

      this.memory.addMessage("assistant", content, {
        tool_calls: toolCalls,
      });

      if (!toolCalls || toolCalls.length === 0) {
        return content;
      }

      // Execute tool calls in parallel
      await this.executeToolCalls(toolCalls);
    }

    const limitMsg = `Reached maximum steps (${this.maxSteps}). Task may be incomplete.`;
    renderInfo(limitMsg);
    return limitMsg;
  }

  private async executeToolCalls(
    toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[],
  ): Promise<void> {
    // Phase 1: Confirmation (serial)
    const decisions = await this.confirmTools(toolCalls);

    // Phase 2: Execution (parallel)
    const results = await Promise.all(
      toolCalls.map((tc, i) => this.runToolCall(tc, decisions[i])),
    );

    // Phase 3: Render + memory write (serial, in original order)
    for (let i = 0; i < toolCalls.length; i++) {
      const tc = toolCalls[i];
      const { result, isError, denied } = results[i];
      if (isError && !denied) {
        renderError(result);
      }
      renderToolResult(tc.function.name, result, isError);
      this.memory.addMessage("tool", result, {
        tool_call_id: tc.id,
      });
    }
  }

  private async confirmTools(
    toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[],
  ): Promise<Array<"approved" | "denied">> {
    const decisions: Array<"approved" | "denied"> = [];

    for (const tc of toolCalls) {
      const tool = this.registry.get(tc.function.name);
      const needsConfirm =
        tool?.requiresConfirmation ?? requiresConfirmation(tc.function.name);

      if (
        !needsConfirm ||
        this.approveAll ||
        this.autoApprove.has("*") ||
        this.autoApprove.has(tc.function.name)
      ) {
        decisions.push("approved");
        continue;
      }

      // Needs confirmation — render start info so user can see args before deciding
      const args = this.parseArgs(tc.function.arguments);
      renderToolStart(tc.function.name, args);

      const result = await confirmAction(`Allow ${tc.function.name}?`);
      if (result === "all") {
        this.approveAll = true;
        decisions.push("approved");
      } else if (result === false) {
        decisions.push("denied");
      } else {
        decisions.push("approved");
      }
    }

    return decisions;
  }

  private async runToolCall(
    tc: OpenAI.Chat.Completions.ChatCompletionMessageToolCall,
    decision: "approved" | "denied",
  ): Promise<{ result: string; isError: boolean; denied?: boolean }> {
    if (decision === "denied") {
      return { result: "Denied by user", isError: true, denied: true };
    }

    const args = this.parseArgs(tc.function.arguments);

    // For tools that didn't render start in confirmTools, render it now
    const tool = this.registry.get(tc.function.name);
    const needsConfirm =
      tool?.requiresConfirmation ?? requiresConfirmation(tc.function.name);
    if (
      !needsConfirm ||
      this.approveAll ||
      this.autoApprove.has("*") ||
      this.autoApprove.has(tc.function.name)
    ) {
      renderToolStart(tc.function.name, args);
    }

    let execResult: string;
    let isError = false;

    if (tool) {
      try {
        execResult = await tool.execute(args);
      } catch (err: any) {
        execResult = `Error executing ${tc.function.name}: ${err.message}`;
        isError = true;
      }
    } else {
      execResult = `Error: unknown tool "${tc.function.name}"`;
      isError = true;
    }

    return { result: execResult, isError };
  }

  private parseArgs(argsStr: string): Record<string, unknown> {
    try {
      return JSON.parse(argsStr);
    } catch {
      return {};
    }
  }

  private toOpenAIMessages(
    messages: Message[],
  ): ChatCompletionMessageParam[] {
    return messages.map((m) => {
      if (m.role === "tool" && m.tool_call_id) {
        return {
          role: "tool" as const,
          content: m.content,
          tool_call_id: m.tool_call_id,
        };
      }

      if (m.role === "assistant" && m.tool_calls) {
        return {
          role: "assistant" as const,
          content: m.content || null,
          tool_calls: m.tool_calls.map((tc) => ({
            id: tc.id,
            type: "function" as const,
            function: {
              name: tc.function.name,
              arguments: tc.function.arguments,
            },
          })),
        };
      }

      return {
        role: m.role as "system" | "user" | "assistant",
        content: m.content,
      };
    }) as ChatCompletionMessageParam[];
  }
}

/** Convenience function: create an agent and run a single query. */
export async function runAgent(
  config: SparkConfig,
  query: string,
  options?: AgentOptions,
): Promise<string> {
  const agent = new Agent(config, undefined, options);
  return agent.run(query);
}
