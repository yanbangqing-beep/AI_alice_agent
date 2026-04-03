import type { Tool, ToolDefinition, ToolExecutionResult } from "../core/types.js";
import { ToolError } from "../core/errors.js";

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): void {
    if (this.tools.has(tool.definition.name)) {
      throw new ToolError(
        `Tool "${tool.definition.name}" is already registered`,
        tool.definition.name,
      );
    }
    this.tools.set(tool.definition.name, tool);
  }

  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  getDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  async execute(
    name: string,
    input: Record<string, unknown>,
  ): Promise<ToolExecutionResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        content: `Unknown tool: "${name}". Available tools: ${Array.from(this.tools.keys()).join(", ")}`,
        is_error: true,
      };
    }

    try {
      return await tool.execute(input);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: `Tool "${name}" failed: ${message}`,
        is_error: true,
      };
    }
  }

  list(): string[] {
    return Array.from(this.tools.keys());
  }

  clear(): void {
    this.tools.clear();
  }
}
