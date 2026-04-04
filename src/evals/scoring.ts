import { resolve } from "path";
import type {
  EvalCase,
  EvalCaseResult,
  EvalCommandAssertion,
  EvalExpectations,
  EvalFileAssertion,
  EvalRuleCheck,
  EvalRuleScore,
} from "./types.js";

function getAssistantText(sessionResult: string): string {
  return sessionResult.trim();
}

async function evaluateFileAssertion(
  workspaceDir: string,
  assertion: EvalFileAssertion,
): Promise<EvalRuleCheck> {
  const filePath = resolve(workspaceDir, assertion.path);
  const file = Bun.file(filePath);
  const exists = await file.exists();

  if (assertion.mustExist === false) {
    return {
      name: `file:${assertion.path}`,
      passed: !exists,
      message: exists ? `File should not exist: ${assertion.path}` : `File absent as expected: ${assertion.path}`,
      weight: 12,
    };
  }

  if (!exists) {
    return {
      name: `file:${assertion.path}`,
      passed: false,
      message: `Missing file: ${assertion.path}`,
      weight: 12,
    };
  }

  const content = exists ? await file.text() : "";
  const missing = (assertion.includes || []).filter((needle) => !content.includes(needle));
  const forbidden = (assertion.excludes || []).filter((needle) => content.includes(needle));

  return {
    name: `file:${assertion.path}`,
    passed: missing.length === 0 && forbidden.length === 0,
    message:
      missing.length > 0
        ? `Missing expected text in ${assertion.path}: ${missing.join(", ")}`
        : forbidden.length > 0
          ? `Found forbidden text in ${assertion.path}: ${forbidden.join(", ")}`
          : `File assertion passed: ${assertion.path}`,
    weight: 12,
  };
}

async function evaluateCommandAssertion(
  workspaceDir: string,
  assertion: EvalCommandAssertion,
): Promise<EvalRuleCheck> {
  const proc = Bun.spawn(["bash", "-lc", assertion.command], {
    cwd: workspaceDir,
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  const output = `${stdout}${stderr ? (stdout ? "\n" : "") + stderr : ""}`;

  const missing = (assertion.stdoutIncludes || []).filter((needle) => !output.includes(needle));
  const exitMismatch = assertion.exitCode !== undefined && exitCode !== assertion.exitCode;

  return {
    name: `command:${assertion.command}`,
    passed: missing.length === 0 && !exitMismatch,
    message:
      exitMismatch
        ? `Expected exit ${assertion.exitCode}, got ${exitCode}`
        : missing.length > 0
          ? `Missing command output: ${missing.join(", ")}`
          : `Command assertion passed: ${assertion.command}`,
    weight: 15,
  };
}

function evaluateTools(expectations: EvalExpectations, toolNames: string[]): EvalRuleCheck[] {
  const checks: EvalRuleCheck[] = [];

  for (const tool of expectations.requiredTools || []) {
    checks.push({
      name: `required-tool:${tool}`,
      passed: toolNames.includes(tool),
      message: toolNames.includes(tool) ? `Required tool used: ${tool}` : `Required tool missing: ${tool}`,
      weight: 8,
    });
  }

  for (const tool of expectations.forbiddenTools || []) {
    checks.push({
      name: `forbidden-tool:${tool}`,
      passed: !toolNames.includes(tool),
      message: toolNames.includes(tool) ? `Forbidden tool used: ${tool}` : `Forbidden tool avoided: ${tool}`,
      weight: 8,
    });
  }

  return checks;
}

function evaluateLimits(caseDef: EvalCase, result: Pick<EvalCaseResult, "trace" | "finalText">): EvalRuleCheck[] {
  const checks: EvalRuleCheck[] = [];

  if (caseDef.expectations.maxTurns !== undefined) {
    checks.push({
      name: "max-turns",
      passed: result.trace.turns <= caseDef.expectations.maxTurns,
      message: `Turns: ${result.trace.turns}/${caseDef.expectations.maxTurns}`,
      weight: 8,
    });
  }

  if (caseDef.expectations.maxErrors !== undefined) {
    checks.push({
      name: "max-errors",
      passed: result.trace.errors.length <= caseDef.expectations.maxErrors,
      message: `Errors: ${result.trace.errors.length}/${caseDef.expectations.maxErrors}`,
      weight: 8,
    });
  }

  if (caseDef.expectations.responseIncludes?.length) {
    const finalText = getAssistantText(result.finalText);
    const missing = caseDef.expectations.responseIncludes.filter((needle) => !finalText.includes(needle));
    checks.push({
      name: "response-includes",
      passed: missing.length === 0,
      message: missing.length === 0 ? "Final response includes expected text" : `Missing response text: ${missing.join(", ")}`,
      weight: 10,
    });
  }

  if (caseDef.expectations.responseIncludesAny?.length) {
    const finalText = getAssistantText(result.finalText);
    const matched = caseDef.expectations.responseIncludesAny.filter((needle) => finalText.includes(needle));
    checks.push({
      name: "response-includes-any",
      passed: matched.length > 0,
      message: matched.length > 0
        ? `Final response matched one of: ${matched.join(", ")}`
        : `Missing any acceptable response text: ${caseDef.expectations.responseIncludesAny.join(", ")}`,
      weight: 10,
    });
  }

  if (caseDef.expectations.responseExcludes?.length) {
    const finalText = getAssistantText(result.finalText);
    const forbidden = caseDef.expectations.responseExcludes.filter((needle) => finalText.includes(needle));
    checks.push({
      name: "response-excludes",
      passed: forbidden.length === 0,
      message: forbidden.length === 0
        ? "Final response avoided forbidden text"
        : `Final response leaked forbidden text: ${forbidden.join(", ")}`,
      weight: 12,
    });
  }

  return checks;
}

export async function scoreCaseRules(
  caseDef: EvalCase,
  result: Pick<EvalCaseResult, "workspaceDir" | "trace" | "finalText">,
): Promise<EvalRuleScore> {
  const toolNames = result.trace.toolCalls.map((tool) => tool.name);
  const checks: EvalRuleCheck[] = [
    ...evaluateTools(caseDef.expectations, toolNames),
    ...evaluateLimits(caseDef, result),
  ];

  for (const assertion of caseDef.expectations.fileAssertions || []) {
    checks.push(await evaluateFileAssertion(result.workspaceDir, assertion));
  }

  for (const assertion of caseDef.expectations.commandAssertions || []) {
    checks.push(await evaluateCommandAssertion(result.workspaceDir, assertion));
  }

  const totalWeight = checks.reduce((sum, check) => sum + check.weight, 0);
  const earnedWeight = checks.reduce((sum, check) => sum + (check.passed ? check.weight : 0), 0);
  const score = totalWeight === 0 ? 100 : Math.round((earnedWeight / totalWeight) * 100);

  return {
    score,
    passed: checks.every((check) => check.passed),
    checks,
  };
}
