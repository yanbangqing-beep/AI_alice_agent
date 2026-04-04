#!/usr/bin/env bun

import pc from "picocolors";
import { loadConfig } from "./config/loader.js";
import { startServer } from "./server/index.js";

/**
 * 解析 serve 命令参数。
 */
function parseServeArgs(args: string[]): { port: number; hostname?: string; overrides: Record<string, unknown> } {
  let port = 3000;
  let hostname: string | undefined;
  const overrides: Record<string, unknown> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--port":
      case "-p":
        port = parseInt(args[++i] || "3000", 10);
        break;
      case "--host":
        hostname = args[++i];
        break;
      case "--model":
      case "-m":
        const model = args[++i];
        overrides.provider = { defaultModel: model };
        overrides.models = { primary: model };
        break;
      case "--debug":
      case "-d":
        overrides.debug = true;
        break;
      case "--no-debug":
        overrides.debug = false;
        break;
      case "--help":
      case "-h":
        console.log(`
  ${pc.bold("alice serve")} — Start Alice Web Server

  ${pc.bold("Usage:")}
    alice serve [options]

  ${pc.bold("Options:")}
    -p, --port <port>    Port to listen on (default: 3000)
    --host <hostname>    Hostname to bind (default: 0.0.0.0)
    -m, --model <model>  Override model
    -d, --debug          Enable debug mode
    --no-debug           Disable debug mode
    -h, --help           Show this help

  ${pc.bold("API Endpoints:")}
    POST /api/chat           Send message, returns SSE stream
    GET  /api/session        Get session info
    POST /api/session/clear  Clear session
    GET  /api/mode           Get current mode
    POST /api/mode           Switch mode { mode: "coding" }
    GET  /api/ws             WebSocket endpoint
    GET  /api/health         Health check
`);
        process.exit(0);
    }
  }

  return { port, hostname, overrides };
}

// Main
const { port, hostname, overrides } = parseServeArgs(process.argv.slice(2));
const config = loadConfig(overrides as any);

const server = startServer(config, { port, hostname });

console.log(
  pc.bold(pc.cyan("\n  Alice Server")) +
    pc.dim(" v0.1.0\n"),
);
console.log(
  pc.dim(
    `  listening: ${pc.bold(`http://${hostname ?? "0.0.0.0"}:${port}`)}\n` +
      `  model:     ${config.models.primary}\n` +
      `  websocket: ws://${hostname ?? "0.0.0.0"}:${port}/api/ws\n`,
  ),
);
console.log(pc.dim("  Press Ctrl+C to stop.\n"));
