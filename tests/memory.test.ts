import { describe, it, expect, beforeEach } from "vitest";
import { ConversationMemory, Message, ToolCall } from "../src/memory.js";

function makeToolCall(id: string, name: string): ToolCall {
  return { id, type: "function", function: { name, arguments: "{}" } };
}

// Asserts every tool message is preceded by an assistant with tool_calls, and
// every assistant with tool_calls is followed by at least one tool message.
function assertNoOrphans(messages: Message[]): void {
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role === "tool") {
      const prev = messages[i - 1];
      expect(prev).toBeDefined();
      expect(prev.role === "assistant" && prev.tool_calls && prev.tool_calls.length > 0).toBe(true);
    }
    if (m.role === "assistant" && m.tool_calls && m.tool_calls.length > 0) {
      const next = messages[i + 1];
      expect(next).toBeDefined();
      expect(next.role).toBe("tool");
    }
  }
}

describe("ConversationMemory", () => {
  let memory: ConversationMemory;

  beforeEach(() => {
    memory = new ConversationMemory(50);
  });

  it("adds and retrieves messages", () => {
    memory.addMessage("system", "You are a helpful assistant.");
    memory.addMessage("user", "Hello!");
    memory.addMessage("assistant", "Hi there!");

    const messages = memory.getMessages();
    expect(messages).toHaveLength(3);
    expect(messages[0]).toEqual({
      role: "system",
      content: "You are a helpful assistant.",
    });
    expect(messages[1]).toEqual({ role: "user", content: "Hello!" });
    expect(messages[2]).toEqual({ role: "assistant", content: "Hi there!" });
  });

  it("applies sliding window when messages exceed max", () => {
    const mem = new ConversationMemory(3);

    mem.addMessage("system", "system msg");
    mem.addMessage("user", "msg1");
    mem.addMessage("assistant", "msg2");
    mem.addMessage("user", "msg3");

    const messages = mem.getMessages();
    expect(messages).toHaveLength(3);
    // System prompt is protected and always kept; remaining budget keeps the
    // most recent messages.
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toBe("system msg");
    expect(messages[1].content).toBe("msg2");
    expect(messages[2].content).toBe("msg3");
  });

  it("clears messages", () => {
    memory.addMessage("user", "hello");
    memory.addMessage("assistant", "hi");
    expect(memory.getMessages()).toHaveLength(2);

    memory.clear();
    expect(memory.getMessages()).toHaveLength(0);
  });

  it("setMessages overwrites and applies sliding window", () => {
    const mem = new ConversationMemory(3);

    mem.addMessage("user", "original");
    expect(mem.getMessages()).toHaveLength(1);

    mem.setMessages([
      { role: "system", content: "s1" },
      { role: "user", content: "u1" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "u2" },
      { role: "assistant", content: "a2" },
    ]);

    const messages = mem.getMessages();
    // maxMessages = 3, system is protected, remaining budget keeps recent
    expect(messages).toHaveLength(3);
    expect(messages[0].content).toBe("s1");
    expect(messages[1].content).toBe("u2");
    expect(messages[2].content).toBe("a2");
  });

  it("defaults maxMessages to 50", () => {
    const mem = new ConversationMemory();
    // Add 51 messages, should be trimmed to 50
    for (let i = 0; i < 51; i++) {
      mem.addMessage("user", `msg ${i}`);
    }
    expect(mem.getMessages()).toHaveLength(50);
    expect(mem.getMessages()[0].content).toBe("msg 1");
    expect(mem.getMessages()[49].content).toBe("msg 50");
  });

  it("getMessages returns a copy, not the internal array", () => {
    memory.addMessage("user", "hello");
    const first = memory.getMessages();
    const second = memory.getMessages();
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
  });

  it("addMessage accepts extra fields like tool_call_id and name", () => {
    memory.addMessage("tool", "result data", {
      tool_call_id: "call_123",
      name: "read_file",
    });

    const messages = memory.getMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({
      role: "tool",
      content: "result data",
      tool_call_id: "call_123",
      name: "read_file",
    });
  });

  it("preserves assistant(tool_calls)+tool group integrity under trim", () => {
    const mem = new ConversationMemory(4);
    mem.setMessages([
      { role: "system", content: "sys" },
      { role: "user", content: "u" },
      { role: "assistant", content: "", tool_calls: [makeToolCall("A", "read_file")] },
      { role: "tool", content: "resultA", tool_call_id: "A" },
      { role: "user", content: "u2" },
      { role: "assistant", content: "", tool_calls: [makeToolCall("B", "read_file")] },
      { role: "tool", content: "resultB", tool_call_id: "B" },
    ]);

    const messages = mem.getMessages();
    // budget after system = 3; tail group [asst(B),tool(B)] (2) + [user u2] (1) fit;
    // group A (2) does not fit and is dropped whole — no orphan.
    expect(messages).toHaveLength(4);
    expect(messages[0].role).toBe("system");
    expect(messages[1].content).toBe("u2");
    expect(messages[2].role).toBe("assistant");
    expect(messages[3].role).toBe("tool");
    expect(messages[3].tool_call_id).toBe("B");
    assertNoOrphans(messages);
  });

  it("never leaves orphan tool or assistant(tool_calls) message", () => {
    const mem = new ConversationMemory(5);
    mem.setMessages([
      { role: "system", content: "sys" },
      { role: "user", content: "u1" },
      { role: "assistant", content: "", tool_calls: [makeToolCall("A", "t")] },
      { role: "tool", content: "rA", tool_call_id: "A" },
      { role: "user", content: "u2" },
      { role: "assistant", content: "", tool_calls: [makeToolCall("B", "t")] },
      { role: "tool", content: "rB", tool_call_id: "B" },
      { role: "user", content: "u3" },
    ]);
    assertNoOrphans(mem.getMessages());
  });

  it("keeps system when maxMessages is 1", () => {
    const mem = new ConversationMemory(1);
    mem.addMessage("system", "sys");
    mem.addMessage("user", "u");

    const messages = mem.getMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("system");
  });

  it("trims multiple consecutive tool groups keeping only the latest", () => {
    const mem = new ConversationMemory(4);
    mem.setMessages([
      { role: "system", content: "sys" },
      { role: "user", content: "u" },
      { role: "assistant", content: "", tool_calls: [makeToolCall("A", "t")] },
      { role: "tool", content: "rA", tool_call_id: "A" },
      { role: "assistant", content: "", tool_calls: [makeToolCall("B", "t")] },
      { role: "tool", content: "rB", tool_call_id: "B" },
      { role: "assistant", content: "", tool_calls: [makeToolCall("C", "t")] },
      { role: "tool", content: "rC", tool_call_id: "C" },
    ]);

    const messages = mem.getMessages();
    // budget after system = 3; only the last group [asst(C),tool(C)] (2) fits.
    expect(messages).toHaveLength(3);
    expect(messages[0].role).toBe("system");
    expect(messages[2].tool_call_id).toBe("C");
    assertNoOrphans(messages);
  });

  it("setMessages preserves system and tool_call groups", () => {
    const mem = new ConversationMemory(4);
    mem.setMessages([
      { role: "system", content: "sys" },
      { role: "user", content: "u" },
      { role: "assistant", content: "", tool_calls: [makeToolCall("A", "t")] },
      { role: "tool", content: "rA", tool_call_id: "A" },
      { role: "assistant", content: "", tool_calls: [makeToolCall("B", "t")] },
      { role: "tool", content: "rB", tool_call_id: "B" },
    ]);

    const messages = mem.getMessages();
    expect(messages[0].role).toBe("system");
    assertNoOrphans(messages);
  });
});
