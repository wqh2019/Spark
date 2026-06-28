import { describe, it, expect, vi, beforeEach } from "vitest";
import { Agent } from "../src/agent.js";
import type { SparkConfig } from "../src/config.js";
import { ConversationMemory } from "../src/memory.js";

// Mock render functions to avoid stdout noise and capture calls
vi.mock("../src/render.js", () => ({
  renderTextDelta: vi.fn(),
  renderTextComplete: vi.fn(),
  renderToolStart: vi.fn(),
  renderToolResult: vi.fn(),
  renderError: vi.fn(),
  renderInfo: vi.fn(),
  renderSuccess: vi.fn(),
  renderProgress: vi.fn(),
  renderDivider: vi.fn(),
  confirmAction: vi.fn(),
  startSpinner: vi.fn(),
  stopSpinner: vi.fn(),
  resetMarkdownState: vi.fn(),
}));

// Helper: create a mock chatStream async generator
function mockChatStream(
  events: Array<{ type: string; data?: unknown }>,
): () => AsyncGenerator<{ type: string; data?: unknown }> {
  return function* () {
    for (const event of events) {
      yield event;
    }
  };
}

// Helper: build config
function makeConfig(overrides?: Partial<SparkConfig>): SparkConfig {
  return {
    apiKey: "test-key",
    baseURL: "http://localhost:8000/v1",
    model: "test-model",
    maxSteps: 10,
    autoApprove: [],
    ...overrides,
  };
}

describe("Agent", () => {
  let config: SparkConfig;

  beforeEach(() => {
    config = makeConfig();
    vi.clearAllMocks();
  });

  it("returns text content from streaming response", async () => {
    const agent = new Agent(config);

    // Mock chatStream to return a text-only response
    agent["llm"].chatStream = mockChatStream([
      { type: "text_delta", data: "Hello" },
      { type: "text_delta", data: " world!" },
      { type: "done", data: { content: "Hello world!" } },
    ]) as any;

    const result = await agent.run("Hi");
    expect(result).toBe("Hello world!");
  });

  it("calls renderTextDelta for each text_delta event", async () => {
    const { renderTextDelta } = await import("../src/render.js");
    const agent = new Agent(config);

    agent["llm"].chatStream = mockChatStream([
      { type: "text_delta", data: "Hi" },
      { type: "text_delta", data: " there" },
      { type: "done", data: { content: "Hi there" } },
    ]) as any;

    await agent.run("Hello");
    expect(renderTextDelta).toHaveBeenCalledWith("Hi");
    expect(renderTextDelta).toHaveBeenCalledWith(" there");
  });

  it("calls renderTextComplete after stream ends", async () => {
    const { renderTextComplete } = await import("../src/render.js");
    const agent = new Agent(config);

    agent["llm"].chatStream = mockChatStream([
      { type: "text_delta", data: "ok" },
      { type: "done", data: { content: "ok" } },
    ]) as any;

    await agent.run("Test");
    expect(renderTextComplete).toHaveBeenCalled();
  });

  it("stores assistant message with tool_calls in memory", async () => {
    const memory = new ConversationMemory(50);
    const agent = new Agent(config, memory);

    const toolCalls = [
      {
        id: "call_1",
        type: "function" as const,
        function: { name: "read_file", arguments: '{"file_path":"/tmp/test"}' },
      },
    ];

    agent["llm"].chatStream = mockChatStream([
      { type: "tool_call", data: toolCalls },
      { type: "done", data: { content: "" } },
    ]) as any;

    // Mock the tool registry to handle the tool call without actually executing
    agent["registry"].register({
      name: "read_file",
      description: "Read a file",
      parameters: { file_path: { type: "string" } },
      execute: async () => "file contents here",
    });

    await agent.run("Read a file");

    const messages = memory.getMessages();
    // system + user + assistant (with tool_calls) + tool result
    const assistantMsg = messages.find((m) => m.role === "assistant");
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg!.tool_calls).toHaveLength(1);
    expect(assistantMsg!.tool_calls![0].function.name).toBe("read_file");
  });

  it("executes tool calls and returns final text", async () => {
    const agent = new Agent(config);
    let callCount = 0;

    // First call: tool_call → then text response
    agent["llm"].chatStream = (function () {
      return async function* () {
        callCount++;
        if (callCount === 1) {
          yield { type: "tool_call", data: [{ id: "call_1", type: "function", function: { name: "read_file", arguments: '{"file_path":"test.txt"}' } }] };
          yield { type: "done", data: { content: "" } };
        } else {
          yield { type: "text_delta", data: "The file contains hello" };
          yield { type: "done", data: { content: "The file contains hello" } };
        }
      };
    })() as any;

    agent["registry"].register({
      name: "read_file",
      description: "Read a file",
      parameters: { file_path: { type: "string" } },
      execute: async () => "hello",
    });

    const result = await agent.run("Read test.txt");
    expect(result).toBe("The file contains hello");
    expect(callCount).toBe(2); // tool call round + final text round
  });

  it("stops at maxSteps and returns limit message", async () => {
    const agent = new Agent(makeConfig({ maxSteps: 2 }));

    // Always return a tool call so the loop never exits naturally
    agent["llm"].chatStream = mockChatStream([
      {
        type: "tool_call",
        data: [
          {
            id: "call_loop",
            type: "function",
            function: { name: "read_file", arguments: '{"file_path":"test"}' },
          },
        ],
      },
      { type: "done", data: { content: "" } },
    ]) as any;

    agent["registry"].register({
      name: "read_file",
      description: "Read a file",
      parameters: { file_path: { type: "string" } },
      execute: async () => "file content",
    });

    const result = await agent.run("Keep reading");
    expect(result).toContain("Reached maximum steps (2)");
  });

  it("handles LLM errors gracefully", async () => {
    const { renderError } = await import("../src/render.js");
    const agent = new Agent(config);

    agent["llm"].chatStream = (async function* () {
      throw new Error("API rate limit exceeded");
    }) as any;

    const result = await agent.run("Hello");
    expect(result).toBe("API rate limit exceeded");
    expect(renderError).toHaveBeenCalledWith("API rate limit exceeded");
  });

  it("adds system message on first run", async () => {
    const memory = new ConversationMemory(50);
    const agent = new Agent(config, memory);

    agent["llm"].chatStream = mockChatStream([
      { type: "text_delta", data: "ok" },
      { type: "done", data: { content: "ok" } },
    ]) as any;

    await agent.run("Hello");

    const messages = memory.getMessages();
    expect(messages[0].role).toBe("system");
    expect(messages[1].role).toBe("user");
    expect(messages[1].content).toBe("Hello");
  });

  it("does not add duplicate system message on second run", async () => {
    const memory = new ConversationMemory(50);
    const agent = new Agent(config, memory);

    agent["llm"].chatStream = mockChatStream([
      { type: "text_delta", data: "ok" },
      { type: "done", data: { content: "ok" } },
    ]) as any;

    await agent.run("First");
    await agent.run("Second");

    const messages = memory.getMessages();
    const systemMessages = messages.filter((m) => m.role === "system");
    expect(systemMessages).toHaveLength(1);
  });

  it("handles unknown tool gracefully", async () => {
    const { renderError } = await import("../src/render.js");
    const agent = new Agent(config);

    agent["llm"].chatStream = mockChatStream([
      {
        type: "tool_call",
        data: [
          {
            id: "call_unk",
            type: "function",
            function: { name: "nonexistent_tool", arguments: "{}" },
          },
        ],
      },
      { type: "done", data: { content: "" } },
    ]) as any;

    // Second call returns text to exit the loop
    let callCount = 0;
    const originalStream = agent["llm"].chatStream;
    agent["llm"].chatStream = (async function* () {
      callCount++;
      if (callCount === 1) {
        yield { type: "tool_call", data: [{ id: "call_unk", type: "function", function: { name: "nonexistent_tool", arguments: "{}" } }] };
        yield { type: "done", data: { content: "" } };
      } else {
        yield { type: "text_delta", data: "Done" };
        yield { type: "done", data: { content: "Done" } };
      }
    }) as any;

    const result = await agent.run("Use unknown tool");
    // The unknown tool error should be rendered, and the agent should continue
    expect(renderError).toHaveBeenCalledWith(
      expect.stringContaining('unknown tool "nonexistent_tool"'),
    );
  });

  it("auto-approve wildcard '*' skips confirmation for all tools", async () => {
    const { confirmAction } = await import("../src/render.js");
    const agent = new Agent(makeConfig({ autoApprove: ["*"] }), undefined);

    let callCount = 0;
    agent["llm"].chatStream = (async function* () {
      callCount++;
      if (callCount === 1) {
        yield { type: "tool_call", data: [{ id: "call_1", type: "function", function: { name: "write_file", arguments: '{"file_path":"test.txt","content":"hi"}' } }] };
        yield { type: "done", data: { content: "" } };
      } else {
        yield { type: "text_delta", data: "Done" };
        yield { type: "done", data: { content: "Done" } };
      }
    }) as any;

    agent["registry"].register({
      name: "write_file",
      description: "Write a file",
      parameters: { file_path: { type: "string" }, content: { type: "string" } },
      requiresConfirmation: true,
      execute: async () => "ok",
    });

    await agent.run("Write a file");
    // confirmAction should NOT be called because "*" auto-approves everything
    expect(confirmAction).not.toHaveBeenCalled();
  });

  it("auto-approve specific tool name skips confirmation for that tool only", async () => {
    const { confirmAction } = await import("../src/render.js");
    const agent = new Agent(makeConfig({ autoApprove: ["read_file"] }), undefined);

    let callCount = 0;
    agent["llm"].chatStream = (async function* () {
      callCount++;
      if (callCount === 1) {
        yield { type: "tool_call", data: [{ id: "call_1", type: "function", function: { name: "read_file", arguments: '{"file_path":"test.txt"}' } }] };
        yield { type: "done", data: { content: "" } };
      } else {
        yield { type: "text_delta", data: "Done" };
        yield { type: "done", data: { content: "Done" } };
      }
    }) as any;

    agent["registry"].register({
      name: "read_file",
      description: "Read a file",
      parameters: { file_path: { type: "string" } },
      requiresConfirmation: false,
      execute: async () => "ok",
    });

    await agent.run("Read a file");
    expect(confirmAction).not.toHaveBeenCalled();
  });
});
