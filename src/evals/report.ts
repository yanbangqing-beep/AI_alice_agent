import pc from "picocolors";
import type { EvalReport } from "./types.js";

export function formatReport(report: EvalReport): string {
  const lines = [
    `${pc.bold("Dataset")}: ${report.datasetId}`,
    `${pc.bold("Duration")}: ${report.durationMs}ms`,
    `${pc.bold("Passed")}: ${report.passed}`,
    `${pc.bold("Failed")}: ${report.failed}`,
    `${pc.bold("Average")}: ${report.averageScore}`,
    "",
  ];

  for (const result of report.results) {
    const status = result.passed ? pc.green("PASS") : pc.red("FAIL");
    lines.push(
      `${status} ${result.caseId} score=${result.totalScore} rule=${result.ruleScore.score} judge=${result.judgeScore.available ? result.judgeScore.score : "n/a"} tools=${result.trace.toolCalls.map((tool) => tool.name).join(",") || "-"}`,
    );
    if (!result.passed) {
      const firstFailed = result.ruleScore.checks.find((check) => !check.passed);
      if (firstFailed) {
        lines.push(`  rule: ${firstFailed.message}`);
      } else {
        lines.push(`  judge: ${result.judgeScore.reason}`);
      }
      if (!result.judgeScore.available && result.judgeScore.reason) {
        lines.push(`  judge-info: ${result.judgeScore.reason}`);
      }
    }
  }

  return lines.join("\n");
}
