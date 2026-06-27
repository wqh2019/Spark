export interface ToolParameter {
  type: "string" | "number" | "boolean" | "array" | "object";
  description?: string;
  items?: ToolParameter;
  enum?: string[];
}

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  required?: string[];
  execute: (args: Record<string, unknown>) => Promise<string>;
  requiresConfirmation?: boolean;
}

export interface ToolSchema {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
}

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  list(): Tool[] {
    return Array.from(this.tools.values());
  }

  getSchemas(): ToolSchema[] {
    return this.list().map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: "object",
          properties: tool.parameters,
          ...(tool.required ? { required: tool.required } : {}),
        },
      },
    }));
  }
}

/**
 * Create a fresh ToolRegistry with all built-in tools registered.
 * Uses dynamic imports to avoid circular dependency issues
 * (tool modules previously imported from this index module).
 *
 * Returns a registry with 16 tools:
 *   - fileTools: read_file, write_file, edit_file, list_dir
 *   - shellTools: run_command
 *   - searchTools: glob_files, grep_content
 *   - devTools: git_status, git_diff, git_add, git_commit, git_log, git_checkout, format, lint, test
 *   - webTools: web_fetch
 */
export async function createToolRegistry(): Promise<ToolRegistry> {
  const [{ fileTools }, { shellTools }, { searchTools }, { devTools }, { webTools }] =
    await Promise.all([
      import("./file.js"),
      import("./shell.js"),
      import("./search.js"),
      import("./dev.js"),
      import("./web.js"),
    ]);

  const registry = new ToolRegistry();
  const allTools = [...fileTools, ...shellTools, ...searchTools, ...devTools, ...webTools];
  for (const tool of allTools) {
    registry.register(tool);
  }
  return registry;
}
