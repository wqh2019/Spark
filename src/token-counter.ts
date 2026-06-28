/**
 * Estimate token count from text.
 * Uses ~4 characters per token as a reasonable approximation for code/English text.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Truncate text to fit within a max token budget.
 * Appends a truncation notice when truncated.
 */
export function truncateToTokenBudget(text: string, maxTokens: number): string {
  const estimated = estimateTokens(text);
  if (estimated <= maxTokens) return text;
  const maxChars = maxTokens * 4;
  const truncated = text.slice(0, maxChars);
  return `${truncated}\n\n...[truncated: ~${estimated - maxTokens} tokens removed]`;
}

/**
 * Truncate tool result to a max character limit.
 * Default limit is 2000 characters to avoid bloating context with large outputs.
 */
export function truncateToolResult(text: string, maxChars = 2000): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n...[truncated: ${text.length - maxChars} chars removed]`;
}

/**
 * Estimate total tokens for an array of messages.
 * Accounts for per-message overhead (~4 tokens for role + metadata).
 */
export function estimateMessagesTokens(
  messages: Array<{ role: string; content: string }>,
): number {
  let total = 0;
  for (const msg of messages) {
    total += estimateTokens(msg.content) + 4;
  }
  return total;
}
