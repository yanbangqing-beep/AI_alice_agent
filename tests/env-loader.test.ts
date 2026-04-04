import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { loadConfig } from "../src/config/loader.js";

describe("dotenv loading", () => {
  test("loadConfig respects process env and can read .env from cwd", () => {
    const prevCwd = process.cwd();
    const tempDir = mkdtempSync(join(tmpdir(), "alice-dotenv-"));
    const previousApiKey = process.env.ANTHROPIC_API_KEY;
    const previousBaseUrl = process.env.ANTHROPIC_BASE_URL;

    try {
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_BASE_URL;
      writeFileSync(
        join(tempDir, ".env"),
        "ANTHROPIC_API_KEY=test-key\nANTHROPIC_BASE_URL=https://example.test/anthropic\n",
        "utf-8",
      );
      process.chdir(tempDir);

      const config = loadConfig();
      expect(config.provider.apiKey).toBe("test-key");
      expect(config.provider.baseUrl).toBe("https://example.test/anthropic");
    } finally {
      process.chdir(prevCwd);
      if (previousApiKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = previousApiKey;
      if (previousBaseUrl === undefined) delete process.env.ANTHROPIC_BASE_URL;
      else process.env.ANTHROPIC_BASE_URL = previousBaseUrl;
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
