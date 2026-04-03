import pc from "picocolors";
import type { AliceConfig } from "../core/types.js";
import { AnthropicProvider } from "../core/provider.js";
import { Agent } from "../core/agent.js";
import { ToolRegistry } from "../tools/registry.js";
import { getBuiltinTools } from "../tools/builtin/index.js";
import { Renderer } from "./renderer.js";
import { InputHandler } from "./input.js";
import { ContextAssembly, detectModeCommand, getModeLabel, AVAILABLE_MODES } from "../context/assembly/index.js";

/**
 * Main REPL loop.
 */
export async function startRepl(config: AliceConfig): Promise<void> {
  Renderer.printBanner();

  // Initialize provider
  const provider = new AnthropicProvider(config.provider);

  // Initialize tool registry
  const tools = new ToolRegistry();
  for (const tool of getBuiltinTools()) {
    tools.register(tool);
  }

  // Initialize context assembly (8 dimensions)
  const contextAssembly = new ContextAssembly(process.cwd());

  console.log(
    pc.dim(
      `  model: ${config.models.primary}\n` +
        `  tools: ${tools.list().join(", ")}\n` +
        `  mode: ${getModeLabel(contextAssembly.getMode())}\n` +
        `  cwd: ${process.cwd()}\n`,
    ),
  );

  // Initialize agent with context assembly
  const agent = new Agent(provider, tools, config, contextAssembly);

  // Setup renderer
  const renderer = new Renderer({
    debug: config.debug,
  });

  agent.on((event) => renderer.handleEvent(event));

  // Input handler
  const input = new InputHandler();

  // Handle Ctrl+C gracefully
  process.on("SIGINT", () => {
    agent.abort();
    console.log(pc.dim("\n  (interrupted)"));
  });

  // REPL loop
  while (true) {
    const userInput = await input.prompt();

    if (userInput === null) {
      // EOF or empty
      continue;
    }

    // Handle mode switching commands (/code, /chat, /comfort, /brief)
    const newMode = detectModeCommand(userInput);
    if (newMode) {
      agent.switchMode(newMode);
      console.log(pc.dim(`  Mode: ${getModeLabel(newMode)}`));
      continue;
    }

    // Handle special commands
    if (userInput.startsWith("/")) {
      const handled = await handleCommand(userInput, agent, config);
      if (handled === "exit") break;
      continue;
    }

    // Run agent
    try {
      await agent.runStreaming(userInput);

      // Show token usage
      const session = agent.getSession();
      Renderer.printUsage(
        session.totalTokens.input,
        session.totalTokens.output,
      );
    } catch (error) {
      console.error(
        pc.red(
          `\n  Error: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    }
  }

  // Cleanup
  input.close();

  // Save session on exit
  try {
    const path = await agent.saveSession();
    console.log(pc.dim(`  Session saved: ${path}`));
  } catch {
    // Silently skip save errors
  }

  console.log(pc.dim("\n  Goodbye!\n"));
}

/**
 * Handle slash commands.
 */
async function handleCommand(
  command: string,
  agent: Agent,
  config: AliceConfig,
): Promise<string | void> {
  const [cmd, ...args] = command.split(" ");

  switch (cmd) {
    case "/exit":
    case "/quit":
    case "/q":
      return "exit";

    case "/clear":
      console.clear();
      Renderer.printBanner();
      break;

    case "/debug":
      config.debug = !config.debug;
      console.log(pc.dim(`  Debug mode: ${config.debug ? "on" : "off"}`));
      break;

    case "/model":
      if (args[0]) {
        config.models.primary = args[0];
        config.provider.defaultModel = args[0];
        console.log(pc.dim(`  Model: ${args[0]}`));
      } else {
        console.log(pc.dim(`  Current model: ${config.models.primary}`));
      }
      break;

    case "/session":
      const session = agent.getSession();
      console.log(pc.dim(`  ID: ${session.id}`));
      console.log(pc.dim(`  Messages: ${session.messages.length}`));
      console.log(
        pc.dim(
          `  Tokens: ${session.totalTokens.input.toLocaleString()} in / ${session.totalTokens.output.toLocaleString()} out`,
        ),
      );
      break;

    case "/save":
      try {
        const path = await agent.saveSession();
        console.log(pc.dim(`  Session saved: ${path}`));
      } catch (error) {
        console.log(
          pc.red(`  Failed to save: ${error instanceof Error ? error.message : String(error)}`),
        );
      }
      break;

    case "/mode":
      const ctx = agent.getContextAssembly();
      console.log(pc.dim(`  Current mode: ${getModeLabel(ctx.getMode())}`));
      console.log(pc.dim(`  Available: ${AVAILABLE_MODES.map(m => `/${m === "coding" ? "code" : m}`).join(", ")}`));
      break;

    case "/help":
      console.log(`
  ${pc.bold("Commands:")}
    /exit, /quit, /q   Exit Alice
    /clear             Clear screen
    /debug             Toggle debug mode
    /model [name]      Show or change model
    /mode              Show current mode
    /code              Switch to coding mode
    /chat              Switch to chat mode
    /comfort           Switch to comfort mode
    /brief             Switch to brief mode
    /session           Show session info
    /save              Save session
    /help              Show this help
`);
      break;

    default:
      console.log(pc.dim(`  Unknown command: ${cmd}. Type /help for available commands.`));
  }
}

/**
 * Run a single prompt (non-interactive mode).
 */
export async function runOnce(
  config: AliceConfig,
  prompt: string,
): Promise<void> {
  const provider = new AnthropicProvider(config.provider);

  const tools = new ToolRegistry();
  for (const tool of getBuiltinTools()) {
    tools.register(tool);
  }

  const contextAssembly = new ContextAssembly(process.cwd(), prompt);
  const agent = new Agent(provider, tools, config, contextAssembly);
  const renderer = new Renderer({
    debug: config.debug,
  });

  agent.on((event) => renderer.handleEvent(event));

  process.on("SIGINT", () => {
    agent.abort();
    process.exit(0);
  });

  await agent.runStreaming(prompt);

  const session = agent.getSession();
  Renderer.printUsage(session.totalTokens.input, session.totalTokens.output);
}
