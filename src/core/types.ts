// ─── Message Types ───────────────────────────────────────────────

export type Role = "user" | "assistant";

export interface TextBlock {
  type: "text";
  text: string;
}

export interface ThinkingBlock {
  type: "thinking";
  thinking: string;
}

export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export type ContentBlock = TextBlock | ThinkingBlock | ToolUseBlock | ToolResultBlock;

export interface Message {
  role: Role;
  content: string | ContentBlock[];
}

// ─── Tool Types ──────────────────────────────────────────────────

export interface ToolParameter {
  type: string;
  description: string;
  enum?: string[];
  default?: unknown;
  items?: ToolParameter;
  properties?: Record<string, ToolParameter>;
  required?: string[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, ToolParameter>;
    required?: string[];
  };
}

export interface ToolExecutionResult {
  content: string;
  is_error?: boolean;
}

export interface Tool {
  definition: ToolDefinition;
  execute(input: Record<string, unknown>): Promise<ToolExecutionResult>;
}

// ─── Provider Types ──────────────────────────────────────────────

export type ModelId = string;

export interface ProviderStreamEvent {
  type: "text" | "thinking" | "tool_use_start" | "tool_input_delta" | "content_block_stop" | "message_stop" | "error";
  text?: string;
  toolUse?: { id: string; name: string };
  error?: Error;
}

export interface ProviderResponse {
  content: ContentBlock[];
  model: ModelId;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
  stop_reason: "end_turn" | "tool_use" | "max_tokens" | "stop_sequence";
}

export interface ProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  defaultModel: ModelId;
  maxTokens?: number;
  thinking?: {
    enabled: boolean;
    budgetTokens?: number;
  };
}

export interface Provider {
  readonly name: string;
  chat(
    messages: Message[],
    tools?: ToolDefinition[],
    systemPrompt?: string,
  ): Promise<ProviderResponse>;
  stream(
    messages: Message[],
    tools?: ToolDefinition[],
    systemPrompt?: string,
  ): AsyncIterable<ProviderStreamEvent>;
}

// ─── Config Types ────────────────────────────────────────────────

export interface AliceConfig {
  provider: ProviderConfig;
  models: {
    primary: ModelId;
    fallback: ModelId[];
  };
  maxTurns: number;
  maxRetries: number;
  compression: {
    enabled: boolean;
    threshold: number; // token count to trigger compression
    strategy: "micro-compact" | "llm-summary" | "truncate";
  };
  safety: {
    dangerousCommandBlacklist: string[];
    pathRestrictions: string[];
    requireConfirmation: boolean;
  };
  debug: boolean;
  skillsDir: string[];
  configDir: string;
}

// ─── Agent Types ─────────────────────────────────────────────────

export interface AgentSession {
  id: string;
  messages: Message[];
  createdAt: string;
  updatedAt: string;
  model: ModelId;
  totalTokens: { input: number; output: number };
}

export type AgentEventType =
  | "turn_start"
  | "text_delta"
  | "thinking_delta"
  | "tool_use"
  | "tool_result"
  | "turn_end"
  | "error"
  | "compression"
  | "system_prompt"
  | "request"
  | "stream_event"
  | "response";

export interface AgentEvent {
  type: AgentEventType;
  data?: unknown;
}

export type AgentEventHandler = (event: AgentEvent) => void;
