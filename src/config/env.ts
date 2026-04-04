import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

const loadedDotEnvPaths = new Set<string>();

function parseDotEnv(content: string): Record<string, string> {
  const result: Record<string, string> = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separator = line.indexOf("=");
    if (separator === -1) continue;

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();

    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key) {
      result[key] = value;
    }
  }

  return result;
}

export function loadDotEnv(dotEnvPath: string = ".env"): void {
  const resolved = resolve(dotEnvPath);
  if (loadedDotEnvPaths.has(resolved)) return;
  if (!existsSync(resolved)) {
    return;
  }

  const parsed = parseDotEnv(readFileSync(resolved, "utf-8"));
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }

  loadedDotEnvPaths.add(resolved);
}
