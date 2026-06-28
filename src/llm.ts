import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.js";

export interface LLMConfig {
  apiKey: string;
  baseURL: string;
  model: string;
  /** Request timeout in ms (for both chat and chatStream). Default: 120_000. */
  timeout?: number;
}

export interface LLMResponse {
  content: string | null;
  toolCalls?: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[];
  usage?: { prompt_tokens: number; completion_tokens: number };
}

export interface StreamUsage {
  prompt_tokens: number;
  completion_tokens: number;
}

export class LLMClient {
  readonly client: OpenAI;
  readonly model: string;
  readonly timeout: number;

  constructor(config: LLMConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      timeout: config.timeout ?? 120_000,
      maxRetries: 0, // we handle retries ourselves in withRetry
    });
    this.model = config.model;
    this.timeout = config.timeout ?? 120_000;
  }

  async chat(
    messages: ChatCompletionMessageParam[],
    tools?: OpenAI.Chat.Completions.ChatCompletionTool[],
  ): Promise<LLMResponse> {
    const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
      model: this.model,
      messages,
    };
    if (tools && tools.length > 0) {
      params.tools = tools;
    }

    return this.withRetry(async () => {
      const response = await this.client.chat.completions.create(params);
      const choice = response.choices[0];
      return {
        content: choice.message.content,
        toolCalls:
          choice.message.tool_calls && choice.message.tool_calls.length > 0
            ? choice.message.tool_calls
            : undefined,
        usage: response.usage
          ? {
              prompt_tokens: response.usage.prompt_tokens,
              completion_tokens: response.usage.completion_tokens,
            }
          : undefined,
      };
    });
  }

  async *chatStream(
    messages: ChatCompletionMessageParam[],
    tools?: OpenAI.Chat.Completions.ChatCompletionTool[],
    signal?: AbortSignal,
  ): AsyncGenerator<
    { type: "text_delta" | "tool_call" | "usage" | "done"; data?: unknown }
  > {
    // Use a timeout controller: whichever fires first (timeout or caller signal) aborts
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => {
      timeoutController.abort(new Error(`LLM request timed out after ${this.timeout}ms`));
    }, this.timeout);

    // If the caller provided a signal, forward its abort to our controller
    if (signal) {
      const onAbort = () => {
        timeoutController.abort(signal.reason);
      };
      signal.addEventListener("abort", onAbort, { once: true });
      // Clean up the listener when the stream completes
      const cleanup = () => signal.removeEventListener("abort", onAbort);
      // We'll call cleanup at the end of this function
    }

    const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
      model: this.model,
      messages,
      stream: true,
      stream_options: { include_usage: true },
    };
    if (tools && tools.length > 0) {
      params.tools = tools;
    }

    let stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;
    try {
      stream = await this.client.chat.completions.create(
        params,
        { signal: timeoutController.signal },
      );
    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }

    let content = "";
    const toolCallMap = new Map<
      number,
      { id: string; name: string; arguments: string }
    >();

    try {
      for await (const chunk of stream) {
      // The final chunk carries usage info when stream_options.include_usage is true
      if (chunk.usage) {
        yield {
          type: "usage",
          data: {
            prompt_tokens: chunk.usage.prompt_tokens,
            completion_tokens: chunk.usage.completion_tokens,
          },
        };
      }

      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;

      if (delta.content) {
        content += delta.content;
        yield { type: "text_delta", data: delta.content };
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index;
          if (!toolCallMap.has(idx)) {
            toolCallMap.set(idx, {
              id: tc.id ?? "",
              name: tc.function?.name ?? "",
              arguments: "",
            });
          }
          const entry = toolCallMap.get(idx)!;
          if (tc.id) entry.id = tc.id;
          if (tc.function?.name) entry.name = tc.function.name;
          if (tc.function?.arguments) entry.arguments += tc.function.arguments;
        }
      }
    }
    } finally {
      clearTimeout(timeoutId);
    }

    if (toolCallMap.size > 0) {
      const toolCalls = Array.from(toolCallMap.values()).map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: { name: tc.name, arguments: tc.arguments },
      }));
      yield { type: "tool_call", data: toolCalls };
    }

    yield { type: "done", data: { content } };
  }

  private async withRetry<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        if (attempt === retries) throw err;

        if (err instanceof OpenAI.RateLimitError) {
          const delay = Math.pow(2, attempt) * 1000;
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }

        if (err instanceof OpenAI.APIConnectionError) {
          const delay = Math.pow(2, attempt) * 500;
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }

        throw err;
      }
    }
    throw new Error("Retry loop exited unexpectedly");
  }
}
