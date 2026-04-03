import type { Tool, ToolExecutionResult } from "../../core/types.js";
import { checkPathSafety } from "../safety.js";
import { mkdirSync } from "fs";
import { dirname } from "path";

export const writeTool: Tool = {
  definition: {
    name: "write",
    description:
      "Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Creates parent directories as needed.",
    input_schema: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Absolute or relative path to the file to write",
        },
        content: {
          type: "string",
          description: "The content to write to the file",
        },
      },
      required: ["file_path", "content"],
    },
  },

  async execute(input: Record<string, unknown>): Promise<ToolExecutionResult> {
    const filePath = input.file_path as string;
    const content = input.content as string;

    checkPathSafety(filePath);

    try {
      // Ensure parent directory exists
      const dir = dirname(filePath);
      mkdirSync(dir, { recursive: true });

      await Bun.write(filePath, content);

      const lines = content.split("\n").length;
      return {
        content: `Successfully wrote ${lines} lines to ${filePath}`,
      };
    } catch (error) {
      return {
        content: `Failed to write file: ${error instanceof Error ? error.message : String(error)}`,
        is_error: true,
      };
    }
  },
};
