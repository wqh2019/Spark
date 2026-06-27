import {
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  appendFileSync,
} from "node:fs";
import { join } from "node:path";
import { getSessionsDir } from "./config.js";
import { logger } from "./logger.js";

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
    const msgs = this.messages;
    if (msgs.length <= this.maxMessages) return;

    // 1) Protect the first message if it is the system prompt.
    const hasProtectedSystem = msgs.length > 0 && msgs[0].role === "system";
    const protectedCount = hasProtectedSystem ? 1 : 0;
    const rest = msgs.slice(protectedCount);

    // 2) Group messages: an assistant message with tool_calls plus all the
    //    tool-result messages that immediately follow it form an indivisible
    //    group (OpenAI API requires tool messages to match a preceding
    //    assistant tool_calls). Every other message is its own single group.
    const groups: Message[][] = [];
    let i = 0;
    while (i < rest.length) {
      const m = rest[i];
      if (m.role === "assistant" && m.tool_calls && m.tool_calls.length > 0) {
        const group: Message[] = [m];
        let j = i + 1;
        while (j < rest.length && rest[j].role === "tool") {
          group.push(rest[j]);
          j++;
        }
        groups.push(group);
        i = j;
      } else {
        groups.push([m]);
        i++;
      }
    }

    // 3) Greedily keep groups from the tail until the budget is exhausted.
    //    If a group does not fit, stop (keep recent, keep groups whole) —
    //    never split a group, never produce an orphan tool/assistant message.
    const budget = this.maxMessages - protectedCount;
    if (budget <= 0) {
      this.messages = hasProtectedSystem ? [msgs[0]] : [];
      return;
    }

    const kept: Message[] = [];
    let keptCount = 0;
    for (let k = groups.length - 1; k >= 0; k--) {
      const g = groups[k];
      if (keptCount + g.length <= budget) {
        kept.unshift(...g);
        keptCount += g.length;
      } else {
        break;
      }
    }

    this.messages = hasProtectedSystem ? [msgs[0], ...kept] : kept;
  }

  private persistMessage(message: Message): void {
    try {
      appendFileSync(
        this.sessionFile,
        JSON.stringify(message) + "\n",
        "utf-8",
      );
    } catch (err) {
      logger.warn(
        `Failed to persist message: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private persistAll(): void {
    try {
      const lines =
        this.messages.map((m) => JSON.stringify(m)).join("\n") + "\n";
      writeFileSync(this.sessionFile, lines, "utf-8");
    } catch (err) {
      logger.warn(
        `Failed to persist all messages: ${err instanceof Error ? err.message : String(err)}`,
      );
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
