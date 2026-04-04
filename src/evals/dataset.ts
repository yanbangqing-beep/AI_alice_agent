import { existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";
import type { EvalCase, EvalDataset } from "./types.js";

const DEFAULT_DATASET_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../evals/datasets",
);

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function validateCase(caseDef: unknown, index: number): asserts caseDef is EvalCase {
  if (!isObject(caseDef)) {
    throw new Error(`Invalid eval case at index ${index}: expected object`);
  }
  if (typeof caseDef.id !== "string" || caseDef.id.length === 0) {
    throw new Error(`Invalid eval case at index ${index}: missing id`);
  }
  if (typeof caseDef.category !== "string") {
    throw new Error(`Invalid eval case "${caseDef.id}": missing category`);
  }
  if (typeof caseDef.prompt !== "string" || caseDef.prompt.length === 0) {
    throw new Error(`Invalid eval case "${caseDef.id}": missing prompt`);
  }
  if (!isObject(caseDef.expectations)) {
    throw new Error(`Invalid eval case "${caseDef.id}": missing expectations`);
  }
}

export function getDefaultDatasetDir(): string {
  return DEFAULT_DATASET_DIR;
}

export function resolveDatasetPath(dataset: string): string {
  if (dataset.endsWith(".json")) {
    return resolve(dataset);
  }
  return join(DEFAULT_DATASET_DIR, `${dataset}.json`);
}

export async function loadDataset(dataset: string): Promise<{
  dataset: EvalDataset;
  datasetPath: string;
  datasetDir: string;
}> {
  const datasetPath = resolveDatasetPath(dataset);
  if (!existsSync(datasetPath)) {
    throw new Error(`Dataset not found: ${datasetPath}`);
  }

  const content = await Bun.file(datasetPath).text();
  const parsed = JSON.parse(content) as unknown;

  if (!isObject(parsed) || typeof parsed.id !== "string" || !Array.isArray(parsed.cases)) {
    throw new Error(`Invalid dataset file: ${datasetPath}`);
  }

  parsed.cases.forEach((caseDef, index) => validateCase(caseDef, index));

  return {
    dataset: parsed as unknown as EvalDataset,
    datasetPath,
    datasetDir: dirname(datasetPath),
  };
}

export function selectCases(dataset: EvalDataset, caseId?: string): EvalCase[] {
  if (!caseId) return dataset.cases;
  const match = dataset.cases.find((item) => item.id === caseId);
  if (!match) {
    throw new Error(`Case not found in dataset "${dataset.id}": ${caseId}`);
  }
  return [match];
}
