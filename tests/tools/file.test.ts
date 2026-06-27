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
import type { Tool, ToolContext } from "../../src/tools/index.js";
import { createFileTools } from "../../src/tools/file.js";
import { SafetyChecker } from "../../src/safety.js";

function makeContext(dir: string, maxFileSize?: number): ToolContext {
  return {
    projectDir: dir,
    safetyChecker: new SafetyChecker({ projectRoot: dir, maxFileSize }),
  };
}

// Helper to find a tool by name from a tools array
function getTool(tools: Tool[], name: string): Tool {
  const tool = tools.find((t) => t.name === name);
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

  it("unregister removes a tool", () => {
    const tool: Tool = {
      name: "test_tool",
      description: "A test tool",
      parameters: {},
      execute: async () => "ok",
    };
    registry.register(tool);
    expect(registry.has("test_tool")).toBe(true);
    expect(registry.unregister("test_tool")).toBe(true);
    expect(registry.has("test_tool")).toBe(false);
    expect(registry.unregister("nonexistent")).toBe(false);
  });
});

describe("read_file", () => {
  let tempDir: string;
  let readFile: Tool;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "spark-test-"));
    const ctx = makeContext(tempDir);
    readFile = getTool(createFileTools(ctx), "read_file");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("reads file content with line numbers", async () => {
    const filePath = join(tempDir, "test.txt");
    writeFileSync(filePath, "hello\nworld");
    const result = await readFile.execute({ file_path: filePath });
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
    const ctx = makeContext(tempDir);
    writeFile = getTool(createFileTools(ctx), "write_file");
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
    const ctx = makeContext(tempDir);
    editFile = getTool(createFileTools(ctx), "edit_file");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("string replacement mode (existing behavior)", () => {
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

    it("handles CRLF line endings in string replacement", async () => {
      const filePath = join(tempDir, "crlf.txt");
      writeFileSync(filePath, "line1\r\nline2\r\nline3");
      const result = await editFile.execute({
        file_path: filePath,
        old_string: "line2",
        new_string: "replaced",
      });
      expect(result).toContain("Successfully edited");
      const content = readFileSync(filePath, "utf-8");
      expect(content).toContain("replaced");
      expect(content).not.toContain("line2");
    });
  });

  describe("line number editing mode (C2 new feature)", () => {
    it("replaces a single line by line number", async () => {
      const filePath = join(tempDir, "lines.txt");
      writeFileSync(filePath, "line1\nline2\nline3");
      const result = await editFile.execute({
        file_path: filePath,
        start_line: 2,
        end_line: 2,
        new_string: "replaced",
      });
      expect(result).toContain("replaced lines 2-2");
      expect(readFileSync(filePath, "utf-8")).toBe("line1\nreplaced\nline3");
    });

    it("replaces a range of lines", async () => {
      const filePath = join(tempDir, "range.txt");
      writeFileSync(filePath, "line1\nline2\nline3\nline4");
      const result = await editFile.execute({
        file_path: filePath,
        start_line: 2,
        end_line: 3,
        new_string: "new line",
      });
      expect(result).toContain("replaced lines 2-3");
      expect(readFileSync(filePath, "utf-8")).toBe("line1\nnew line\nline4");
    });

    it("replaces a range with multiple new lines", async () => {
      const filePath = join(tempDir, "multi.txt");
      writeFileSync(filePath, "line1\nline2\nline3");
      const result = await editFile.execute({
        file_path: filePath,
        start_line: 2,
        end_line: 2,
        new_string: "replaced1\nreplaced2",
      });
      expect(result).toContain("replaced lines 2-2");
      expect(readFileSync(filePath, "utf-8")).toBe(
        "line1\nreplaced1\nreplaced2\nline3",
      );
    });

    it("reports error for out-of-range start_line", async () => {
      const filePath = join(tempDir, "short.txt");
      writeFileSync(filePath, "only one line");
      const result = await editFile.execute({
        file_path: filePath,
        start_line: 5,
        end_line: 5,
        new_string: "nope",
      });
      expect(result).toContain("out of range");
    });

    it("reports error when end_line < start_line", async () => {
      const filePath = join(tempDir, "lines.txt");
      writeFileSync(filePath, "a\nb\nc");
      const result = await editFile.execute({
        file_path: filePath,
        start_line: 3,
        end_line: 1,
        new_string: "nope",
      });
      expect(result).toContain("out of range");
    });
  });
});

describe("list_dir", () => {
  let tempDir: string;
  let listDir: Tool;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "spark-test-"));
    const ctx = makeContext(tempDir);
    listDir = getTool(createFileTools(ctx), "list_dir");
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
    const result = await listDir.execute({});
    expect(typeof result).toBe("string");
  });

  it("shows file sizes", async () => {
    writeFileSync(join(tempDir, "sized.txt"), "hello");
    const result = await listDir.execute({ dir_path: tempDir });
    expect(result).toContain("sized.txt");
  });
});

describe("createFileTools export", () => {
  it("exports all 4 file tools", () => {
    const ctx = makeContext(process.cwd());
    const tools = createFileTools(ctx);
    const names = tools.map((t) => t.name);
    expect(names).toContain("read_file");
    expect(names).toContain("write_file");
    expect(names).toContain("edit_file");
    expect(names).toContain("list_dir");
    expect(tools).toHaveLength(4);
  });

  it("write_file and edit_file require confirmation", () => {
    const ctx = makeContext(process.cwd());
    const tools = createFileTools(ctx);
    expect(getTool(tools, "write_file").requiresConfirmation).toBe(true);
    expect(getTool(tools, "edit_file").requiresConfirmation).toBe(true);
  });

  it("read_file and list_dir do not require confirmation", () => {
    const ctx = makeContext(process.cwd());
    const tools = createFileTools(ctx);
    expect(getTool(tools, "read_file").requiresConfirmation).toBeFalsy();
    expect(getTool(tools, "list_dir").requiresConfirmation).toBeFalsy();
  });
});

describe("file tools path safety", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "spark-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("read_file blocks paths outside project", async () => {
    const ctx = makeContext(tempDir);
    const readFile = getTool(createFileTools(ctx), "read_file");
    const result = await readFile.execute({ file_path: "/etc/passwd" });
    expect(result).toContain("outside project");
  });

  it("write_file blocks paths outside project", async () => {
    const ctx = makeContext(tempDir);
    const writeFile = getTool(createFileTools(ctx), "write_file");
    const result = await writeFile.execute({
      file_path: "/tmp/evil.txt",
      content: "hacked",
    });
    expect(result).toContain("outside project");
  });

  it("edit_file blocks paths outside project", async () => {
    const ctx = makeContext(tempDir);
    const editFile = getTool(createFileTools(ctx), "edit_file");
    const result = await editFile.execute({
      file_path: "/etc/hosts",
      old_string: "a",
      new_string: "b",
    });
    expect(result).toContain("outside project");
  });

  it("list_dir blocks paths outside project", async () => {
    const ctx = makeContext(tempDir);
    const listDir = getTool(createFileTools(ctx), "list_dir");
    const result = await listDir.execute({ dir_path: "/etc" });
    expect(result).toContain("outside project");
  });
});

describe("file tools file size check", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "spark-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("read_file blocks oversized files", async () => {
    const ctx = makeContext(tempDir, 50);
    const readFile = getTool(createFileTools(ctx), "read_file");
    const filePath = join(tempDir, "big.txt");
    writeFileSync(filePath, "x".repeat(100));
    const result = await readFile.execute({ file_path: filePath });
    expect(result).toContain("exceeds limit");
  });

  it("edit_file blocks oversized files", async () => {
    const ctx = makeContext(tempDir, 50);
    const editFile = getTool(createFileTools(ctx), "edit_file");
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
