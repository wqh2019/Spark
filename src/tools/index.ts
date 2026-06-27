import type { SafetyChecker } from "../safety.js";
import { createFileTools } from "./file.js";
import { createShellTools } from "./shell.js";
import { createSearchTools } from "./search.js";
import { createDevTools } from "./dev.js";
import { createWebTools } from "./web.js";

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

/**
 * Context object for dependency injection into tool factory functions.
 * Each Agent instance creates its own ToolContext, replacing module-level
 * global state (setProjectDir / setShellProjectDir / etc.).
 */
export interface ToolContext {
  projectDir: string;
  safetyChecker: SafetyChecker;
}

/**
 * Plugin interface for dynamic tool registration.
 * A ToolPlugin registers one or more tools during ToolRegistry creation.
 */
export interface ToolPlugin {
  name: string;
  register(ctx: ToolContext): Tool | Tool[];
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

  /** Remove a tool by name. Returns true if the tool existed. */
  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  /** Check if a tool is registered. */
  has(name: string): boolean {
    return this.tools.has(name);
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
 * Uses dependency injection (ToolContext) instead of module-level global state.
 *
 * @param ctx - ToolContext with projectDir and safetyChecker
 * @param plugins - Optional array of ToolPlugin for dynamic extension
 *
 * Returns a registry with 17 tools:
 *   - fileTools: read_file, write_file, edit_file, list_dir
 *   - shellTools: run_command
 *   - searchTools: glob_files, grep_content
 *   - devTools: git_status, git_diff, git_add, git_commit, git_log, git_checkout, format, lint, test
 *   - webTools: web_fetch
 */
export function createToolRegistry(
  ctx: ToolContext,
  plugins?: ToolPlugin[],
): ToolRegistry {
  const registry = new ToolRegistry();
  const allTools = [
    ...createFileTools(ctx),
    ...createShellTools(ctx),
    ...createSearchTools(ctx),
    ...createDevTools(ctx),
    ...createWebTools(),
  ];
  for (const tool of allTools) {
    registry.register(tool);
  }

  // Load plugins
  if (plugins) {
    for (const plugin of plugins) {
      const result = plugin.register(ctx);
      const tools = Array.isArray(result) ? result : [result];
      for (const tool of tools) {
        registry.register(tool);
      }
    }
  }

  return registry;
}
