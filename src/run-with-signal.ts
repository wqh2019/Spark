import type { Agent } from "./agent.js";
import { renderError } from "./render.js";

/**
 * Run a single agent turn with SIGINT (Ctrl+C) wired to an AbortController so
 * the user can interrupt long-running queries gracefully. The SIGINT listener
 * is always removed afterwards (on success, error, or interruption).
 *
 * Extracted from cli.ts so it can be unit-tested without triggering cli's
 * top-level `program.parse()` side effect.
 */
export async function runWithSignal(
  agent: Agent,
  message: string,
): Promise<string> {
  const controller = new AbortController();
  const onSigInt = () => controller.abort();
  process.once("SIGINT", onSigInt);
  try {
    return await agent.run(message, controller.signal);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    renderError(msg);
    return msg;
  } finally {
    process.removeListener("SIGINT", onSigInt);
  }
}
