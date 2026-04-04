// Public API exports for library usage

export { Agent } from "./core/agent.js";
export { AnthropicProvider } from "./core/provider.js";
export { ToolRegistry } from "./tools/registry.js";
export { getBuiltinTools } from "./tools/builtin/index.js";
export { loadConfig } from "./config/loader.js";
export { loadDotEnv } from "./config/env.js";
export { loadSkills, matchSkills, formatSkillsAsContext } from "./skills/loader.js";
export {
  ContextAssembly,
  createContextAssembly,
  buildQuickContext,
  MemoryManager,
} from "./context/assembly/index.js";
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
export { loadDataset, selectCases, resolveDatasetPath, getDefaultDatasetDir } from "./evals/dataset.js";
export { runEvalCase, runDataset, runDatasetFromCli } from "./evals/runner.js";
export { formatReport } from "./evals/report.js";

// Transport layer
export { CliTransport } from "./transport/cli.js";
export { HttpTransport } from "./transport/http.js";
export { WsTransport } from "./transport/ws.js";

// Server
export { startServer } from "./server/index.js";

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
export type { Transport, ClientMessage } from "./transport/types.js";
export type { ServerOptions } from "./server/index.js";
export type {
  EvalCase,
  EvalCaseResult,
  EvalDataset,
  EvalExpectations,
  EvalJudgeResult,
  EvalReport,
  EvalRunnerOptions,
  EvalRuleScore,
  EvalTrace,
} from "./evals/types.js";
