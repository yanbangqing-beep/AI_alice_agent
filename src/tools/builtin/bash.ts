import type { Tool, ToolExecutionResult } from "../../core/types.js";
import { checkCommandSafety } from "../safety.js";

const MAX_OUTPUT = 100_000; // 100KB output cap

export const bashTool: Tool = {
  definition: {
    name: "bash",
    description:
      "Execute a bash command and return its output. Use for system commands, git operations, running scripts, etc.",
    input_schema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The bash command to execute",
        },
        timeout: {
          type: "number",
          description: "Timeout in milliseconds (default: 120000)",
          default: 120000,
        },
      },
      required: ["command"],
    },
  },

  async execute(input: Record<string, unknown>): Promise<ToolExecutionResult> {
    const command = input.command as string;
    const timeout = (input.timeout as number) || 120000;

    checkCommandSafety(command);

    try {
      const proc = Bun.spawn(["bash", "-c", command], {
        stdout: "pipe",
        stderr: "pipe",
        cwd: process.cwd(),
        env: process.env,
      });

      const timeoutId = setTimeout(() => proc.kill(), timeout);

      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);

      clearTimeout(timeoutId);
      const exitCode = await proc.exited;

      let output = stdout;
      if (stderr) {
        output += (output ? "\n" : "") + stderr;
      }

      if (output.length > MAX_OUTPUT) {
        output =
          output.slice(0, MAX_OUTPUT) +
          `\n... (truncated, ${output.length - MAX_OUTPUT} bytes omitted)`;
      }

      if (exitCode !== 0) {
        return {
          content: `Exit code: ${exitCode}\n${output}`,
          is_error: true,
        };
      }

      return { content: output || "(no output)" };
    } catch (error) {
      return {
        content: `Command failed: ${error instanceof Error ? error.message : String(error)}`,
        is_error: true,
      };
    }
  },
};
