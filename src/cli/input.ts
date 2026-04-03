import * as readline from "readline";
import pc from "picocolors";

/**
 * Async input handler using a persistent readline interface.
 */
export class InputHandler {
  private rl: readline.Interface;
  private closed = false;

  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });

    this.rl.on("close", () => {
      this.closed = true;
    });
  }

  /**
   * Prompt the user for input. Returns null if EOF or empty.
   */
  async prompt(prefix: string = "you"): Promise<string | null> {
    if (this.closed) return null;

    const promptStr = pc.bold(pc.green(`${prefix} > `));

    return new Promise<string | null>((resolve) => {
      this.rl.question(promptStr, (answer) => {
        const trimmed = answer.trim();
        resolve(trimmed || null);
      });
    });
  }

  /**
   * Read multiline input (end with \).
   */
  async promptMultiline(prefix: string = "you"): Promise<string | null> {
    const lines: string[] = [];
    const firstLine = await this.prompt(prefix);
    if (firstLine === null) return null;
    lines.push(firstLine);

    while (lines[lines.length - 1]?.endsWith("\\")) {
      lines[lines.length - 1] = lines[lines.length - 1]!.slice(0, -1);
      const next = await this.prompt("...");
      if (next === null) break;
      lines.push(next);
    }

    return lines.join("\n");
  }

  close(): void {
    if (!this.closed) {
      this.rl.close();
      this.closed = true;
    }
  }
}
