import { describe, it, expect, vi } from "vitest";
import { runWithSignal } from "../src/run-with-signal.js";
import type { Agent } from "../src/agent.js";

function makeFakeAgent(
  runImpl: (msg: string, signal?: AbortSignal) => Promise<string>,
): Agent {
  return { run: vi.fn(runImpl) } as unknown as Agent;
}

describe("runWithSignal", () => {
  it("passes an AbortSignal to agent.run", async () => {
    const agent = makeFakeAgent(async () => "done");
    await runWithSignal(agent, "hello");
    expect(agent.run).toHaveBeenCalledWith("hello", expect.any(AbortSignal));
  });

  it("removes SIGINT listener after normal completion", async () => {
    const before = process.listenerCount("SIGINT");
    const agent = makeFakeAgent(async () => "done");
    await runWithSignal(agent, "hello");
    expect(process.listenerCount("SIGINT")).toBe(before);
  });

  it("removes SIGINT listener and surfaces message after agent.run throws", async () => {
    const before = process.listenerCount("SIGINT");
    const agent = makeFakeAgent(async () => {
      throw new Error("boom");
    });
    const result = await runWithSignal(agent, "hello");
    expect(result).toBe("boom");
    expect(process.listenerCount("SIGINT")).toBe(before);
  });

  it("aborts agent.run when the SIGINT handler fires", async () => {
    let captured: AbortSignal | undefined;
    const agent = makeFakeAgent(async (_msg, signal) => {
      captured = signal;
      return new Promise<string>((resolve) => {
        if (signal?.aborted) return resolve("aborted");
        signal?.addEventListener("abort", () => resolve("aborted"));
      });
    });

    // Spy on process.once/removeListener to grab the SIGINT handler without
    // emitting a real SIGINT (which would interfere with the test runner).
    const onceSpy = vi.spyOn(process, "once");
    const removeSpy = vi.spyOn(process, "removeListener");

    const promise = runWithSignal(agent, "long task");

    const sigintCall = onceSpy.mock.calls.find((c) => c[0] === "SIGINT");
    expect(sigintCall).toBeDefined();
    const handler = sigintCall![1] as () => void;

    handler(); // simulate Ctrl+C
    await promise;

    expect(captured?.aborted).toBe(true);
    expect(removeSpy).toHaveBeenCalledWith("SIGINT", handler);

    onceSpy.mockRestore();
    removeSpy.mockRestore();
  });
});
