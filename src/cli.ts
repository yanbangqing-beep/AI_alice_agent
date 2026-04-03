#!/usr/bin/env bun

import { loadConfig, parseCliArgs } from "./config/loader.js";
import { startRepl, runOnce } from "./cli/repl.js";

const { overrides, prompt } = parseCliArgs(process.argv.slice(2));
const config = loadConfig(overrides);

if (prompt) {
  // Non-interactive: run a single prompt
  await runOnce(config, prompt);
} else {
  // Interactive: start REPL
  await startRepl(config);
}
