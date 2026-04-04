import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { tmpdir } from "os";
import type { EvalCase } from "./types.js";

export interface EvalWorkspace {
  rootDir: string;
  cleanup(): void;
}

export function createEvalWorkspace(
  caseDef: EvalCase,
  datasetDir: string,
  workRoot?: string,
): EvalWorkspace {
  const baseRoot = workRoot ? resolve(workRoot) : join(tmpdir(), "alice-evals");
  mkdirSync(baseRoot, { recursive: true });

  const rootDir = join(
    baseRoot,
    `${caseDef.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(rootDir, { recursive: true });

  if (caseDef.fixtureDir) {
    const fixtureSource = resolve(datasetDir, caseDef.fixtureDir);
    if (!existsSync(fixtureSource)) {
      throw new Error(`Fixture directory not found: ${fixtureSource}`);
    }
    cpSync(fixtureSource, rootDir, { recursive: true });
  }

  for (const file of caseDef.setup?.files || []) {
    const target = resolve(rootDir, file.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.content, "utf-8");
  }

  return {
    rootDir,
    cleanup() {
      rmSync(rootDir, { recursive: true, force: true });
    },
  };
}
