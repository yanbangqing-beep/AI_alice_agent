import { describe, expect, test } from "bun:test";
import {
  AliceError,
  ProviderError,
  ToolError,
  SafetyError,
  ContextOverflowError,
  ModelDegrader,
  withRetry,
} from "../src/core/errors.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { getBuiltinTools } from "../src/tools/builtin/index.js";
import { checkCommandSafety, checkPathSafety } from "../src/tools/safety.js";
import {
  estimateTokens,
  needsCompression,
  compressMessages,
} from "../src/context/compression.js";
import { loadConfig, parseCliArgs } from "../src/config/loader.js";
import { loadSkills, matchSkills, formatSkillsAsContext } from "../src/skills/loader.js";
import type { Message, Tool } from "../src/core/types.js";

// ─── Error Tests ─────────────────────────────────────────────────

describe("Errors", () => {
  test("AliceError has correct properties", () => {
    const err = new AliceError("test", "TEST_CODE", true);
    expect(err.message).toBe("test");
    expect(err.code).toBe("TEST_CODE");
    expect(err.retryable).toBe(true);
  });

  test("ProviderError marks 429 as retryable", () => {
    const err = new ProviderError("rate limited", 429);
    expect(err.retryable).toBe(true);
  });

  test("ProviderError marks 400 as non-retryable", () => {
    const err = new ProviderError("bad request", 400);
    expect(err.retryable).toBe(false);
  });

  test("ToolError is non-retryable", () => {
    const err = new ToolError("fail", "bash");
    expect(err.retryable).toBe(false);
    expect(err.toolName).toBe("bash");
  });

  test("SafetyError is non-retryable", () => {
    const err = new SafetyError("blocked");
    expect(err.retryable).toBe(false);
    expect(err.code).toBe("SAFETY_ERROR");
  });
});

// ─── ModelDegrader Tests ─────────────────────────────────────────

describe("ModelDegrader", () => {
  test("starts with first model", () => {
    const d = new ModelDegrader(["opus", "sonnet", "haiku"]);
    expect(d.current).toBe("opus");
  });

  test("degrades through models", () => {
    const d = new ModelDegrader(["opus", "sonnet", "haiku"]);
    expect(d.degrade()).toBe("sonnet");
    expect(d.degrade()).toBe("haiku");
    expect(d.degrade()).toBeNull();
  });

  test("reset returns to first model", () => {
    const d = new ModelDegrader(["a", "b"]);
    d.degrade();
    d.reset();
    expect(d.current).toBe("a");
  });

  test("isAtLowest works", () => {
    const d = new ModelDegrader(["a", "b"]);
    expect(d.isAtLowest).toBe(false);
    d.degrade();
    expect(d.isAtLowest).toBe(true);
  });

  test("throws on empty models", () => {
    expect(() => new ModelDegrader([])).toThrow();
  });
});

// ─── Retry Tests ─────────────────────────────────────────────────

describe("withRetry", () => {
  test("returns immediately on success", async () => {
    const result = await withRetry(() => Promise.resolve(42));
    expect(result).toBe(42);
  });

  test("retries on retryable error", async () => {
    let attempts = 0;
    const result = await withRetry(
      () => {
        attempts++;
        if (attempts < 3) throw new Error("transient");
        return Promise.resolve("ok");
      },
      { maxRetries: 3, baseDelay: 10, maxDelay: 50 },
    );
    expect(result).toBe("ok");
    expect(attempts).toBe(3);
  });

  test("stops on non-retryable AliceError", async () => {
    let attempts = 0;
    try {
      await withRetry(
        () => {
          attempts++;
          throw new AliceError("fatal", "FATAL", false);
        },
        { maxRetries: 3, baseDelay: 10, maxDelay: 50 },
      );
    } catch (e) {
      expect((e as AliceError).code).toBe("FATAL");
    }
    expect(attempts).toBe(1);
  });
});

// ─── ToolRegistry Tests ──────────────────────────────────────────

describe("ToolRegistry", () => {
  test("register and get tools", () => {
    const registry = new ToolRegistry();
    const tool: Tool = {
      definition: {
        name: "test",
        description: "test tool",
        input_schema: { type: "object", properties: {} },
      },
      execute: async () => ({ content: "ok" }),
    };

    registry.register(tool);
    expect(registry.has("test")).toBe(true);
    expect(registry.get("test")).toBe(tool);
  });

  test("getDefinitions returns all tool definitions", () => {
    const registry = new ToolRegistry();
    for (const tool of getBuiltinTools()) {
      registry.register(tool);
    }
    const defs = registry.getDefinitions();
    expect(defs.length).toBe(4);
    expect(defs.map((d) => d.name).sort()).toEqual(["bash", "edit", "read", "write"]);
  });

  test("execute unknown tool returns error", async () => {
    const registry = new ToolRegistry();
    const result = await registry.execute("nope", {});
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("Unknown tool");
  });

  test("duplicate registration throws", () => {
    const registry = new ToolRegistry();
    const tool: Tool = {
      definition: {
        name: "dup",
        description: "dup",
        input_schema: { type: "object", properties: {} },
      },
      execute: async () => ({ content: "ok" }),
    };
    registry.register(tool);
    expect(() => registry.register(tool)).toThrow();
  });
});

// ─── Safety Tests ────────────────────────────────────────────────

describe("Safety", () => {
  test("blocks rm -rf /", () => {
    expect(() => checkCommandSafety("rm -rf /")).toThrow(SafetyError);
  });

  test("blocks rm -rf ~", () => {
    expect(() => checkCommandSafety("rm -rf ~/")).toThrow(SafetyError);
  });

  test("allows safe commands", () => {
    expect(() => checkCommandSafety("ls -la")).not.toThrow();
    expect(() => checkCommandSafety("git status")).not.toThrow();
    expect(() => checkCommandSafety("echo hello")).not.toThrow();
  });

  test("blocks mkfs", () => {
    expect(() => checkCommandSafety("mkfs.ext4 /dev/sda")).toThrow(SafetyError);
  });

  test("blocks .ssh access", () => {
    expect(() => checkPathSafety("/home/user/.ssh/id_rsa")).toThrow(SafetyError);
  });
});

// ─── Compression Tests ───────────────────────────────────────────

describe("Compression", () => {
  test("estimateTokens provides reasonable estimate", () => {
    const messages: Message[] = [
      { role: "user", content: "Hello world" }, // ~11 chars → ~3 tokens
    ];
    const tokens = estimateTokens(messages);
    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBeLessThan(10);
  });

  test("needsCompression returns false for short conversations", () => {
    const messages: Message[] = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi!" },
    ];
    expect(needsCompression(messages)).toBe(false);
  });

  test("needsCompression returns true for long conversations", () => {
    const longContent = "x".repeat(300000);
    const messages: Message[] = [
      { role: "user", content: longContent },
    ];
    expect(needsCompression(messages)).toBe(true);
  });

  test("compressMessages preserves short conversations", async () => {
    const messages: Message[] = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi!" },
    ];
    const result = await compressMessages(messages);
    expect(result.length).toBe(2);
  });
});

// ─── Config Tests ────────────────────────────────────────────────

describe("Config", () => {
  test("loadConfig returns defaults", () => {
    const config = loadConfig();
    expect(config.maxTurns).toBe(50);
    expect(config.maxRetries).toBe(3);
    expect(config.compression.enabled).toBe(true);
  });

  test("loadConfig merges overrides", () => {
    const config = loadConfig({ debug: true, maxTurns: 10 });
    expect(config.debug).toBe(true);
    expect(config.maxTurns).toBe(10);
  });

  test("parseCliArgs handles --debug", () => {
    const { overrides } = parseCliArgs(["--debug"]);
    expect(overrides.debug).toBe(true);
  });

  test("parseCliArgs handles --model", () => {
    const { overrides } = parseCliArgs(["--model", "MiniMax-M1-80k"]);
    expect(overrides.provider?.defaultModel).toBe("MiniMax-M1-80k");
  });

  test("parseCliArgs captures prompt", () => {
    const { prompt } = parseCliArgs(["hello world"]);
    expect(prompt).toBe("hello world");
  });
});

// ─── Skills Tests ────────────────────────────────────────────────

describe("Skills", () => {
  test("loadSkills loads example skill", () => {
    const skills = loadSkills(["./skills"]);
    expect(skills.length).toBe(1);
    expect(skills[0]!.name).toBe("code-review");
  });

  test("matchSkills matches by trigger", () => {
    const skills = loadSkills(["./skills"]);
    const matched = matchSkills(skills, "please review this code");
    expect(matched.length).toBe(1);
  });

  test("matchSkills returns empty for no match", () => {
    const skills = loadSkills(["./skills"]);
    const matched = matchSkills(skills, "unrelated query");
    expect(matched.length).toBe(0);
  });

  test("formatSkillsAsContext returns empty for no skills", () => {
    expect(formatSkillsAsContext([])).toBe("");
  });

  test("loadSkills handles missing directory", () => {
    const skills = loadSkills(["./nonexistent"]);
    expect(skills.length).toBe(0);
  });
});

// ─── Builtin Tool Tests ─────────────────────────────────────────

describe("Builtin Tools", () => {
  test("bash: runs simple command", async () => {
    const tools = getBuiltinTools();
    const bash = tools.find((t) => t.definition.name === "bash")!;
    const result = await bash.execute({ command: "echo hello" });
    expect(result.content.trim()).toBe("hello");
    expect(result.is_error).toBeUndefined();
  });

  test("bash: returns error for failing command", async () => {
    const tools = getBuiltinTools();
    const bash = tools.find((t) => t.definition.name === "bash")!;
    const result = await bash.execute({ command: "false" });
    expect(result.is_error).toBe(true);
  });

  test("read: reads existing file", async () => {
    const tools = getBuiltinTools();
    const read = tools.find((t) => t.definition.name === "read")!;
    const result = await read.execute({ file_path: "package.json" });
    expect(result.content).toContain("alice-agent");
  });

  test("read: returns error for missing file", async () => {
    const tools = getBuiltinTools();
    const read = tools.find((t) => t.definition.name === "read")!;
    const result = await read.execute({ file_path: "/tmp/nonexistent_alice_test" });
    expect(result.is_error).toBe(true);
  });

  test("write + read roundtrip", async () => {
    const tools = getBuiltinTools();
    const write = tools.find((t) => t.definition.name === "write")!;
    const read = tools.find((t) => t.definition.name === "read")!;

    const testPath = "/tmp/alice_test_write.txt";
    await write.execute({ file_path: testPath, content: "test content\nline 2" });
    const result = await read.execute({ file_path: testPath });
    expect(result.content).toContain("test content");
    expect(result.content).toContain("line 2");

    // Cleanup
    await Bun.spawn(["rm", testPath]).exited;
  });

  test("edit: replaces text in file", async () => {
    const tools = getBuiltinTools();
    const write = tools.find((t) => t.definition.name === "write")!;
    const edit = tools.find((t) => t.definition.name === "edit")!;
    const read = tools.find((t) => t.definition.name === "read")!;

    const testPath = "/tmp/alice_test_edit.txt";
    await write.execute({
      file_path: testPath,
      content: "hello world\nfoo bar",
    });

    const editResult = await edit.execute({
      file_path: testPath,
      old_string: "hello world",
      new_string: "goodbye world",
    });
    expect(editResult.content).toContain("Successfully replaced");

    const readResult = await read.execute({ file_path: testPath });
    expect(readResult.content).toContain("goodbye world");

    // Cleanup
    await Bun.spawn(["rm", testPath]).exited;
  });
});
