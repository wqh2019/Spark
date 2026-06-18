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

  async run(userMessage: string): Promise<string> {
    await this.ensureInit();

    if (this.memory.getMessages().length === 0) {
      this.memory.addMessage("system", this.systemPrompt);
    }

    this.memory.addMessage("user", userMessage);

    for (let step = 0; step < this.maxSteps; step++) {
      const messages = this.toOpenAIMessages(this.memory.getMessages());
      const toolSchemas = this.registry.getSchemas();

      let content = "";
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

      // Execute tool calls sequentially
      for (const tc of toolCalls) {
        await this.executeToolCall(tc);
      }
    }

    const limitMsg = `Reached maximum steps (${this.maxSteps}). Task may be incomplete.`;
    renderInfo(limitMsg);
    return limitMsg;
  }

  private async executeToolCall(
    tc: OpenAI.Chat.Completions.ChatCompletionMessageToolCall,
  ): Promise<void> {
    const args = this.parseArgs(tc.function.arguments);
    renderToolStart(tc.function.name, args);

    const tool = this.registry.get(tc.function.name);
    const needsConfirm =
      tool?.requiresConfirmation ?? requiresConfirmation(tc.function.name);

    if (needsConfirm && !this.approveAll && !this.autoApprove.has("*") && !this.autoApprove.has(tc.function.name)) {
      const result = await confirmAction(`Allow ${tc.function.name}?`);
      if (result === "all") {
        this.approveAll = true;
      } else if (result === false) {
        const denyMsg = `User denied ${tc.function.name} execution.`;
        this.memory.addMessage("tool", denyMsg, {
          tool_call_id: tc.id,
        });
        renderToolResult(tc.function.name, "Denied by user", true);
        return;
      }
    }

    let execResult: string;
    if (tool) {
      try {
        execResult = await tool.execute(args);
      } catch (err: any) {
        execResult = `Error executing ${tc.function.name}: ${err.message}`;
        renderError(execResult);
      }
    } else {
      execResult = `Error: unknown tool "${tc.function.name}"`;
      renderError(execResult);
    }

    renderToolResult(tc.function.name, execResult);
    this.memory.addMessage("tool", execResult, {
      tool_call_id: tc.id,
    });
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
