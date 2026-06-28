import { describe, it, expect, vi, beforeEach } from "vitest";

// Capture stdout/stderr writes
const stdoutWrites: string[] = [];
const stderrWrites: string[] = [];

vi.stubGlobal("process", {
  ...process,
  stdout: { write: (data: string) => { stdoutWrites.push(data); return true; } },
  stderr: { write: (data: string) => { stderrWrites.push(data); return true; } },
});

const {
  renderTextDelta,
  renderTextComplete,
  renderToolStart,
  renderToolResult,
  renderError,
  renderInfo,
  resetMarkdownState,
  startSpinner,
  stopSpinner,
} = await import("../src/render.js");

describe("renderTextDelta", () => {
  beforeEach(() => {
    stdoutWrites.length = 0;
    resetMarkdownState();
  });

  it("writes text to stdout", () => {
    renderTextDelta("hello\n");
    expect(stdoutWrites.join("")).toContain("hello");
  });

  it("buffers partial lines until newline", () => {
    renderTextDelta("hel");
    expect(stdoutWrites.join("")).toBe("");
    renderTextDelta("lo\n");
    expect(stdoutWrites.join("")).toContain("hello");
  });
});

describe("renderTextComplete", () => {
  beforeEach(() => {
    stdoutWrites.length = 0;
    resetMarkdownState();
  });

  it("writes a newline to stdout when buffer is empty", () => {
    renderTextComplete();
    expect(stdoutWrites.join("")).toBe("\n");
  });

  it("flushes buffered text then newline", () => {
    renderTextDelta("pending");
    stdoutWrites.length = 0;
    renderTextComplete();
    const output = stdoutWrites.join("");
    expect(output).toContain("pending");
    expect(output).toContain("\n");
  });
});

describe("renderToolStart", () => {
  beforeEach(() => { stderrWrites.length = 0; });

  it("writes tool name and args to stderr", () => {
    renderToolStart("read_file", { file_path: "/tmp/test.txt" });
    const output = stderrWrites.join("");
    expect(output).toContain("read_file");
    expect(output).toContain("file_path=/tmp/test.txt");
  });

  it("truncates long arg values", () => {
    const longVal = "x".repeat(100);
    renderToolStart("write_file", { content: longVal });
    const output = stderrWrites.join("");
    expect(output).toContain("...");
    expect(output).not.toContain(longVal);
  });
});

describe("renderToolResult", () => {
  beforeEach(() => { stderrWrites.length = 0; });

  it("writes tool result to stderr", () => {
    renderToolResult("read_file", "file contents here");
    const output = stderrWrites.join("");
    expect(output).toContain("read_file");
    expect(output).toContain("file contents here");
  });

  it("truncates results with more than 10 lines", () => {
    const lines = Array.from({ length: 15 }, (_, i) => `line ${i + 1}`).join("\n");
    renderToolResult("tool", lines);
    const output = stderrWrites.join("");
    expect(output).toContain("truncated");
    expect(output).not.toContain("line 15");
  });

  it("does not truncate results with 10 or fewer lines", () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join("\n");
    renderToolResult("tool", lines);
    const output = stderrWrites.join("");
    expect(output).not.toContain("truncated");
    expect(output).toContain("line 10");
  });

  it("renders error prefix for isError=true", () => {
    renderToolResult("tool", "failed", true);
    const output = stderrWrites.join("");
    expect(output).toContain("ERROR");
  });
});

describe("renderError", () => {
  beforeEach(() => { stderrWrites.length = 0; });

  it("writes error message to stderr", () => {
    renderError("something went wrong");
    const output = stderrWrites.join("");
    expect(output).toContain("something went wrong");
  });
});

describe("renderInfo", () => {
  beforeEach(() => { stderrWrites.length = 0; });

  it("writes info message to stderr", () => {
    renderInfo("session started");
    const output = stderrWrites.join("");
    expect(output).toContain("session started");
  });
});

describe("spinner", () => {
  beforeEach(() => { stderrWrites.length = 0; });

  it("startSpinner writes initial frame", () => {
    startSpinner("Thinking");
    const output = stderrWrites.join("");
    expect(output).toContain("Thinking");
  });

  it("stopSpinner clears the line", () => {
    stopSpinner();
    // After stop, the line should be cleared (ESC[K)
    // Just verify no crash
  });
});
