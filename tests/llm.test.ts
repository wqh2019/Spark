import { describe, it, expect, beforeEach, vi } from "vitest";
import { LLMClient, LLMConfig } from "../src/llm.js";

describe("LLMClient", () => {
  let config: LLMConfig;
  let client: LLMClient;

  beforeEach(() => {
    config = {
      apiKey: "test-key",
      baseURL: "https://test.api.com/v1",
      model: "test-model",
    };
    client = new LLMClient(config);
  });

  it("creates client with config", () => {
    expect(client.model).toBe("test-model");
    expect(client.client).toBeDefined();
  });

  it("chat() returns assistant message", async () => {
    client.client.chat = {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: "Hello! How can I help you?",
              },
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      },
    } as any;

    const response = await client.chat([{ role: "user", content: "Hi!" }]);

    expect(response.content).toBe("Hello! How can I help you?");
    expect(response.usage).toEqual({
      prompt_tokens: 10,
      completion_tokens: 5,
    });
  });

  it("returns tool_calls in chat()", async () => {
    const toolCalls = [
      {
        id: "call_123",
        type: "function" as const,
        function: { name: "read_file", arguments: '{"path":"/tmp/test"}' },
      },
    ];

    client.client.chat = {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: null,
                tool_calls: toolCalls,
              },
            },
          ],
          usage: { prompt_tokens: 15, completion_tokens: 8, total_tokens: 23 },
        }),
      },
    } as any;

    const response = await client.chat([
      { role: "user", content: "Read a file" },
    ]);

    expect(response.content).toBeNull();
    expect(response.toolCalls).toEqual(toolCalls);
    expect(response.usage).toEqual({
      prompt_tokens: 15,
      completion_tokens: 8,
    });
  });

  it("chatStream() yields text deltas and done event", async () => {
    async function* mockStream() {
      yield {
        choices: [{ index: 0, delta: { content: "Hello" } }],
      };
      yield {
        choices: [{ index: 0, delta: { content: " world!" } }],
      };
    }

    client.client.chat = {
      completions: {
        create: vi.fn().mockResolvedValue(mockStream()),
      },
    } as any;

    const events: any[] = [];
    for await (const event of client.chatStream([
      { role: "user", content: "Hi!" },
    ])) {
      events.push(event);
    }

    expect(events).toHaveLength(3);
    expect(events[0]).toEqual({ type: "text_delta", data: "Hello" });
    expect(events[1]).toEqual({ type: "text_delta", data: " world!" });
    expect(events[2]).toEqual({
      type: "done",
      data: { content: "Hello world!" },
    });
  });

  it("chatStream() yields tool_call event for fragmented tool call deltas", async () => {
    async function* mockToolStream() {
      // First chunk: tool call begins with id + name
      yield {
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_abc",
                  type: "function",
                  function: { name: "read_file", arguments: '{"path"' },
                },
              ],
            },
          },
        ],
      };
      // Second chunk: more arguments
      yield {
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  function: { arguments: ':"/tmp"}' },
                },
              ],
            },
          },
        ],
      };
    }

    client.client.chat = {
      completions: {
        create: vi.fn().mockResolvedValue(mockToolStream()),
      },
    } as any;

    const events: any[] = [];
    for await (const event of client.chatStream([
      { role: "user", content: "Read /tmp" },
    ])) {
      events.push(event);
    }

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({
      type: "tool_call",
      data: [
        {
          id: "call_abc",
          type: "function",
          function: {
            name: "read_file",
            arguments: '{"path":"/tmp"}',
          },
        },
      ],
    });
    expect(events[1]).toEqual({
      type: "done",
      data: { content: "" },
    });
  });

  it("chat() passes tools to the API", async () => {
    const createMock = vi.fn().mockResolvedValue({
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "I'll use the tool",
          },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });

    client.client.chat = {
      completions: { create: createMock },
    } as any;

    const tools = [
      {
        type: "function" as const,
        function: {
          name: "read_file",
          description: "Read a file",
          parameters: { type: "object", properties: {} },
        },
      },
    ];

    await client.chat([{ role: "user", content: "Read /tmp" }], tools);

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "test-model",
        tools,
      }),
    );
  });

  it("chatStream() passes stream: true and stream_options", async () => {
    const createMock = vi.fn().mockResolvedValue(
      (async function* () {
        yield {
          choices: [{ index: 0, delta: { content: "ok" } }],
        };
      })(),
    );

    client.client.chat = {
      completions: { create: createMock },
    } as any;

    const events: any[] = [];
    for await (const event of client.chatStream([
      { role: "user", content: "Hi" },
    ])) {
      events.push(event);
    }

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "test-model",
        stream: true,
        stream_options: { include_usage: true },
      }),
    );
  });

  it("chat() handles missing usage gracefully", async () => {
    client.client.chat = {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: "OK",
              },
            },
          ],
        }),
      },
    } as any;

    const response = await client.chat([{ role: "user", content: "Hi" }]);

    expect(response.content).toBe("OK");
    expect(response.usage).toBeUndefined();
  });
});
