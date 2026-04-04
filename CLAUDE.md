# Alice Agent

Personal AI Agent with coding ability, problem-solving skills, and emotional support. Built with TypeScript + Bun.

## Quick Reference

```bash
bun run start          # CLI interactive mode
bun run dev            # CLI with hot reload
bun run serve          # Start Web server (default port 3000)
bun run serve:dev      # Web server with hot reload
bun test               # Run tests
bun run typecheck      # TypeScript type check
bun run eval           # Run eval suite
bun run build          # Compile to standalone binary
```

## Architecture

```
src/
├── cli.ts                    # Entry point (routes: REPL / one-shot / serve)
├── serve.ts                  # `alice serve` entry point
├── index.ts                  # Public API exports
│
├── core/                     # Agent core (DO NOT break these interfaces)
│   ├── agent.ts              # Agent class: conversation loop, tool execution
│   ├── provider.ts           # AnthropicProvider: Anthropic SDK wrapper
│   ├── types.ts              # All type definitions (Message, AgentEvent, etc.)
│   └── errors.ts             # Error types, retry logic, model degradation
│
├── transport/                # Transport abstraction layer
│   ├── types.ts              # Transport interface + ClientMessage
│   ├── cli.ts                # CliTransport (wraps Renderer + InputHandler)
│   ├── http.ts               # HttpTransport (SSE streaming)
│   ├── ws.ts                 # WsTransport (WebSocket bidirectional)
│   └── index.ts              # Module exports
│
├── server/                   # Web server (Bun.serve)
│   └── index.ts              # HTTP routes + SSE + WebSocket handlers
│
├── cli/                      # CLI-specific modules
│   ├── repl.ts               # REPL loop, slash commands
│   ├── renderer.ts           # Terminal event renderer (ANSI output)
│   └── input.ts              # Readline input handler
│
├── context/                  # Context management
│   ├── assembly/             # 8-dimensional context assembly system
│   │   ├── index.ts          # ContextAssembly orchestrator
│   │   ├── identity.ts       # 1. Role identity
│   │   ├── behavior.ts       # 2. Behavioral contracts
│   │   ├── tools.ts          # 3. Tool usage policies
│   │   ├── risk.ts           # 4. Risk governance
│   │   ├── environment.ts    # 5. Session environment
│   │   ├── memory.ts         # 6. Memory & persistence
│   │   ├── style.ts          # 7. Expression style
│   │   └── mode.ts           # 8. Mode enhancements (coding/chat/comfort/brief)
│   └── compression.ts        # Message compression (micro-compact/llm-summary/truncate)
│
├── tools/                    # Tool system
│   ├── registry.ts           # ToolRegistry: register, execute, list
│   ├── safety.ts             # Command & path safety validation
│   └── builtin/              # Built-in tools: bash, read, write, edit
│
├── skills/                   # Dynamic skill loading
│   └── loader.ts             # Skill matching & context injection
│
├── config/                   # Configuration
│   ├── loader.ts             # 5-layer config merge (default→global→project→env→CLI)
│   └── env.ts                # .env file parser
│
└── evals/                    # Evaluation framework
    ├── runner.ts             # Eval case runner
    ├── judge.ts              # LLM-based judge
    ├── scoring.ts            # Scoring logic
    ├── dataset.ts            # Dataset loading
    ├── report.ts             # Report formatting
    ├── types.ts              # Eval types
    └── workspace.ts          # Temp workspace management
```

## Key Design Patterns

### Transport Abstraction

Agent communicates through the `Transport` interface. Never couple Agent to a specific I/O mechanism.

```
Agent.on(handler) → Transport.send(event)    # Agent events → client
Transport.onMessage(handler)                  # Client input → Agent
```

Three implementations: `CliTransport` (terminal), `HttpTransport` (SSE), `WsTransport` (WebSocket).

### Event-Driven Agent

Agent emits `AgentEvent` for all state changes. Event types:
- `text_delta`, `thinking_delta` — streaming content
- `tool_use`, `tool_result` — tool execution
- `turn_start`, `turn_end` — turn boundaries
- `compression`, `error` — state changes
- `system_prompt`, `request`, `response`, `stream_event` — debug info

### 8-Dimensional Context Assembly

System prompt is composed from 8 independent dimensions with cache partitioning:
- **Static zone** (cacheable): identity, behavior, tools, risk, style
- **Dynamic zone** (per-turn): environment, memory, mode

### Config Layering

5-layer merge: defaults → `~/.alice/config.json` → `.alice/config.json` → env vars → CLI args.

## Web Server API

```
POST /api/chat              # Send message → SSE stream response
GET  /api/session           # Get session info
POST /api/session/clear     # Reset session
GET  /api/mode              # Get current mode
POST /api/mode              # Switch mode { mode: "coding" }
GET  /api/ws                # WebSocket upgrade
GET  /api/health            # Health check
```

SSE events use `event: <type>\ndata: <AgentEvent JSON>\n\n` format.
WebSocket client sends `ClientMessage` JSON, server pushes `AgentEvent` JSON.

## Development Guidelines

- **Runtime**: Bun (not Node). Use `Bun.serve()`, `Bun.file()`, `Bun.write()`, `Bun.spawn()`.
- **Language**: TypeScript strict mode. All types in `src/core/types.ts`.
- **Imports**: Use `.js` extensions in import paths (ESM convention).
- **Testing**: `bun test` with built-in test runner. Tests in `tests/` directory.
- **No external web frameworks**: HTTP server uses Bun native API only.
- **Agent core stability**: `src/core/agent.ts` should rarely change. Extend through Transport, Tools, or Context Assembly.
- **Safety**: All tool execution goes through `safety.ts` checks. Never bypass.
