#!/usr/bin/env bun

import { runDatasetFromCli } from "./evals/runner.js";
import type { EvalRunnerOptions } from "./evals/types.js";

function parseArgs(args: string[]): EvalRunnerOptions {
  const options: EvalRunnerOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--dataset":
        options.datasetId = args[++i];
        break;
      case "--case":
        options.caseId = args[++i];
        break;
      case "--json":
        options.json = true;
        break;
      case "--no-judge":
        options.noJudge = true;
        break;
      case "--judge-model":
        options.judgeModel = args[++i];
        break;
      case "--runs":
        options.runs = Number(args[++i] || "1");
        break;
      case "--work-root":
        options.workRoot = args[++i];
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
        break;
      default:
        if (!arg?.startsWith("-") && !options.datasetId) {
          options.datasetId = arg;
        }
        break;
    }
  }

  return options;
}

function printHelp(): void {
  console.log(`
alice-eval

Usage:
  bun src/eval-cli.ts [options]

Options:
  --dataset <name>      Dataset name or JSON path (default: core-tools)
  --case <id>           Run a single case
  --json                Print JSON report
  --no-judge            Disable LLM judge
  --judge-model <name>  Override judge model
  --runs <n>            Repeat dataset N times
  --work-root <dir>     Workspace root directory
  -h, --help            Show help
`);
}

await runDatasetFromCli(parseArgs(process.argv.slice(2)));
