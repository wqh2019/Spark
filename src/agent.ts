import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.js";
import type { SparkConfig } from "./config.js";
import { LLMClient, type ToolCallDelta } from "./llm.js";
import { ConversationMemory, type Message, type ToolCall } from "./memory.js";
import { executeTool, getTool } from "./tools/index.js";
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

export class Agent {
  private llm: LLMClient;
  private memory: ConversationMemory;
  private config: SparkConfig;
  private autoApproved = false;
  private cwd: string;

  constructor(config: SparkConfig, memory?: ConversationMemory) {
    this.config = config;
    this.llm = new LLMClient(config);
    this.memory = memory ?? new ConversationMemory();
    this.cwd = process.cwd();

    setProjectDir(this.cwd);
    setShellProjectDir(this.cwd);
    setSearchProjectDir(this.cwd);
    setDevProjectDir(this.cwd);

    if (config.autoApprove.includes("*")) {
      this.autoApproved = true;
    }
  }

  get sessionId(): string {
    return this.memory.id;
  }

  async run(userMessage: string): Promise<void> {
    if (this.memory.getMessages().length === 0) {
      this.memory.addMessage("system", buildSystemPrompt(this.cwd));
    }

    this.memory.addMessage("user", userMessage);

    for (let step = 0; step < this.config.maxSteps; step++) {
      const messages = this.toOpenAIMessages(this.memory.getMessages());

      let response: Awaited<ReturnType<typeof this.llm.chat>>;
      try {
        response = await this.llm.chat(messages, (delta) => {
          renderTextDelta(delta);
        });
      } catch (err) {
        renderError(
          err instanceof Error ? err.message : String(err),
        );
        return;
      }
      renderTextComplete();

      const assistantContent = response.content ?? "";
      const toolCalls =
        response.toolCalls.length > 0
          ? response.toolCalls.map((tc) => ({
              id: tc.id,
              type: "function" as const,
              function: { name: tc.name, arguments: tc.arguments },
            }))
          : undefined;

      this.memory.addMessage("assistant", assistantContent, {
        tool_calls: toolCalls,
      });

      if (response.toolCalls.length === 0) {
        return;
      }

      for (const tc of response.toolCalls) {
        await this.executeToolCall(tc);
      }
    }

    renderInfo(`Reached maximum steps (${this.config.maxSteps}). Stopping.`);
  }

  private async executeToolCall(tc: ToolCallDelta): Promise<void> {
    const args = this.parseArgs(tc.arguments);
    renderToolStart(tc.name, args);

    const tool = getTool(tc.name);
    const needsConfirm =
      tool?.requiresConfirmation ?? requiresConfirmation(tc.name);

    if (needsConfirm && !this.autoApproved) {
      if (!this.config.autoApprove.includes(tc.name)) {
        const result = await confirmAction(`Allow ${tc.name}?`);
        if (result === "all") {
          this.autoApproved = true;
        } else if (result === false) {
          const denyMsg = `User denied ${tc.name} execution.`;
          this.memory.addMessage("tool", denyMsg, {
            tool_call_id: tc.id,
          });
          renderToolResult(tc.name, "Denied by user", true);
          return;
        }
      }
    }

    const execResult = await executeTool(tc.name, args);

    renderToolResult(tc.name, execResult.result, execResult.error);

    this.memory.addMessage("tool", execResult.result, {
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
): Promise<void> {
  const agent = new Agent(config);
  await agent.run(query);
}
