import {
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  appendFileSync,
} from "node:fs";
import { join } from "node:path";
import { getSessionsDir } from "./config.js";

export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  name?: string;
  tool_calls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export class ConversationMemory {
  private messages: Message[] = [];
  private maxMessages: number;
  private sessionId: string;
  private sessionFile: string;

  constructor(maxMessages = 50, sessionId?: string) {
    this.maxMessages = maxMessages;
    if (sessionId) {
      this.sessionId = sessionId;
    } else {
      this.sessionId = new Date().toISOString().replace(/[:.]/g, "-");
    }
    const dir = getSessionsDir();
    this.sessionFile = join(dir, `${this.sessionId}.jsonl`);
  }

  get id(): string {
    return this.sessionId;
  }

  addMessage(
    role: Message["role"],
    content: string,
    extra?: { tool_call_id?: string; name?: string; tool_calls?: ToolCall[] },
  ): void {
    const message: Message = { role, content, ...extra };
    this.messages.push(message);
    this.persistMessage(message);
    this.trimIfNeeded();
  }

  getMessages(): Message[] {
    return [...this.messages];
  }

  setMessages(messages: Message[]): void {
    this.messages = [...messages];
    this.trimIfNeeded();
    this.persistAll();
  }

  clear(): void {
    this.messages = [];
    this.persistAll();
  }

  loadFromDisk(): void {
    if (!existsSync(this.sessionFile)) return;
    try {
      const content = readFileSync(this.sessionFile, "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);
      this.messages = lines.map((line) => JSON.parse(line) as Message);
    } catch {
      this.messages = [];
    }
  }

  private trimIfNeeded(): void {
    while (this.messages.length > this.maxMessages) {
      this.messages.shift();
    }
  }

  private persistMessage(message: Message): void {
    try {
      appendFileSync(
        this.sessionFile,
        JSON.stringify(message) + "\n",
        "utf-8",
      );
    } catch {
      // Silent fail for persistence
    }
  }

  private persistAll(): void {
    try {
      const lines =
        this.messages.map((m) => JSON.stringify(m)).join("\n") + "\n";
      writeFileSync(this.sessionFile, lines, "utf-8");
    } catch {
      // Silent fail for persistence
    }
  }
}

export function listSessions(): string[] {
  const dir = getSessionsDir();
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => f.replace(".jsonl", ""))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

export function getLatestSessionId(): string | undefined {
  const sessions = listSessions();
  return sessions.length > 0 ? sessions[0] : undefined;
}
