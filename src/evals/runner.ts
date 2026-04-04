import { chdir, cwd } from "process";
import { mkdirSync } from "fs";
import { join, resolve } from "path";
import { Agent } from "../core/agent.js";
import { AnthropicProvider } from "../core/provider.js";
import type { AgentEvent, Provider } from "../core/types.js";
import { loadConfig } from "../config/loader.js";
import { ContextAssembly } from "../context/assembly/index.js";
import { ToolRegistry } from "../tools/registry.js";
import { getBuiltinTools } from "../tools/builtin/index.js";
import { loadDataset, selectCases } from "./dataset.js";
import { runJudge } from "./judge.js";
import { formatReport } from "./report.js";
import { scoreCaseRules } from "./scoring.js";
import type {
  EvalCase,
  EvalCaseResult,
  EvalReport,
  EvalRunCaseOptions,
  EvalRunnerOptions,
  EvalToolTrace,
  EvalTrace,
} from "./types.js";
import { createEvalWorkspace } from "./workspace.js";

function buildJudgeProvider(config = loadConfig(), model?: string): Provider {
  const judgeConfig = {
    ...config.provider,
    defaultModel: model || process.env.ALICE_EVAL_JUDGE_MODEL || config.provider.defaultModel,
  };
  return new AnthropicProvider(judgeConfig);
}

function extractFinalText(agent: Agent): string {
  const assistantMessages = agent
    .getSession()
    .messages.filter((message) => message.role === "assistant");
  const last = assistantMessages[assistantMessages.length - 1];
  if (!last) return "";
  if (typeof last.content === "string") return last.content;
  return last.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function combineScores(ruleScore: number, judgeAvailable: boolean, judgeScore: number): number {
  if (!judgeAvailable) return ruleScore;
  return Math.round(ruleScore * 0.6 + judgeScore * 0.4);
}

function createToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  for (const tool of getBuiltinTools()) {
    registry.register(tool);
  }
  return registry;
}

function attachTrace(agent: Agent): { trace: EvalTrace } {
  const toolCalls: EvalToolTrace[] = [];
  const events: AgentEvent[] = [];
  const errors: string[] = [];
  const trace: EvalTrace = {
    events,
    toolCalls,
    turns: 0,
    errors,
    durationMs: 0,
  };

  agent.on((event) => {
    events.push(event);
    if (event.type === "turn_start") trace.turns++;
    if (event.type === "tool_use") {
      const data = event.data as { name: string; input: Record<string, unknown> };
      toolCalls.push({ name: data.name, input: data.input });
    }
    if (event.type === "tool_result") {
      const data = event.data as { name: string; content: string; is_error?: boolean };
      const pending = [...toolCalls].reverse().find((tool) => tool.name === data.name && !tool.result);
      if (pending) {
        pending.result = { content: data.content, is_error: data.is_error };
      }
    }
    if (event.type === "error") {
      const data = event.data as { message?: string } | undefined;
      if (data?.message) errors.push(data.message);
    }
  });

  return { trace };
}

export async function runEvalCase(options: EvalRunCaseOptions): Promise<EvalCaseResult> {
  const workspace = createEvalWorkspace(options.caseDef, options.datasetDir, options.workRoot);
  const originalCwd = cwd();
  const startedAt = Date.now();

  try {
    chdir(workspace.rootDir);

    const tools = createToolRegistry();
    const contextAssembly = new ContextAssembly(workspace.rootDir, options.caseDef.prompt);
    const agent = new Agent(options.provider, tools, options.config, contextAssembly);
    const traceRef = attachTrace(agent);

    await agent.run(options.caseDef.prompt);

    const finalText = extractFinalText(agent);
    traceRef.trace.durationMs = Date.now() - startedAt;
    const ruleScore = await scoreCaseRules(options.caseDef, {
      workspaceDir: workspace.rootDir,
      trace: traceRef.trace,
      finalText,
    });

    const judgeProvider = options.judgeOverride?.disabled
      ? null
      : buildJudgeProvider(options.config, options.judgeOverride?.model);
    const judgeScore = judgeProvider
      ? await runJudge(judgeProvider, options.caseDef, finalText, traceRef.trace, ruleScore.score)
      : {
          available: false,
          passed: true,
          score: 0,
          reason: "Judge disabled by CLI flag",
          strengths: [],
          failures: [],
        };

    const totalScore = combineScores(ruleScore.score, judgeScore.available, judgeScore.score);
    return {
      caseId: options.caseDef.id,
      passed: ruleScore.passed && (!judgeScore.available || judgeScore.passed),
      ruleScore,
      judgeScore,
      totalScore,
      session: agent.getSession(),
      finalText,
      workspaceDir: workspace.rootDir,
      trace: traceRef.trace,
    };
  } finally {
    chdir(originalCwd);
  }
}

export async function runDataset(options: EvalRunnerOptions = {}): Promise<EvalReport> {
  const config = loadConfig();
  const { dataset, datasetDir } = await loadDataset(options.datasetId || "core-tools");
  const cases = selectCases(dataset, options.caseId);
  const runs = Math.max(options.runs || 1, 1);
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const results: EvalCaseResult[] = [];

  for (let runIndex = 0; runIndex < runs; runIndex++) {
    for (const caseDef of cases) {
      const provider = new AnthropicProvider(config.provider);
      const result = await runEvalCase({
        config,
        provider,
        caseDef: withRunSuffix(caseDef, runs, runIndex),
        datasetDir,
        judgeOverride: {
          disabled: options.noJudge,
          model: options.judgeModel,
        },
        workRoot: options.workRoot,
      });
      results.push(result);
    }
  }

  const finishedAt = new Date().toISOString();
  const durationMs = Date.now() - startedMs;
  const passed = results.filter((result) => result.passed).length;
  const failed = results.length - passed;
  const averageScore = results.length === 0
    ? 0
    : Math.round(results.reduce((sum, result) => sum + result.totalScore, 0) / results.length);

  return {
    datasetId: dataset.id,
    startedAt,
    finishedAt,
    durationMs,
    passed,
    failed,
    averageScore,
    results,
  };
}

function withRunSuffix(caseDef: EvalCase, runs: number, index: number): EvalCase {
  if (runs === 1) return caseDef;
  return {
    ...caseDef,
    id: `${caseDef.id}#${index + 1}`,
  };
}

export async function runDatasetFromCli(options: EvalRunnerOptions = {}): Promise<void> {
  const report = await runDataset(options);
  const reportPath = await saveReport(report);
  report.reportPath = reportPath;
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(formatReport(report));
  console.log(`\nReport saved: ${reportPath}`);
}

async function saveReport(report: EvalReport): Promise<string> {
  const reportDir = resolve(".alice/evals/reports");
  mkdirSync(reportDir, { recursive: true });
  const safeDatasetId = report.datasetId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const timestamp = report.finishedAt.replace(/[:.]/g, "-");
  const reportPath = join(reportDir, `${safeDatasetId}-${timestamp}.json`);
  await Bun.write(reportPath, JSON.stringify(report, null, 2));
  return reportPath;
}
