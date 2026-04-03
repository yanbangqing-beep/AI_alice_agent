import pc from "picocolors";
import type { AgentEvent } from "../core/types.js";

export interface RendererOptions {
  debug: boolean;
}

const DEFAULT_RENDERER_OPTIONS: RendererOptions = {
  debug: true,
};

// Debug label formatting
const LABEL = {
  system: pc.bold(pc.magenta("[SYSTEM]")),
  req: pc.bold(pc.blue("[REQ]")),
  stream: pc.bold(pc.cyan("[STREAM]")),
  res: pc.bold(pc.green("[RES]")),
  tool: pc.bold(pc.yellow("[TOOL]")),
  think: pc.yellow("💭"),
} as const;

/**
 * CLI renderer that handles streaming output with ANSI formatting.
 */
export class Renderer {
  private options: RendererOptions;
  private inThinking = false;
  private inToolUse = false;
  private streamEventCounts = new Map<string, number>();

  constructor(options: Partial<RendererOptions> = {}) {
    this.options = { ...DEFAULT_RENDERER_OPTIONS, ...options };
  }

  /**
   * Handle agent events and render to terminal.
   */
  handleEvent(event: AgentEvent): void {
    const data = event.data as Record<string, unknown> | undefined;

    switch (event.type) {
      // ─── Debug: System Prompt ────────────────────────────
      case "system_prompt":
        if (this.options.debug) {
          const prompt = data?.prompt as string || "";
          this.debugBlock(LABEL.system, prompt);
        }
        break;

      // ─── Debug: Request ──────────────────────────────────
      case "request":
        if (this.options.debug) {
          const model = data?.model as string;
          const msgCount = data?.messageCount as number;
          const tools = data?.tools as string[];
          const lastMsg = data?.lastMessage as { role: string; preview: string } | null;

          this.debugLine(LABEL.req, `model=${pc.bold(model)}  messages=${msgCount}  tools=[${tools.join(", ")}]`);
          if (lastMsg) {
            this.debugLine(LABEL.req, `last_message: ${pc.dim(`role=${lastMsg.role}`)} ${pc.dim(lastMsg.preview.slice(0, 120))}`);
          }
          // Reset stream event counts for this turn
          this.streamEventCounts.clear();
        }
        break;

      // ─── Debug: Raw SSE Events ───────────────────────────
      case "stream_event":
        if (this.options.debug) {
          const sseType = data?.sseType as string;
          const count = (this.streamEventCounts.get(sseType) || 0) + 1;
          this.streamEventCounts.set(sseType, count);

          // Only log non-text/thinking events (those are too frequent)
          // Log first occurrence + summary of text/thinking at content_block_stop
          if (sseType !== "text" && sseType !== "thinking" && sseType !== "tool_input_delta") {
            const extra: string[] = [];
            if (data?.hasToolUse) extra.push("tool_use");
            this.debugLine(
              LABEL.stream,
              `${pc.cyan(sseType)}${extra.length ? pc.dim(` [${extra.join(", ")}]`) : ""}`,
            );

            // Print accumulated text/thinking counts on block stop
            if (sseType === "content_block_stop") {
              const textCount = this.streamEventCounts.get("text") || 0;
              const thinkCount = this.streamEventCounts.get("thinking") || 0;
              const inputCount = this.streamEventCounts.get("tool_input_delta") || 0;
              const parts: string[] = [];
              if (textCount > 0) parts.push(`text×${textCount}`);
              if (thinkCount > 0) parts.push(`thinking×${thinkCount}`);
              if (inputCount > 0) parts.push(`tool_input×${inputCount}`);
              if (parts.length > 0) {
                this.debugLine(LABEL.stream, pc.dim(`  accumulated: ${parts.join(", ")}`));
              }
              // Reset counts after block stop
              this.streamEventCounts.delete("text");
              this.streamEventCounts.delete("thinking");
              this.streamEventCounts.delete("tool_input_delta");
            }
          }
        }
        break;

      // ─── Debug: Response Metadata ────────────────────────
      case "response":
        if (this.options.debug) {
          const model = data?.model as string;
          const stopReason = data?.stopReason as string;
          const usage = data?.usage as { input_tokens: number; output_tokens: number };
          const blocks = data?.contentBlocks as Array<{ type: string; name?: string; length?: number }>;

          this.debugLine(
            LABEL.res,
            `model=${pc.bold(model)}  stop=${pc.bold(stopReason)}  tokens=${pc.cyan(`${usage.input_tokens}↓ ${usage.output_tokens}↑`)}`,
          );
          const blockSummary = blocks.map((b) => {
            if (b.type === "text") return `text(${b.length} chars)`;
            if (b.type === "tool_use") return `tool_use(${b.name})`;
            if (b.type === "thinking") return `thinking(${b.length} chars)`;
            return b.type;
          }).join(", ");
          this.debugLine(LABEL.res, `blocks: [${blockSummary}]`);
        }
        break;

      // ─── Turn Start ──────────────────────────────────────
      case "turn_start":
        if (this.options.debug) {
          const turn = data?.turn as number;
          process.stdout.write(
            pc.dim(`\n${"─".repeat(60)}\n`) +
            pc.bold(pc.blue(`  Turn ${turn}\n`)) +
            pc.dim(`${"─".repeat(60)}\n`),
          );
        }
        break;

      // ─── Text Output ─────────────────────────────────────
      case "text_delta":
        if (this.inThinking) {
          this.endThinking();
        }
        if (this.inToolUse) {
          this.inToolUse = false;
        }
        process.stdout.write(data?.text as string || "");
        break;

      // ─── Thinking ────────────────────────────────────────
      case "thinking_delta":
        if (!this.inThinking) {
          this.startThinking();
        }
        process.stdout.write(pc.dim(pc.yellow(data?.thinking as string || "")));
        break;

      // ─── Tool Use ────────────────────────────────────────
      case "tool_use":
        if (this.inThinking) {
          this.endThinking();
        }
        this.inToolUse = true;
        const toolName = data?.name as string;
        const toolInput = data?.input as Record<string, unknown>;

        if (this.options.debug) {
          this.debugLine(LABEL.tool, `${pc.bold(pc.yellow(toolName))} ← input:`);
          // Pretty print full input
          const inputStr = JSON.stringify(toolInput, null, 2);
          for (const line of inputStr.split("\n")) {
            this.debugLine(LABEL.tool, pc.dim(`  ${line}`));
          }
        } else {
          process.stdout.write(
            "\n" +
            pc.cyan(`  ▶ ${toolName}`) +
            pc.dim(`(${this.formatToolInput(toolInput)})`) +
            "\n",
          );
        }
        break;

      // ─── Tool Result ─────────────────────────────────────
      case "tool_result":
        const content = data?.content as string || "";
        const isError = data?.is_error as boolean;
        const resultToolName = data?.name as string;

        if (this.options.debug) {
          const label = isError
            ? pc.red(`${resultToolName} → ERROR`)
            : pc.green(`${resultToolName} → OK`);
          this.debugLine(LABEL.tool, label + pc.dim(` (${content.length} chars)`));
          // Show full result content
          const lines = content.split("\n");
          const maxLines = 30;
          const shown = lines.slice(0, maxLines);
          for (const line of shown) {
            this.debugLine(LABEL.tool, pc.dim(`  ${line}`));
          }
          if (lines.length > maxLines) {
            this.debugLine(LABEL.tool, pc.dim(`  ... (${lines.length - maxLines} more lines)`));
          }
        } else {
          if (isError) {
            const preview = content.length > 300
              ? content.slice(0, 300) + pc.dim("...")
              : content;
            process.stdout.write(pc.red(`  ✗ ${resultToolName}: ${preview}`) + "\n");
          } else {
            process.stdout.write(pc.green(`  ✓ ${resultToolName}`) + "\n");
          }
        }
        break;

      // ─── Turn End ────────────────────────────────────────
      case "turn_end":
        process.stdout.write("\n");
        if (this.options.debug) {
          this.debugLine(
            pc.dim("[END]"),
            pc.dim(`turn=${data?.turn} stop_reason=${data?.stop_reason}`),
          );
        }
        break;

      // ─── Compression ─────────────────────────────────────
      case "compression":
        process.stdout.write(
          pc.yellow(`  ⚡ Compressing context (${data?.strategy})`) + "\n",
        );
        break;

      // ─── Error ───────────────────────────────────────────
      case "error":
        process.stdout.write(pc.red(`  ⚠ ${data?.message}`) + "\n");
        break;
    }
  }

  private startThinking(): void {
    this.inThinking = true;
    process.stdout.write(`\n${LABEL.think} ${pc.dim("thinking...")}\n`);
  }

  private endThinking(): void {
    this.inThinking = false;
    process.stdout.write(`\n${LABEL.think} ${pc.dim("/thinking")}\n\n`);
  }

  private formatToolInput(input: Record<string, unknown>): string {
    const entries = Object.entries(input);
    if (entries.length === 0) return "";
    if (entries.length === 1) {
      const [, val] = entries[0]!;
      const str = typeof val === "string" ? val : JSON.stringify(val);
      return str.length > 80 ? str.slice(0, 80) + "..." : str;
    }
    return entries
      .map(([k, v]) => {
        const str = typeof v === "string" ? v : JSON.stringify(v);
        return `${k}=${str.length > 40 ? str.slice(0, 40) + "..." : str}`;
      })
      .join(", ");
  }

  /** Print a debug line with label and pipe separator */
  private debugLine(label: string, text: string): void {
    process.stdout.write(`${label} ${pc.dim("│")} ${text}\n`);
  }

  /** Print a debug block (multiline content with box) */
  private debugBlock(label: string, content: string): void {
    const lines = content.split("\n");
    const maxLines = 20;
    this.debugLine(label, pc.dim(`(${lines.length} lines)`));
    const shown = lines.slice(0, maxLines);
    for (const line of shown) {
      this.debugLine(label, pc.dim(`  ${line}`));
    }
    if (lines.length > maxLines) {
      this.debugLine(label, pc.dim(`  ... (${lines.length - maxLines} more lines)`));
    }
  }

  /**
   * Print a welcome banner.
   */
  static printBanner(): void {
    console.log(
      pc.bold(pc.cyan("\n  Alice")) +
        pc.dim(" v0.1.0") +
        pc.dim(" — Universal AI Agent\n"),
    );
  }

  /**
   * Print token usage stats.
   */
  static printUsage(input: number, output: number): void {
    console.log(
      pc.dim(`  tokens: ${input.toLocaleString()} in / ${output.toLocaleString()} out`),
    );
  }
}
