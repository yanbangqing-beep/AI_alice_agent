#!/usr/bin/env bun

import { loadConfig, parseCliArgs } from "./config/loader.js";
import { startRepl, runOnce } from "./cli/repl.js";

const args = process.argv.slice(2);

// Route "serve" subcommand to dedicated entry point
if (args[0] === "serve") {
  await import("./serve.js");
} else {
  const { overrides, prompt } = parseCliArgs(args);
  const config = loadConfig(overrides);

  if (prompt) {
    await runOnce(config, prompt);
  } else {
    await startRepl(config);
  }
}
