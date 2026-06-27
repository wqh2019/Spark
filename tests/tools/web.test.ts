import { describe, it, expect, vi } from "vitest";
import { createWebTools } from "../../src/tools/web.js";
import type { Tool } from "../../src/tools/index.js";

function getTool(tools: Tool[], name: string): Tool {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool not found: ${name}`);
  return tool;
}

describe("createWebTools export", () => {
  it("exports web_fetch tool", () => {
    const tools = createWebTools();
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("web_fetch");
  });

  it("does not require confirmation", () => {
    const tools = createWebTools();
    const webFetch = getTool(tools, "web_fetch");
    expect(webFetch.requiresConfirmation).toBeFalsy();
  });
});

describe("web_fetch parameter validation", () => {
  const webFetch = getTool(createWebTools(), "web_fetch");

  it("requires url", () => {
    expect(webFetch.required).toContain("url");
  });

  it("describes parameters correctly", () => {
    const params = webFetch.parameters as Record<string, unknown>;
    expect(params.url).toBeDefined();
    expect(params.max_length).toBeDefined();
  });
});

describe("web_fetch URL validation", () => {
  const webFetch = getTool(createWebTools(), "web_fetch");

  it("rejects invalid URL", async () => {
    const result = await webFetch.execute({ url: "not-a-url" });
    expect(result).toContain("Invalid URL");
  });

  it("rejects non-HTTP protocols", async () => {
    const result = await webFetch.execute({ url: "file:///etc/passwd" });
    expect(result).toContain("Only HTTP and HTTPS");
  });

  it("rejects ftp protocol", async () => {
    const result = await webFetch.execute({ url: "ftp://example.com/file" });
    expect(result).toContain("Only HTTP and HTTPS");
  });
});
