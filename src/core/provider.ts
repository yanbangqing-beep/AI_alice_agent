import Anthropic from "@anthropic-ai/sdk";
import type {
  ContentBlock,
  Message,
  ModelId,
  Provider,
  ProviderConfig,
  ProviderResponse,
  ProviderStreamEvent,
  ToolDefinition,
} from "./types.js";
import { ProviderError } from "./errors.js";

// ─── Convert internal messages to Anthropic format ───────────────

function toAnthropicMessages(messages: Message[]): Anthropic.MessageParam[] {
  return messages.map((msg) => {
    if (typeof msg.content === "string") {
      return { role: msg.role, content: msg.content };
    }

    const blocks: Anthropic.ContentBlockParam[] = [];
    for (const block of msg.content) {
      switch (block.type) {
        case "text":
          blocks.push({ type: "text", text: block.text });
          break;
        case "tool_use":
          blocks.push({
            type: "tool_use",
            id: block.id,
            name: block.name,
            input: block.input,
          });
          break;
        case "tool_result":
          blocks.push({
            type: "tool_result",
            tool_use_id: block.tool_use_id,
            content: block.content,
            is_error: block.is_error,
          });
          break;
        // thinking blocks are not sent back to the API
      }
    }
    return { role: msg.role, content: blocks };
  });
}

function toAnthropicTools(tools: ToolDefinition[]): Anthropic.Tool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema as Anthropic.Tool["input_schema"],
  }));
}

// ─── Parse Anthropic response to internal format ─────────────────

function parseResponseContent(
  content: Anthropic.ContentBlock[],
): ContentBlock[] {
  return content.map((block) => {
    switch (block.type) {
      case "text":
        return { type: "text" as const, text: block.text };
      case "tool_use":
        return {
          type: "tool_use" as const,
          id: block.id,
          name: block.name,
          input: block.input as Record<string, unknown>,
        };
      case "thinking":
        return {
          type: "thinking" as const,
          thinking: block.thinking || "",
        };
      default:
        return { type: "text" as const, text: JSON.stringify(block) };
    }
  });
}

// ─── Anthropic Provider ──────────────────────────────────────────

export class AnthropicProvider implements Provider {
  readonly name = "anthropic";
  private client: Anthropic;
  private config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
    this.client = new Anthropic({
      apiKey: config.apiKey || process.env.ANTHROPIC_API_KEY,
      baseURL: config.baseUrl,
    });
  }

  async chat(
    messages: Message[],
    tools?: ToolDefinition[],
    systemPrompt?: string,
  ): Promise<ProviderResponse> {
    try {
      const params = this.buildParams(messages, tools, systemPrompt);
      const response = await this.client.messages.create({
        ...params,
        stream: false,
      });

      return {
        content: parseResponseContent(
          response.content as Anthropic.ContentBlock[],
        ),
        model: response.model,
        usage: {
          input_tokens: response.usage.input_tokens,
          output_tokens: response.usage.output_tokens,
        },
        stop_reason: response.stop_reason as ProviderResponse["stop_reason"],
      };
    } catch (error) {
      throw this.wrapError(error);
    }
  }

  async *stream(
    messages: Message[],
    tools?: ToolDefinition[],
    systemPrompt?: string,
  ): AsyncIterable<ProviderStreamEvent> {
    try {
      const params = this.buildParams(messages, tools, systemPrompt);
      const stream = this.client.messages.stream(params);

      for await (const event of stream) {
        switch (event.type) {
          case "content_block_start": {
            const block = event.content_block;
            if (block.type === "tool_use") {
              yield {
                type: "tool_use_start",
                toolUse: { id: block.id, name: block.name },
              };
            }
            break;
          }
          case "content_block_delta": {
            const delta = event.delta;
            if (delta.type === "text_delta") {
              yield { type: "text", text: delta.text };
            } else if (delta.type === "thinking_delta") {
              yield {
                type: "thinking",
                text: (delta as unknown as { thinking: string }).thinking,
              };
            } else if (delta.type === "input_json_delta") {
              yield {
                type: "tool_input_delta",
                text: (delta as unknown as { partial_json: string })
                  .partial_json,
              };
            }
            break;
          }
          case "content_block_stop":
            yield { type: "content_block_stop" };
            break;
          case "message_stop":
            yield { type: "message_stop" };
            break;
        }
      }

      // Collect the final message for the caller
      const finalMessage = await stream.finalMessage();
      (this as any)._lastResponse = {
        content: parseResponseContent(
          finalMessage.content as Anthropic.ContentBlock[],
        ),
        model: finalMessage.model,
        usage: {
          input_tokens: finalMessage.usage.input_tokens,
          output_tokens: finalMessage.usage.output_tokens,
        },
        stop_reason:
          finalMessage.stop_reason as ProviderResponse["stop_reason"],
      };
    } catch (error) {
      yield { type: "error", error: this.wrapError(error) };
    }
  }

  getLastResponse(): ProviderResponse | undefined {
    return (this as any)._lastResponse;
  }

  private buildParams(
    messages: Message[],
    tools?: ToolDefinition[],
    systemPrompt?: string,
  ): Anthropic.MessageCreateParams {
    const params: Anthropic.MessageCreateParams = {
      model: this.config.defaultModel,
      max_tokens: this.config.maxTokens || 8192,
      messages: toAnthropicMessages(messages),
    };

    if (systemPrompt) {
      params.system = systemPrompt;
    }

    if (tools && tools.length > 0) {
      params.tools = toAnthropicTools(tools);
    }

    if (this.config.thinking?.enabled) {
      (params as any).thinking = {
        type: "enabled",
        budget_tokens: this.config.thinking.budgetTokens || 4096,
      };
    }

    return params;
  }

  setModel(model: ModelId): void {
    this.config = { ...this.config, defaultModel: model };
  }

  private wrapError(error: unknown): ProviderError {
    if (error instanceof Anthropic.APIError) {
      return new ProviderError(
        error.message,
        error.status,
        this.config.defaultModel,
      );
    }
    if (error instanceof Error) {
      return new ProviderError(error.message);
    }
    return new ProviderError(String(error));
  }
}
