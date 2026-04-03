import type { Message, ContentBlock, Provider } from "../core/types.js";
import { ContextOverflowError } from "../core/errors.js";

export type CompressionStrategy = "micro-compact" | "llm-summary" | "truncate";

export interface CompressionOptions {
  strategy: CompressionStrategy;
  threshold: number; // estimated token count to trigger
  provider?: Provider; // needed for llm-summary
  preserveRecent: number; // number of recent message pairs to preserve
}

const DEFAULT_OPTIONS: CompressionOptions = {
  strategy: "micro-compact",
  threshold: 80000,
  preserveRecent: 4,
};

/**
 * Rough token estimation: ~4 chars per token for English, ~2 for CJK.
 */
export function estimateTokens(messages: Message[]): number {
  let chars = 0;
  for (const msg of messages) {
    if (typeof msg.content === "string") {
      chars += msg.content.length;
    } else {
      for (const block of msg.content) {
        if (block.type === "text") chars += block.text.length;
        else if (block.type === "thinking") chars += block.thinking.length;
        else if (block.type === "tool_result") chars += block.content.length;
        else if (block.type === "tool_use")
          chars += JSON.stringify(block.input).length;
      }
    }
  }
  // Rough average: 3.5 chars/token
  return Math.ceil(chars / 3.5);
}

/**
 * Check if compression is needed.
 */
export function needsCompression(
  messages: Message[],
  options: Partial<CompressionOptions> = {},
): boolean {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  return estimateTokens(messages) > opts.threshold;
}

/**
 * Compress messages using the configured strategy.
 * Falls back to truncation if LLM summary fails.
 */
export async function compressMessages(
  messages: Message[],
  options: Partial<CompressionOptions> = {},
): Promise<Message[]> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  if (!needsCompression(messages, opts)) {
    return messages;
  }

  // Preserve system-critical first message and recent messages
  const preserveCount = opts.preserveRecent * 2; // pairs → individual messages
  const head = messages.slice(0, 1); // first message always preserved
  const tail = messages.slice(-preserveCount);
  const middle = messages.slice(1, -preserveCount || undefined);

  if (middle.length === 0) {
    return messages; // Nothing to compress
  }

  try {
    switch (opts.strategy) {
      case "micro-compact":
        return [...head, microCompact(middle), ...tail];
      case "llm-summary":
        if (opts.provider) {
          return [...head, await llmSummary(middle, opts.provider), ...tail];
        }
        // Fall through to truncate if no provider
        return [...head, microCompact(middle), ...tail];
      case "truncate":
        return [...head, truncateMiddle(middle), ...tail];
      default:
        return [...head, truncateMiddle(middle), ...tail];
    }
  } catch {
    // Compression itself failed → fallback to truncation
    return [...head, truncateMiddle(middle), ...tail];
  }
}

/**
 * Micro-compact: Strip thinking blocks, truncate long tool results,
 * collapse consecutive text into summaries.
 */
function microCompact(messages: Message[]): Message {
  const lines: string[] = ["[Compressed conversation history]"];

  for (const msg of messages) {
    if (typeof msg.content === "string") {
      const truncated =
        msg.content.length > 200
          ? msg.content.slice(0, 200) + "..."
          : msg.content;
      lines.push(`${msg.role}: ${truncated}`);
      continue;
    }

    for (const block of msg.content) {
      switch (block.type) {
        case "text":
          if (block.text.length > 200) {
            lines.push(`${msg.role}: ${block.text.slice(0, 200)}...`);
          } else {
            lines.push(`${msg.role}: ${block.text}`);
          }
          break;
        case "tool_use":
          lines.push(`[tool_use: ${block.name}(${JSON.stringify(block.input).slice(0, 100)})]`);
          break;
        case "tool_result":
          const preview = block.content.slice(0, 150);
          lines.push(
            `[tool_result${block.is_error ? " ERROR" : ""}: ${preview}${block.content.length > 150 ? "..." : ""}]`,
          );
          break;
        // Skip thinking blocks entirely
      }
    }
  }

  return {
    role: "user",
    content: lines.join("\n"),
  };
}

/**
 * LLM-powered summary: Ask the provider to summarize the conversation.
 */
async function llmSummary(
  messages: Message[],
  provider: Provider,
): Promise<Message> {
  const compacted = microCompact(messages);
  const summaryContent =
    typeof compacted.content === "string"
      ? compacted.content
      : (compacted.content as ContentBlock[])
          .filter((b): b is { type: "text"; text: string } => b.type === "text")
          .map((b) => b.text)
          .join("\n");

  try {
    const response = await provider.chat(
      [
        {
          role: "user",
          content: `Summarize this conversation history concisely, preserving key decisions, file paths, and tool results. Be brief but complete:\n\n${summaryContent}`,
        },
      ],
      undefined,
      "You are a conversation summarizer. Output a concise summary preserving critical context.",
    );

    const summaryText = response.content
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    return {
      role: "user",
      content: `[Conversation summary]\n${summaryText}`,
    };
  } catch {
    // LLM summary failed → fallback to micro-compact
    return compacted;
  }
}

/**
 * Truncation: Simply keep first and last N messages, drop middle.
 */
function truncateMiddle(messages: Message[]): Message {
  const kept = Math.min(4, messages.length);
  const head = messages.slice(0, kept);
  const dropped = messages.length - kept;

  const summary = microCompact(head);
  if (typeof summary.content === "string") {
    summary.content += `\n[... ${dropped} messages truncated ...]`;
  }
  return summary;
}
