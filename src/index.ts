// Public API exports for library usage

export { Agent } from "./core/agent.js";
export { AnthropicProvider } from "./core/provider.js";
export { ToolRegistry } from "./tools/registry.js";
export { getBuiltinTools } from "./tools/builtin/index.js";
export { loadConfig } from "./config/loader.js";
export { loadSkills, matchSkills, formatSkillsAsContext } from "./skills/loader.js";
export {
  compressMessages,
  needsCompression,
  estimateTokens,
} from "./context/compression.js";
export {
  AliceError,
  ProviderError,
  ToolError,
  SafetyError,
  ContextOverflowError,
  withRetry,
  ModelDegrader,
} from "./core/errors.js";

// Re-export types
export type {
  Message,
  ContentBlock,
  TextBlock,
  ThinkingBlock,
  ToolUseBlock,
  ToolResultBlock,
  Tool,
  ToolDefinition,
  ToolExecutionResult,
  Provider,
  ProviderConfig,
  ProviderResponse,
  ProviderStreamEvent,
  AliceConfig,
  AgentSession,
  AgentEvent,
  AgentEventHandler,
} from "./core/types.js";
