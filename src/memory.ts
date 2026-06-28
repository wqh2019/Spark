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
import {
  truncateToolResult,
  estimateMessagesTokens,
} from "./token-counter.js";

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
  private maxToolResultChars: number;
  private maxTokens: number;

  constructor(
    maxMessages = 50,
    sessionId?: string,
    options?: { maxToolResultChars?: number; maxTokens?: number },
  ) {
    this.maxMessages = maxMessages;
    this.maxToolResultChars = options?.maxToolResultChars ?? 2000;
    this.maxTokens = options?.maxTokens ?? 128_000;
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
    // Truncate tool results to avoid context bloat
    if (role === "tool") {
      content = truncateToolResult(content, this.maxToolResultChars);
    }
    const message: Message = { role, content, ...extra };
    this.messages.push(message);
    this.persistMessage(message);
    this.trimIfNeeded();
    this.trimByTokens();
  }

  getMessages(): Message[] {
    return [...this.messages];
  }

  setMessages(messages: Message[]): void {
    this.messages = [...messages];
    this.trimIfNeeded();
    this.trimByTokens();
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

  /** Estimated total token count for all messages. */
  get estimatedTokens(): number {
    return estimateMessagesTokens(this.messages);
  }

  /**
   * Replace older messages with a summary message for token budget management.
   * Keeps the system prompt (if present) and the last `keepCount` messages,
   * inserting a summary of everything else at the front.
   */
  replaceWithSummary(
    summaryContent: string,
    keepCount: number,
  ): void {
    if (this.messages.length <= keepCount + 1) return;

    const hasSystem = this.messages.length > 0 && this.messages[0].role === "system";
    const systemMsg = hasSystem ? this.messages[0] : null;
    const rest = hasSystem ? this.messages.slice(1) : this.messages;

    const kept = rest.slice(-keepCount);
    const summary: Message = {
      role: "system",
      content: `[Summary of previous context]:\n${summaryContent}`,
    };

    this.messages = systemMsg ? [systemMsg, summary, ...kept] : [summary, ...kept];
    this.persistAll();
  }

  /**
   * Update the first (system) message content in-place.
   * Does NOT trigger trimming, avoiding unnecessary re-persist of all messages.
   */
  updateSystemPrompt(content: string): void {
    if (this.messages.length > 0 && this.messages[0].role === "system") {
      this.messages[0].content = content;
    } else {
      // Prepend a system message
      this.messages.unshift({ role: "system", content });
    }
    this.persistAll();
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

  /**
   * Token-aware trimming: if estimated tokens exceed maxTokens, greedily
   * drop older message groups (preserving group integrity) until under budget.
   * Always keeps at least the system prompt + 1 user/assistant turn.
   */
  private trimByTokens(): void {
    const estimated = this.estimatedTokens;
    if (estimated <= this.maxTokens) return;

    const msgs = this.messages;
    const hasSystem = msgs.length > 0 && msgs[0].role === "system";
    const protectedCount = hasSystem ? 1 : 0;
    const rest = msgs.slice(protectedCount);

    // --- group into indivisible units (same logic as trimIfNeeded) ---
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

    // --- calculate token cost per group ---
    const groupCost = groups.map(
      (g) => estimateMessagesTokens(g.map((m) => ({ role: m.role, content: m.content }))),
    );
    const totalCost = groupCost.reduce((a, b) => a + b, 0);
    const budget = this.maxTokens - (hasSystem ? estimateMessagesTokens([{ role: msgs[0].role, content: msgs[0].content }]) + 10 : 0);

    if (budget <= 0) {
      this.messages = hasSystem ? [msgs[0]] : [];
      return;
    }

    // Greedily keep from tail until we fit in budget
    const kept: Message[] = [];
    let runningCost = 0;
    for (let k = groups.length - 1; k >= 0; k--) {
      const cost = groupCost[k];
      if (runningCost + cost <= budget) {
        kept.unshift(...groups[k]);
        runningCost += cost;
      } else {
        break;
      }
    }

    this.messages = hasSystem ? [msgs[0], ...kept] : kept;
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
