import { resolve } from "path";
import type { Tool, ToolExecutionResult } from "../../core/types.js";
import { checkPathSafety } from "../safety.js";

const MAX_FILE_SIZE = 1024 * 1024; // 1MB

export const readTool: Tool = {
  definition: {
    name: "read",
    description:
      "Read the contents of a file. Returns the file content with line numbers.",
    input_schema: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Absolute or relative path to the file to read",
        },
        offset: {
          type: "number",
          description: "Line number to start reading from (0-indexed)",
        },
        limit: {
          type: "number",
          description: "Maximum number of lines to read (default: 2000)",
          default: 2000,
        },
      },
      required: ["file_path"],
    },
  },

  async execute(input: Record<string, unknown>): Promise<ToolExecutionResult> {
    const filePath = input.file_path as string;
    const offset = (input.offset as number) || 0;
    const limit = (input.limit as number) || 2000;

    checkPathSafety(filePath);

    try {
      const resolved = resolve(process.cwd(), filePath);
      const file = Bun.file(resolved);
      const exists = await file.exists();
      if (!exists) {
        return { content: `File not found: ${filePath}`, is_error: true };
      }

      if (file.size > MAX_FILE_SIZE) {
        return {
          content: `File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Max: 1MB. Use offset/limit to read a portion.`,
          is_error: true,
        };
      }

      const content = await file.text();
      const lines = content.split("\n");
      const sliced = lines.slice(offset, offset + limit);

      const numbered = sliced
        .map((line, i) => `${offset + i + 1}\t${line}`)
        .join("\n");

      let result = numbered;
      if (offset + limit < lines.length) {
        result += `\n... (${lines.length - offset - limit} more lines)`;
      }

      return { content: result };
    } catch (error) {
      return {
        content: `Failed to read file: ${error instanceof Error ? error.message : String(error)}`,
        is_error: true,
      };
    }
  },
};
