import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.js";
import type { SparkConfig } from "./config.js";
import { LLMClient } from "./llm.js";
import { ConversationMemory, type Message, type ToolCall } from "./memory.js";
import { SafetyChecker } from "./safety.js";
import { ToolRegistry, createToolRegistry } from "./tools/index.js";
import type { ToolContext, ToolPlugin } from "./tools/index.js";
import { requiresConfirmation } from "./safety.js";
import { buildSystemPrompt, buildDynamicSystemPrompt, buildProjectContext } from "./prompt.js";
import { TaskPlanner, createTodoTools } from "./task-planner.js";
import { estimateMessagesTokens } from "./token-counter.js";
import {
  renderTextDelta,
  renderTextComplete,
  renderToolStart,
  renderToolResult,
  renderError,
  renderInfo,
  confirmAction,
} from "./render.js";

export interface AgentOptions {
  maxSteps?: number;
  autoApprove?: string[];
  systemPrompt?: string;
  /** Optional plugins for dynamic tool registration (D3). */
  plugins?: ToolPlugin[];
  /** Token budget for context window. Default 128,000. */
  maxContextTokens?: number;
  /** Token usage threshold (0-1) that triggers summarization. Default 0.8. */
  summarizationThreshold?: number;
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
  private taskPlanner: TaskPlanner;
  private maxContextTokens: number;
  private summarizationThreshold: number;
  private projectContext: string;

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
    this.maxContextTokens = options?.maxContextTokens ?? 128_000;
    this.summarizationThreshold = options?.summarizationThreshold ?? 0.8;

    // Initialize TaskPlanner and register TODO tools
    this.taskPlanner = new TaskPlanner();

    // Create ToolContext and synchronously initialize the registry (D1/D2).
    const ctx: ToolContext = {
      projectDir: this.cwd,
      safetyChecker: new SafetyChecker({ projectRoot: this.cwd }),
    };
    this.registry = createToolRegistry(ctx, options?.plugins);

    // Register TODO tools directly on the registry
    const todoTools = createTodoTools(this.taskPlanner);
    for (const tool of todoTools) {
      this.registry.register(tool);
    }

    // Cache project context at init time
    this.projectContext = buildProjectContext(this.cwd);
  }

  get sessionId(): string {
    return this.memory.id;
  }

  async run(userMessage: string, signal?: AbortSignal): Promise<string> {
    // Ensure system prompt exists as the first message before user input
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

      // Step 1: Refresh system prompt with current task + project context
      this.refreshDynamicPrompt();

      // Step 2: Check token budget and summarize if needed
      await this.checkTokenBudget();

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

  // -----------------------------------------------------------------------
  // Dynamic prompt management
  // -----------------------------------------------------------------------

  /**
   * Replace or update the system prompt with a fresh dynamic version
   * that includes current project context and task plan state.
   */
  private refreshDynamicPrompt(): void {
    const taskSummary = this.taskPlanner.getSummary();
    const newPrompt = buildDynamicSystemPrompt(
      this.cwd,
      this.projectContext,
      taskSummary,
    );

    this.memory.updateSystemPrompt(newPrompt);
  }

  // -----------------------------------------------------------------------
  // Token budget management
  // -----------------------------------------------------------------------

  /**
   * Check estimated token usage against the budget threshold.
   * If exceeded, trigger LLM-based summarization of older messages.
   */
  private async checkTokenBudget(): Promise<void> {
    const messages = this.memory.getMessages();
    const estimatedTokens = estimateMessagesTokens(messages);
    const threshold = Math.floor(this.maxContextTokens * this.summarizationThreshold);

    if (estimatedTokens <= threshold) return;

    renderInfo(
      `Context approaching limit (est. ${estimatedTokens}/${this.maxContextTokens} tokens). Summarizing older messages…`,
    );
    await this.summarizeOldMessages(estimatedTokens);
  }

  /**
   * Use the LLM to summarize older conversation turns, keeping only the
   * system prompt and the last few messages intact.
   */
  private async summarizeOldMessages(estimatedTokens: number): Promise<void> {
    const messages = this.memory.getMessages();

    // Keep at least the system prompt + last 3 messages (user/assistant/tool pairs)
    const minKeep = 4;
    if (messages.length <= minKeep + 1) return;

    const hasSystem = messages.length > 0 && messages[0].role === "system";
    const toSummarize = hasSystem ? messages.slice(1, -minKeep) : messages.slice(0, -minKeep);
    const kept = messages.slice(-minKeep);

    if (toSummarize.length === 0) return;

    const summaryRequest = `Summarize the following conversation history concisently but thoroughly. Preserve ALL of the following:
- Completed tasks and their outcomes
- Decisions made and rationale
- Code changes (what files were modified and how)
- Errors encountered and fixes applied
- Any context needed to continue the current task
- Important data, configuration values, or findings

Focus on actionable information. Omit chit-chat and redundant details.

History to summarize (${toSummarize.length} messages, ~${estimatedTokens} tokens):
${toSummarize.map((m) => `[${m.role}]: ${m.content.slice(0, 600)}`).join("\n\n")}`;

    try {
      const result = await this.llm.chat([
        {
          role: "system" as const,
          content: "You are a precise summarizer. Produce a concise but comprehensive summary of the conversation.",
        },
        { role: "user" as const, content: summaryRequest },
      ]);

      if (result.content) {
        const summaryContent = result.content.trim();
        const summaryMsg: Message = {
          role: "system",
          content: `[Summary of previous context ~${estimatedTokens} tokens]:\n${summaryContent}`,
        };

        const newMessages = hasSystem
          ? [messages[0], summaryMsg, ...kept]
          : [summaryMsg, ...kept];

        this.memory.setMessages(newMessages);
        renderInfo(
          `Summarized ${toSummarize.length} messages (~${estimatedTokens} tokens) into 1 summary message.`,
        );
      }
    } catch (err) {
      renderError(
        `Failed to summarize context: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // -----------------------------------------------------------------------
  // Tool execution
  // -----------------------------------------------------------------------

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
