import { existsSync } from "fs";
import { join, resolve } from "path";
import type { AliceConfig } from "../core/types.js";
import { loadDotEnv } from "./env.js";

const DEFAULT_CONFIG: AliceConfig = {
  provider: {
    defaultModel: "MiniMax-M1-80k",
    baseUrl: "https://api.minimaxi.com/anthropic",
    maxTokens: 8192,
    thinking: {
      enabled: false,
    },
  },
  models: {
    primary: "MiniMax-M1-80k",
    fallback: ["claude-sonnet-4-20250514", "claude-haiku-4-5-20251001"],
  },
  maxTurns: 50,
  maxRetries: 3,
  compression: {
    enabled: true,
    threshold: 80000,
    strategy: "micro-compact",
  },
  safety: {
    dangerousCommandBlacklist: [],
    pathRestrictions: [],
    requireConfirmation: true,
  },
  debug: true,
  skillsDir: ["./skills"],
  configDir: join(process.env.HOME || "~", ".alice"),
};

/**
 * Deep merge two objects. Source values override target values.
 */
function deepMerge(
  target: Record<string, any>,
  source: Record<string, any>,
): any {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const sourceVal = source[key];
    const targetVal = target[key];

    if (
      sourceVal &&
      typeof sourceVal === "object" &&
      !Array.isArray(sourceVal) &&
      targetVal &&
      typeof targetVal === "object" &&
      !Array.isArray(targetVal)
    ) {
      result[key] = deepMerge(targetVal, sourceVal);
    } else if (sourceVal !== undefined) {
      result[key] = sourceVal;
    }
  }
  return result;
}

/**
 * Load config from a JSON file if it exists.
 */
function loadJsonConfig(filePath: string): Partial<AliceConfig> {
  if (!existsSync(filePath)) return {};
  try {
    const content = require("fs").readFileSync(filePath, "utf-8");
    return JSON.parse(content);
  } catch {
    return {};
  }
}

/**
 * Load layered configuration:
 * 1. Default config
 * 2. Global config (~/.alice/config.json)
 * 3. Project config (.alice/config.json)
 * 4. Environment variables
 * 5. CLI arguments (passed in)
 */
export function loadConfig(
  cliOverrides: Partial<AliceConfig> = {},
): AliceConfig {
  loadDotEnv();

  // Layer 1: defaults
  let config = { ...DEFAULT_CONFIG };

  // Layer 2: global config
  const globalConfigPath = join(
    process.env.HOME || "~",
    ".alice",
    "config.json",
  );
  config = deepMerge(config, loadJsonConfig(globalConfigPath));

  // Layer 3: project config
  const projectConfigPath = resolve(".alice", "config.json");
  config = deepMerge(config, loadJsonConfig(projectConfigPath));

  // Layer 4: environment variables
  const envOverrides: Partial<AliceConfig> = {};
  if (process.env.ANTHROPIC_API_KEY) {
    envOverrides.provider = {
      ...config.provider,
      apiKey: process.env.ANTHROPIC_API_KEY,
    };
  }
  if (process.env.ANTHROPIC_BASE_URL) {
    envOverrides.provider = {
      ...(envOverrides.provider || config.provider),
      baseUrl: process.env.ANTHROPIC_BASE_URL,
    };
  }
  if (process.env.ALICE_MODEL) {
    envOverrides.provider = {
      ...(envOverrides.provider || config.provider),
      defaultModel: process.env.ALICE_MODEL,
    };
    envOverrides.models = {
      ...config.models,
      primary: process.env.ALICE_MODEL,
    };
  }
  if (process.env.ALICE_DEBUG === "true") {
    envOverrides.debug = true;
  }
  config = deepMerge(config, envOverrides);

  // Layer 5: CLI overrides
  config = deepMerge(config, cliOverrides);

  return config;
}

/**
 * Parse CLI arguments into config overrides.
 */
export function parseCliArgs(args: string[]): {
  overrides: Partial<AliceConfig>;
  prompt?: string;
} {
  const overrides: Partial<AliceConfig> = {};
  let prompt: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;

    switch (arg) {
      case "--model":
      case "-m":
        const model = args[++i];
        if (model) {
          overrides.provider = { ...overrides.provider, defaultModel: model } as any;
          overrides.models = { primary: model, fallback: [] };
        }
        break;
      case "--debug":
      case "-d":
        overrides.debug = true;
        break;
      case "--no-debug":
        overrides.debug = false;
        break;
      case "--no-safety":
        overrides.safety = {
          dangerousCommandBlacklist: [],
          pathRestrictions: [],
          requireConfirmation: false,
        };
        break;
      case "--max-turns":
        const turns = parseInt(args[++i] || "50");
        overrides.maxTurns = turns;
        break;
      case "--thinking":
        overrides.provider = {
          ...overrides.provider,
          thinking: { enabled: true },
        } as any;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
        break;
      case "--version":
      case "-v":
        console.log("alice-agent v0.1.0");
        process.exit(0);
        break;
      default:
        if (!arg.startsWith("-") && !prompt) {
          prompt = arg;
        }
        break;
    }
  }

  return { overrides, prompt };
}

function printHelp(): void {
  console.log(`
alice - A universal AI Agent CLI

Usage:
  alice [options] [prompt]

Options:
  -m, --model <model>    Set the model to use
  -d, --debug            Enable debug mode (default: on)
  --no-debug             Disable debug mode
  --thinking             Enable extended thinking
  --max-turns <n>        Maximum agent turns (default: 50)
  --no-safety            Disable safety checks
  -h, --help             Show this help
  -v, --version          Show version
`);
}
