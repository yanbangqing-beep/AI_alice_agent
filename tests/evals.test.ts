import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  getDefaultDatasetDir,
  loadDataset,
  runEvalCase,
  formatReport,
  loadConfig,
} from "../src/index.js";
import type {
  ContentBlock,
  EvalCase,
  Message,
  Provider,
  ProviderResponse,
  ProviderStreamEvent,
  ToolResultBlock,
} from "../src/index.js";

class FakeProvider implements Provider {
  readonly name = "fake";

  async chat(messages: Message[]): Promise<ProviderResponse> {
    const last = messages[messages.length - 1];
    const toolResults = Array.isArray(last?.content)
      ? last.content.filter((block): block is ToolResultBlock => block.type === "tool_result")
      : [];

    const prompt = messages.find((message) => message.role === "user" && typeof message.content === "string")
      ?.content as string;

    let content: ContentBlock[];

    if (toolResults.length > 0) {
      if (prompt.includes("package.json")) {
        content = [{ type: "text", text: "The package name is demo-agent." }];
      } else {
        content = [{ type: "text", text: "Done." }];
      }
      return {
        content,
        model: "fake-model",
        usage: { input_tokens: 10, output_tokens: 10 },
        stop_reason: "end_turn",
      };
    }

    if (prompt.includes("package.json")) {
      content = [
        {
          type: "tool_use",
          id: "tool-1",
          name: "read",
          input: { file_path: "package.json" },
        },
      ];
    } else {
      content = [
        {
          type: "tool_use",
          id: "tool-1",
          name: "edit",
          input: {
            file_path: "src/message.txt",
            old_string: "Hello Alice",
            new_string: "Hello Agent Alice",
          },
        },
      ];
    }

    return {
      content,
      model: "fake-model",
      usage: { input_tokens: 10, output_tokens: 10 },
      stop_reason: "tool_use",
    };
  }

  async *stream(_messages: Message[]): AsyncIterable<ProviderStreamEvent> {
    return;
  }
}

describe("Eval framework", () => {
  test("loads bundled dataset", async () => {
    const { dataset, datasetPath } = await loadDataset("core-tools");
    expect(dataset.id).toBe("core-tools");
    expect(dataset.cases.length).toBeGreaterThanOrEqual(12);
    expect(datasetPath).toContain(getDefaultDatasetDir());
    const safetyCase = dataset.cases.find((item) => item.id === "safety-protect-env-production") as EvalCase;
    expect(safetyCase.expectations.forbiddenTools).toContain("read");
  });

  test("runEvalCase executes tools and scores a read case", async () => {
    const config = loadConfig();
    const { dataset, datasetDir } = await loadDataset("core-tools");
    const caseDef = dataset.cases.find((item) => item.id === "read-package-name") as EvalCase;
    const workRoot = mkdtempSync(join(tmpdir(), "alice-eval-test-"));

    try {
      const result = await runEvalCase({
        config,
        provider: new FakeProvider(),
        caseDef,
        datasetDir,
        judgeOverride: { disabled: true },
        workRoot,
      });

      expect(result.passed).toBe(true);
      expect(result.ruleScore.passed).toBe(true);
      expect(result.finalText).toContain("demo-agent");
      expect(result.trace.toolCalls.map((tool) => tool.name)).toEqual(["read"]);
    } finally {
      rmSync(workRoot, { recursive: true, force: true });
    }
  });

  test("runEvalCase executes edit case and report formatter includes status", async () => {
    const config = loadConfig();
    const { dataset, datasetDir } = await loadDataset("core-tools");
    const caseDef = dataset.cases.find((item) => item.id === "edit-greeting") as EvalCase;
    const workRoot = mkdtempSync(join(tmpdir(), "alice-eval-test-"));

    try {
      const result = await runEvalCase({
        config,
        provider: new FakeProvider(),
        caseDef,
        datasetDir,
        judgeOverride: { disabled: true },
        workRoot,
      });

      expect(result.ruleScore.score).toBe(100);
      const report = formatReport({
        datasetId: "core-tools",
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: 1,
        passed: 1,
        failed: 0,
        averageScore: result.totalScore,
        results: [result],
      });
      expect(report).toContain("PASS");
      expect(report).toContain("edit-greeting");
    } finally {
      rmSync(workRoot, { recursive: true, force: true });
    }
  });
});
