import type { AgentEvent, AgentSession, AliceConfig, Provider } from "../core/types.js";

export type EvalCategory =
  | "file-read"
  | "code-edit"
  | "bug-fix"
  | "shell"
  | "recovery"
  | "safety";

export interface EvalSetupFile {
  path: string;
  content: string;
}

export interface EvalFileAssertion {
  path: string;
  mustExist?: boolean;
  includes?: string[];
  excludes?: string[];
}

export interface EvalCommandAssertion {
  command: string;
  stdoutIncludes?: string[];
  exitCode?: number;
}

export interface EvalExpectations {
  requiredTools?: string[];
  forbiddenTools?: string[];
  maxTurns?: number;
  maxErrors?: number;
  fileAssertions?: EvalFileAssertion[];
  commandAssertions?: EvalCommandAssertion[];
  responseIncludes?: string[];
  responseIncludesAny?: string[];
  responseExcludes?: string[];
}

export interface EvalJudgeConfig {
  enabled: boolean;
  rubric: {
    goalCompletion: number;
    toolAppropriateness: number;
    codeCorrectness: number;
    minimality: number;
  };
  passThreshold: number;
}

export interface EvalCase {
  id: string;
  category: EvalCategory;
  prompt: string;
  fixtureDir?: string;
  setup?: {
    files?: EvalSetupFile[];
  };
  expectations: EvalExpectations;
  judge?: EvalJudgeConfig;
}

export interface EvalDataset {
  id: string;
  description?: string;
  cases: EvalCase[];
}

export interface EvalToolTrace {
  name: string;
  input: Record<string, unknown>;
  result?: {
    content: string;
    is_error?: boolean;
  };
}

export interface EvalTrace {
  events: AgentEvent[];
  toolCalls: EvalToolTrace[];
  turns: number;
  errors: string[];
  durationMs: number;
}

export interface EvalRuleCheck {
  name: string;
  passed: boolean;
  message: string;
  weight: number;
}

export interface EvalRuleScore {
  score: number;
  passed: boolean;
  checks: EvalRuleCheck[];
}

export interface EvalJudgeResult {
  available: boolean;
  passed: boolean;
  score: number;
  reason: string;
  strengths: string[];
  failures: string[];
  suggestedLabel?: string;
  raw?: string;
}

export interface EvalCaseResult {
  caseId: string;
  passed: boolean;
  ruleScore: EvalRuleScore;
  judgeScore: EvalJudgeResult;
  totalScore: number;
  session: AgentSession;
  finalText: string;
  workspaceDir: string;
  trace: EvalTrace;
}

export interface EvalReport {
  datasetId: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  passed: number;
  failed: number;
  averageScore: number;
  results: EvalCaseResult[];
  reportPath?: string;
}

export interface EvalRunnerOptions {
  datasetId?: string;
  caseId?: string;
  json?: boolean;
  noJudge?: boolean;
  runs?: number;
  judgeModel?: string;
  workRoot?: string;
}

export interface EvalRunCaseOptions {
  config: AliceConfig;
  provider: Provider;
  caseDef: EvalCase;
  datasetDir: string;
  judgeOverride?: {
    disabled?: boolean;
    model?: string;
  };
  workRoot?: string;
}
