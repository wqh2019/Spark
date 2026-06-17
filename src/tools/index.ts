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

// Default global registry for backward compatibility with other tool modules
const defaultRegistry = new ToolRegistry();

export function registerTool(tool: Tool): void {
  defaultRegistry.register(tool);
}

export function getTool(name: string): Tool | undefined {
  return defaultRegistry.get(name);
}

export function getAllTools(): Tool[] {
  return defaultRegistry.list();
}

export function getToolSchemas(): ToolSchema[] {
  return defaultRegistry.getSchemas();
}

export interface ToolCallResult {
  toolName: string;
  result: string;
  error?: boolean;
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
): Promise<ToolCallResult> {
  const tool = getTool(name);
  if (!tool) {
    return { toolName: name, result: `Unknown tool: ${name}`, error: true };
  }

  try {
    const result = await tool.execute(args);
    return { toolName: name, result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { toolName: name, result: `Tool error: ${message}`, error: true };
  }
}
