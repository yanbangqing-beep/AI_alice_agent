import type { Tool, ToolExecutionResult } from "../../core/types.js";
import { checkPathSafety } from "../safety.js";

export const editTool: Tool = {
  definition: {
    name: "edit",
    description:
      "Perform exact string replacement in a file. The old_string must uniquely match a section of the file.",
    input_schema: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Path to the file to edit",
        },
        old_string: {
          type: "string",
          description: "The exact string to find and replace (must be unique in the file)",
        },
        new_string: {
          type: "string",
          description: "The string to replace old_string with",
        },
        replace_all: {
          type: "boolean",
          description: "Replace all occurrences (default: false)",
          default: false,
        },
      },
      required: ["file_path", "old_string", "new_string"],
    },
  },

  async execute(input: Record<string, unknown>): Promise<ToolExecutionResult> {
    const filePath = input.file_path as string;
    const oldString = input.old_string as string;
    const newString = input.new_string as string;
    const replaceAll = (input.replace_all as boolean) || false;

    checkPathSafety(filePath);

    try {
      const file = Bun.file(filePath);
      const exists = await file.exists();
      if (!exists) {
        return { content: `File not found: ${filePath}`, is_error: true };
      }

      const content = await file.text();

      if (oldString === newString) {
        return {
          content: "old_string and new_string are identical, no changes made",
          is_error: true,
        };
      }

      if (!content.includes(oldString)) {
        return {
          content: `old_string not found in ${filePath}. Make sure it matches exactly.`,
          is_error: true,
        };
      }

      if (!replaceAll) {
        const firstIndex = content.indexOf(oldString);
        const secondIndex = content.indexOf(oldString, firstIndex + 1);
        if (secondIndex !== -1) {
          return {
            content: `old_string is not unique in ${filePath} (found multiple matches). Provide more context or use replace_all: true.`,
            is_error: true,
          };
        }
      }

      const newContent = replaceAll
        ? content.replaceAll(oldString, newString)
        : content.replace(oldString, newString);

      await Bun.write(filePath, newContent);

      const count = replaceAll
        ? content.split(oldString).length - 1
        : 1;

      return {
        content: `Successfully replaced ${count} occurrence(s) in ${filePath}`,
      };
    } catch (error) {
      return {
        content: `Failed to edit file: ${error instanceof Error ? error.message : String(error)}`,
        is_error: true,
      };
    }
  },
};
