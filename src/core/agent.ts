import type {
  AgentEvent,
  AgentEventHandler,
  AgentSession,
  AliceConfig,
  ContentBlock,
  Message,
  Provider,
  ProviderResponse,
  ToolResultBlock,
  ToolUseBlock,
} from "./types.js";
import { ModelDegrader, withRetry } from "./errors.js";
import { ToolRegistry } from "../tools/registry.js";
import { compressMessages, needsCompression } from "../context/compression.js";
import { loadSkills, matchSkills, formatSkillsAsContext } from "../skills/loader.js";
import type { AnthropicProvider } from "./provider.js";

const SYSTEM_PROMPT = `You are Alice, a helpful AI assistant. You have access to tools to help you accomplish tasks.

When using tools:
- Use the bash tool for running commands
- Use the read tool to read files before editing
- Use the write tool to create new files
- Use the edit tool for precise edits to existing files
- Always check file contents before making edits

Be concise and direct. Focus on completing the task efficiently.`;

export class Agent {
  private session: AgentSession;
  private eventHandlers: AgentEventHandler[] = [];
  private abortController: AbortController | null = null;

  constructor(
    private provider: Provider,
    private tools: ToolRegistry,
    private config: AliceConfig,
  ) {
    this.session = {
      id: crypto.randomUUID(),
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      model: config.models.primary,
      totalTokens: { input: 0, output: 0 },
    };
  }

  on(handler: AgentEventHandler): void {
    this.eventHandlers.push(handler);
  }

  private emit(event: AgentEvent): void {
    for (const handler of this.eventHandlers) {
      handler(event);
    }
  }

  abort(): void {
    this.abortController?.abort();
  }

  getSession(): AgentSession {
    return this.session;
  }

  /**
   * Run a single user turn through the Agent Loop.
   * This is the core LLM ↔ Tool loop.
   */
  async run(userMessage: string): Promise<void> {
    this.abortController = new AbortController();

    // Add user message
    this.session.messages.push({ role: "user", content: userMessage });

    // Load and inject matching skills
    const skills = loadSkills(this.config.skillsDir);
    const matched = matchSkills(skills, userMessage);
    const skillContext = formatSkillsAsContext(matched);

    const systemPrompt = SYSTEM_PROMPT + skillContext;
    const degrader = new ModelDegrader([
      this.config.models.primary,
      ...this.config.models.fallback,
    ]);

    let turns = 0;

    while (turns < this.config.maxTurns) {
      if (this.abortController.signal.aborted) break;

      turns++;
      this.emit({ type: "turn_start", data: { turn: turns } });

      // Check for context compression
      if (needsCompression(this.session.messages, this.config.compression)) {
        this.emit({ type: "compression", data: { strategy: this.config.compression.strategy } });
        this.session.messages = await compressMessages(
          this.session.messages,
          {
            ...this.config.compression,
            provider: this.provider,
          },
        );
      }

      // Call LLM with retry + model degradation
      let response: ProviderResponse;
      try {
        response = await withRetry(
          async () => {
            // Update provider model to current degrader model
            if ("setModel" in this.provider) {
              (this.provider as AnthropicProvider).setModel(degrader.current);
            }

            return this.provider.chat(
              this.session.messages,
              this.tools.getDefinitions(),
              systemPrompt,
            );
          },
          {
            maxRetries: this.config.maxRetries,
            onRetry: (attempt, error, delay) => {
              // Try model degradation on repeated failures
              if (attempt >= 2) {
                const nextModel = degrader.degrade();
                if (nextModel) {
                  this.emit({
                    type: "error",
                    data: { message: `Degrading to model: ${nextModel}`, attempt },
                  });
                }
              }
              this.emit({
                type: "error",
                data: { message: `Retry ${attempt}: ${error.message}`, delay },
              });
            },
          },
        );
      } catch (error) {
        this.emit({
          type: "error",
          data: { message: `LLM call failed: ${error instanceof Error ? error.message : String(error)}` },
        });
        break;
      }

      // Track token usage
      this.session.totalTokens.input += response.usage.input_tokens;
      this.session.totalTokens.output += response.usage.output_tokens;

      // Emit text and thinking events
      for (const block of response.content) {
        if (block.type === "text") {
          this.emit({ type: "text_delta", data: { text: block.text } });
        } else if (block.type === "thinking") {
          this.emit({ type: "thinking_delta", data: { thinking: block.thinking } });
        }
      }

      // Add assistant response to history
      this.session.messages.push({
        role: "assistant",
        content: response.content,
      });

      // Check if we need to execute tools
      const toolUses = response.content.filter(
        (b): b is ToolUseBlock => b.type === "tool_use",
      );

      if (toolUses.length === 0) {
        // No tool calls — turn is done
        this.emit({ type: "turn_end", data: { turn: turns, stop_reason: response.stop_reason } });
        break;
      }

      // Execute tools
      const toolResults: ToolResultBlock[] = [];
      for (const toolUse of toolUses) {
        if (this.abortController.signal.aborted) break;

        this.emit({
          type: "tool_use",
          data: { name: toolUse.name, input: toolUse.input },
        });

        const result = await this.tools.execute(toolUse.name, toolUse.input);

        this.emit({
          type: "tool_result",
          data: { name: toolUse.name, ...result },
        });

        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: result.content,
          is_error: result.is_error,
        });
      }

      // Add tool results to history
      this.session.messages.push({
        role: "user",
        content: toolResults,
      });

      this.emit({ type: "turn_end", data: { turn: turns, stop_reason: "tool_use" } });
      // Continue the loop — LLM will see tool results
    }

    // Safety valve
    if (turns >= this.config.maxTurns) {
      this.emit({
        type: "error",
        data: { message: `Safety valve: reached max turns (${this.config.maxTurns})` },
      });
    }

    this.session.updatedAt = new Date().toISOString();
    degrader.reset();
  }

  /**
   * Run with streaming output.
   */
  async runStreaming(userMessage: string): Promise<void> {
    this.abortController = new AbortController();

    this.session.messages.push({ role: "user", content: userMessage });

    const skills = loadSkills(this.config.skillsDir);
    const matched = matchSkills(skills, userMessage);
    const skillContext = formatSkillsAsContext(matched);
    const systemPrompt = SYSTEM_PROMPT + skillContext;

    const degrader = new ModelDegrader([
      this.config.models.primary,
      ...this.config.models.fallback,
    ]);

    // Emit system prompt (once per run)
    this.emit({
      type: "system_prompt",
      data: { prompt: systemPrompt },
    });

    let turns = 0;

    while (turns < this.config.maxTurns) {
      if (this.abortController.signal.aborted) break;

      turns++;
      this.emit({ type: "turn_start", data: { turn: turns } });

      // Compress if needed
      if (needsCompression(this.session.messages, this.config.compression)) {
        this.emit({ type: "compression", data: { strategy: this.config.compression.strategy } });
        this.session.messages = await compressMessages(
          this.session.messages,
          { ...this.config.compression, provider: this.provider },
        );
      }

      // Stream from provider
      if ("setModel" in this.provider) {
        (this.provider as AnthropicProvider).setModel(degrader.current);
      }

      const toolDefs = this.tools.getDefinitions();

      // Emit request debug info
      const lastMsg = this.session.messages[this.session.messages.length - 1];
      this.emit({
        type: "request",
        data: {
          model: degrader.current,
          messageCount: this.session.messages.length,
          tools: toolDefs.map((t) => t.name),
          lastMessage: lastMsg
            ? {
                role: lastMsg.role,
                preview:
                  typeof lastMsg.content === "string"
                    ? lastMsg.content.slice(0, 200)
                    : lastMsg.content.map((b) => b.type).join(", "),
              }
            : null,
        },
      });

      let currentToolUse: { id: string; name: string; inputJson: string } | null = null;
      const contentBlocks: ContentBlock[] = [];

      try {
        for await (const event of this.provider.stream(
          this.session.messages,
          toolDefs,
          systemPrompt,
        )) {
          if (this.abortController.signal.aborted) break;

          // Emit raw SSE event for debug
          this.emit({
            type: "stream_event",
            data: { sseType: event.type, hasText: !!event.text, hasToolUse: !!event.toolUse },
          });

          switch (event.type) {
            case "text":
              this.emit({ type: "text_delta", data: { text: event.text } });
              break;
            case "thinking":
              this.emit({ type: "thinking_delta", data: { thinking: event.text } });
              break;
            case "tool_use_start":
              currentToolUse = {
                id: event.toolUse!.id,
                name: event.toolUse!.name,
                inputJson: "",
              };
              break;
            case "tool_input_delta":
              if (currentToolUse) {
                currentToolUse.inputJson += event.text || "";
              }
              break;
            case "content_block_stop":
              if (currentToolUse) {
                let input: Record<string, unknown> = {};
                try {
                  input = JSON.parse(currentToolUse.inputJson || "{}");
                } catch {}
                contentBlocks.push({
                  type: "tool_use",
                  id: currentToolUse.id,
                  name: currentToolUse.name,
                  input,
                });
                currentToolUse = null;
              }
              break;
            case "error":
              this.emit({ type: "error", data: { message: event.error?.message } });
              break;
          }
        }
      } catch (error) {
        this.emit({
          type: "error",
          data: { message: `Stream failed: ${error instanceof Error ? error.message : String(error)}` },
        });
        break;
      }

      // Get the full response from provider
      const lastResponse = (this.provider as AnthropicProvider).getLastResponse?.();
      if (lastResponse) {
        this.session.totalTokens.input += lastResponse.usage.input_tokens;
        this.session.totalTokens.output += lastResponse.usage.output_tokens;

        // Emit response debug info
        this.emit({
          type: "response",
          data: {
            model: lastResponse.model,
            stopReason: lastResponse.stop_reason,
            usage: lastResponse.usage,
            contentBlocks: lastResponse.content.map((b) => ({
              type: b.type,
              ...(b.type === "text" ? { length: b.text.length } : {}),
              ...(b.type === "tool_use" ? { name: (b as ToolUseBlock).name } : {}),
              ...(b.type === "thinking" ? { length: (b as any).thinking.length } : {}),
            })),
          },
        });

        this.session.messages.push({
          role: "assistant",
          content: lastResponse.content,
        });

        // Check for tool calls
        const toolUses = lastResponse.content.filter(
          (b): b is ToolUseBlock => b.type === "tool_use",
        );

        if (toolUses.length === 0) {
          this.emit({ type: "turn_end", data: { turn: turns, stop_reason: lastResponse.stop_reason } });
          break;
        }

        // Execute tools
        const toolResults: ToolResultBlock[] = [];
        for (const toolUse of toolUses) {
          if (this.abortController.signal.aborted) break;

          this.emit({ type: "tool_use", data: { name: toolUse.name, input: toolUse.input } });

          const result = await this.tools.execute(toolUse.name, toolUse.input);
          this.emit({ type: "tool_result", data: { name: toolUse.name, ...result } });

          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: result.content,
            is_error: result.is_error,
          });
        }

        this.session.messages.push({ role: "user", content: toolResults });
        this.emit({ type: "turn_end", data: { turn: turns, stop_reason: "tool_use" } });
      } else {
        // Fallback: no final response available (shouldn't happen normally)
        break;
      }
    }

    if (turns >= this.config.maxTurns) {
      this.emit({
        type: "error",
        data: { message: `Safety valve: reached max turns (${this.config.maxTurns})` },
      });
    }

    this.session.updatedAt = new Date().toISOString();
    degrader.reset();
  }

  /**
   * Save session to file system.
   */
  async saveSession(): Promise<string> {
    const dir = this.config.configDir;
    const sessionsDir = `${dir}/sessions`;
    const { mkdirSync } = require("fs");
    mkdirSync(sessionsDir, { recursive: true });

    const filePath = `${sessionsDir}/${this.session.id}.json`;
    await Bun.write(filePath, JSON.stringify(this.session, null, 2));
    return filePath;
  }

  /**
   * Load session from file system.
   */
  static async loadSession(
    filePath: string,
    provider: Provider,
    tools: ToolRegistry,
    config: AliceConfig,
  ): Promise<Agent> {
    const content = await Bun.file(filePath).text();
    const session = JSON.parse(content) as AgentSession;

    const agent = new Agent(provider, tools, config);
    agent.session = session;
    return agent;
  }
}
