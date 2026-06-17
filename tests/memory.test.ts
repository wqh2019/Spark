import { describe, it, expect, beforeEach } from "vitest";
import { ConversationMemory, Message } from "../src/memory.js";

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
    // Should keep the last 3 messages
    expect(messages[0].content).toBe("msg1");
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
    // maxMessages = 3, so only the last 3 should remain
    expect(messages).toHaveLength(3);
    expect(messages[0].content).toBe("a1");
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
});
