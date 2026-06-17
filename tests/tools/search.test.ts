import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { searchTools, setSearchProjectDir } from "../../src/tools/search.js";
import type { Tool } from "../../src/tools/index.js";

function getTool(name: string): Tool {
  const tool = searchTools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool not found: ${name}`);
  return tool;
}

describe("searchTools export", () => {
  it("exports glob and grep tools", () => {
    const names = searchTools.map((t) => t.name);
    expect(names).toContain("glob_files");
    expect(names).toContain("grep_content");
    expect(searchTools).toHaveLength(2);
  });

  it("neither tool requires confirmation", () => {
    for (const tool of searchTools) {
      expect(tool.requiresConfirmation).toBeFalsy();
    }
  });
});

describe("glob_files", () => {
  let tempDir: string;
  let globFiles: Tool;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "spark-search-test-"));
    setSearchProjectDir(tempDir);
    globFiles = getTool("glob_files");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("finds matching files", async () => {
    writeFileSync(join(tempDir, "a.ts"), "content");
    writeFileSync(join(tempDir, "b.ts"), "content");
    writeFileSync(join(tempDir, "c.js"), "content");

    const result = await globFiles.execute({ pattern: "*.ts" });
    expect(result).toContain("a.ts");
    expect(result).toContain("b.ts");
    expect(result).not.toContain("c.js");
  });

  it("returns sorted file paths", async () => {
    writeFileSync(join(tempDir, "z.ts"), "");
    writeFileSync(join(tempDir, "a.ts"), "");

    const result = await globFiles.execute({ pattern: "*.ts" });
    const lines = result.split("\n");
    expect(lines[0]).toBe("a.ts");
    expect(lines[1]).toBe("z.ts");
  });

  it("returns no matches message when nothing matches", async () => {
    writeFileSync(join(tempDir, "a.ts"), "content");

    const result = await globFiles.execute({ pattern: "*.py" });
    expect(result).toMatch(/No files matching.*\.py.*found/);
  });

  it("searches in specified path", async () => {
    const subDir = join(tempDir, "sub");
    mkdirSync(subDir);
    writeFileSync(join(subDir, "file.txt"), "hello");

    const result = await globFiles.execute({ pattern: "*.txt", path: "sub" });
    expect(result).toContain("file.txt");
  });
});

describe("grep_content", () => {
  let tempDir: string;
  let grepContent: Tool;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "spark-search-test-"));
    setSearchProjectDir(tempDir);
    grepContent = getTool("grep_content");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("finds matching lines", async () => {
    writeFileSync(join(tempDir, "code.ts"), "function hello() {\n  return 42;\n}\n");

    const result = await grepContent.execute({ pattern: "hello" });
    expect(result).toContain("code.ts:1:");
    expect(result).toContain("hello");
  });

  it("returns file:line: content format", async () => {
    writeFileSync(join(tempDir, "sample.txt"), "first line\nsecond line\nthird line\n");

    const result = await grepContent.execute({ pattern: "second" });
    expect(result).toContain("sample.txt:2:");
  });

  it("reports no matches message", async () => {
    writeFileSync(join(tempDir, "code.ts"), "nothing here\n");

    const result = await grepContent.execute({ pattern: "missing" });
    expect(result).toMatch(/No matches for.*missing/);
  });

  it("returns error for invalid regex", async () => {
    writeFileSync(join(tempDir, "code.ts"), "content\n");

    const result = await grepContent.execute({ pattern: "[invalid" });
    expect(result).toMatch(/invalid regex/i);
  });

  it("appends summary with match count", async () => {
    writeFileSync(join(tempDir, "code.ts"), "hello world\nhello again\n");

    const result = await grepContent.execute({ pattern: "hello" });
    expect(result).toMatch(/Found \d+ matches? in \d+ files?/);
  });

  it("searches case-insensitively", async () => {
    writeFileSync(join(tempDir, "code.ts"), "Hello World\n");

    const result = await grepContent.execute({ pattern: "hello" });
    expect(result).toContain("code.ts:1:");
  });

  it("skips .git and node_modules directories", async () => {
    mkdirSync(join(tempDir, ".git"));
    mkdirSync(join(tempDir, "node_modules"));
    writeFileSync(join(tempDir, ".git", "config"), "hello\n");
    writeFileSync(join(tempDir, "node_modules", "pkg.ts"), "hello\n");
    writeFileSync(join(tempDir, "src.ts"), "hello\n");

    const result = await grepContent.execute({ pattern: "hello" });
    expect(result).toContain("src.ts");
    expect(result).not.toContain(".git");
    expect(result).not.toContain("node_modules");
  });
});
