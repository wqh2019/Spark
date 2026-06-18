import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  existsSync,
  mkdtempSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ToolRegistry } from "../../src/tools/index.js";
import type { Tool } from "../../src/tools/index.js";
import { fileTools, setProjectDir } from "../../src/tools/file.js";

// Helper to find a tool by name from the fileTools array
function getTool(name: string): Tool {
  const tool = fileTools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool not found: ${name}`);
  return tool;
}

describe("ToolRegistry", () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  it("registers a tool and retrieves it by name", () => {
    const tool: Tool = {
      name: "test_tool",
      description: "A test tool",
      parameters: { foo: { type: "string" } },
      execute: async () => "ok",
    };
    registry.register(tool);
    expect(registry.get("test_tool")).toBe(tool);
  });

  it("returns undefined for unregistered tool", () => {
    expect(registry.get("nonexistent")).toBeUndefined();
  });

  it("lists all registered tools", () => {
    const toolA: Tool = {
      name: "tool_a",
      description: "Tool A",
      parameters: {},
      execute: async () => "a",
    };
    const toolB: Tool = {
      name: "tool_b",
      description: "Tool B",
      parameters: {},
      execute: async () => "b",
    };
    registry.register(toolA);
    registry.register(toolB);
    const tools = registry.list();
    expect(tools).toHaveLength(2);
    expect(tools.map((t) => t.name)).toEqual(
      expect.arrayContaining(["tool_a", "tool_b"]),
    );
  });

  it("getSchemas returns OpenAI function-calling format", () => {
    const tool: Tool = {
      name: "read_file",
      description: "Read a file",
      parameters: {
        file_path: { type: "string", description: "Path to file" },
      },
      execute: async () => "ok",
    };
    registry.register(tool);
    const schemas = registry.getSchemas();
    expect(schemas).toHaveLength(1);
    expect(schemas[0]).toEqual({
      type: "function",
      function: {
        name: "read_file",
        description: "Read a file",
        parameters: {
          type: "object",
          properties: {
            file_path: { type: "string", description: "Path to file" },
          },
        },
      },
    });
  });
});

describe("read_file", () => {
  let tempDir: string;
  let readFile: Tool;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "spark-test-"));
    setProjectDir(tempDir);
    readFile = getTool("read_file");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("reads file content with line numbers", async () => {
    const filePath = join(tempDir, "test.txt");
    writeFileSync(filePath, "hello\nworld");
    const result = await readFile.execute({ file_path: filePath });
    // Format: right-padded line number + tab + content
    expect(result).toContain("1\thello");
    expect(result).toContain("2\tworld");
  });

  it("returns error for missing file", async () => {
    const result = await readFile.execute({
      file_path: join(tempDir, "nonexistent.txt"),
    });
    expect(result).toContain("Error reading file");
  });

  it("respects offset and limit", async () => {
    const filePath = join(tempDir, "lines.txt");
    const lines = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`);
    writeFileSync(filePath, lines.join("\n"));
    const result = await readFile.execute({
      file_path: filePath,
      offset: 2,
      limit: 3,
    });
    // Should show lines 3-5 (offset is 0-based from spec: defaults 0)
    expect(result).toContain("3\tline 3");
    expect(result).toContain("4\tline 4");
    expect(result).toContain("5\tline 5");
    expect(result).not.toContain("line 2");
    expect(result).not.toContain("line 6");
  });
});

describe("write_file", () => {
  let tempDir: string;
  let writeFile: Tool;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "spark-test-"));
    setProjectDir(tempDir);
    writeFile = getTool("write_file");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("writes content to file", async () => {
    const filePath = join(tempDir, "output.txt");
    const result = await writeFile.execute({
      file_path: filePath,
      content: "hello world",
    });
    expect(result).toContain("Successfully wrote");
    expect(result).toContain("11 characters");
    expect(result).toContain(filePath);
    expect(readFileSync(filePath, "utf-8")).toBe("hello world");
  });

  it("creates parent directories if needed", async () => {
    const filePath = join(tempDir, "sub", "dir", "output.txt");
    const result = await writeFile.execute({
      file_path: filePath,
      content: "nested",
    });
    expect(result).toContain("Successfully wrote");
    expect(existsSync(filePath)).toBe(true);
    expect(readFileSync(filePath, "utf-8")).toBe("nested");
  });
});

describe("edit_file", () => {
  let tempDir: string;
  let editFile: Tool;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "spark-test-"));
    setProjectDir(tempDir);
    editFile = getTool("edit_file");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("replaces exact string in file", async () => {
    const filePath = join(tempDir, "edit.txt");
    writeFileSync(filePath, "hello world");
    const result = await editFile.execute({
      file_path: filePath,
      old_string: "world",
      new_string: "there",
    });
    expect(result).toContain("Successfully edited");
    expect(readFileSync(filePath, "utf-8")).toBe("hello there");
  });

  it("errors if old_string not found", async () => {
    const filePath = join(tempDir, "edit.txt");
    writeFileSync(filePath, "hello world");
    const result = await editFile.execute({
      file_path: filePath,
      old_string: "missing",
      new_string: "replacement",
    });
    expect(result).toMatch(/error/i);
  });

  it("errors if old_string appears multiple times without replace_all", async () => {
    const filePath = join(tempDir, "edit.txt");
    writeFileSync(filePath, "aaa bbb aaa");
    const result = await editFile.execute({
      file_path: filePath,
      old_string: "aaa",
      new_string: "ccc",
    });
    expect(result).toMatch(/error/i);
  });

  it("replaces all occurrences when replace_all is true", async () => {
    const filePath = join(tempDir, "edit.txt");
    writeFileSync(filePath, "aaa bbb aaa");
    const result = await editFile.execute({
      file_path: filePath,
      old_string: "aaa",
      new_string: "ccc",
      replace_all: true,
    });
    expect(result).toContain("Successfully edited");
    expect(readFileSync(filePath, "utf-8")).toBe("ccc bbb ccc");
  });
});

describe("list_dir", () => {
  let tempDir: string;
  let listDir: Tool;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "spark-test-"));
    setProjectDir(tempDir);
    listDir = getTool("list_dir");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("lists directory contents with dirs marked with /", async () => {
    mkdirSync(join(tempDir, "subdir"));
    writeFileSync(join(tempDir, "file.txt"), "content");
    const result = await listDir.execute({ dir_path: tempDir });
    expect(result).toContain("subdir/");
    expect(result).toContain("file.txt");
  });

  it("defaults to current directory when no path given", async () => {
    // Just verify it doesn't throw - it will list the actual CWD
    const result = await listDir.execute({});
    expect(typeof result).toBe("string");
  });

  it("shows file sizes", async () => {
    writeFileSync(join(tempDir, "sized.txt"), "hello");
    const result = await listDir.execute({ dir_path: tempDir });
    expect(result).toContain("sized.txt");
  });
});

describe("fileTools export", () => {
  it("exports all 4 file tools", () => {
    const names = fileTools.map((t) => t.name);
    expect(names).toContain("read_file");
    expect(names).toContain("write_file");
    expect(names).toContain("edit_file");
    expect(names).toContain("list_dir");
    expect(fileTools).toHaveLength(4);
  });

  it("write_file and edit_file require confirmation", () => {
    const writeFile = getTool("write_file");
    const editFile = getTool("edit_file");
    expect(writeFile.requiresConfirmation).toBe(true);
    expect(editFile.requiresConfirmation).toBe(true);
  });

  it("read_file and list_dir do not require confirmation", () => {
    const readFile = getTool("read_file");
    const listDir = getTool("list_dir");
    expect(readFile.requiresConfirmation).toBeFalsy();
    expect(listDir.requiresConfirmation).toBeFalsy();
  });
});

describe("file tools path safety", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "spark-test-"));
    setProjectDir(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("read_file blocks paths outside project", async () => {
    const readFile = getTool("read_file");
    const result = await readFile.execute({ file_path: "/etc/passwd" });
    expect(result).toContain("outside project");
  });

  it("write_file blocks paths outside project", async () => {
    const writeFile = getTool("write_file");
    const result = await writeFile.execute({
      file_path: "/tmp/evil.txt",
      content: "hacked",
    });
    expect(result).toContain("outside project");
  });

  it("edit_file blocks paths outside project", async () => {
    const editFile = getTool("edit_file");
    const result = await editFile.execute({
      file_path: "/etc/hosts",
      old_string: "a",
      new_string: "b",
    });
    expect(result).toContain("outside project");
  });

  it("list_dir blocks paths outside project", async () => {
    const listDir = getTool("list_dir");
    const result = await listDir.execute({ dir_path: "/etc" });
    expect(result).toContain("outside project");
  });
});

describe("file tools file size check", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "spark-test-"));
    // Set a very small max file size to trigger the check
    setProjectDir(tempDir, 50);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("read_file blocks oversized files", async () => {
    const readFile = getTool("read_file");
    // Write a file larger than 50 bytes
    const filePath = join(tempDir, "big.txt");
    writeFileSync(filePath, "x".repeat(100));
    const result = await readFile.execute({ file_path: filePath });
    expect(result).toContain("exceeds limit");
  });

  it("edit_file blocks oversized files", async () => {
    const editFile = getTool("edit_file");
    const filePath = join(tempDir, "big.txt");
    writeFileSync(filePath, "x".repeat(100));
    const result = await editFile.execute({
      file_path: filePath,
      old_string: "x",
      new_string: "y",
    });
    expect(result).toContain("exceeds limit");
  });
});
