import { SafetyError } from "../core/errors.js";
import type { AliceConfig } from "../core/types.js";

const DEFAULT_DANGEROUS_COMMANDS = [
  "rm -rf /",
  "rm -rf ~",
  "rm -rf .",
  "rm -rf ..",
  "rm -rf *",
  "mkfs",
  "dd if=",
  ":(){:|:&};:",
  "chmod -R 777 /",
  "curl | sh",
  "curl | bash",
  "wget | sh",
  "wget | bash",
  "> /dev/sda",
  "shutdown",
  "reboot",
  "halt",
  "poweroff",
  "init 0",
  "init 6",
];

const DANGEROUS_PATTERNS = [
  /rm\s+(-\w*r\w*f\w*|-\w*f\w*r\w*)\s+\/(?!\S)/,
  /rm\s+(-\w*r\w*f\w*|-\w*f\w*r\w*)\s+~\//,
  /rm\s+(-\w*r\w*f\w*|-\w*f\w*r\w*)\s+\.(?:\s|$)/,
  /rm\s+(-\w*r\w*f\w*|-\w*f\w*r\w*)\s+\.\.(?:\s|$)/,
  /rm\s+(-\w*r\w*f\w*|-\w*f\w*r\w*)\s+\*(?:\s|$)/,
  /find\s+.+-delete(?:\s|$)/,
  />\s*\/dev\/[sh]d[a-z]/,
  /mkfs\./,
  /dd\s+if=.*of=\/dev/,
];

export function checkCommandSafety(
  command: string,
  config?: AliceConfig,
): void {
  const blacklist = config?.safety.dangerousCommandBlacklist ?? DEFAULT_DANGEROUS_COMMANDS;

  // Check exact matches
  const lower = command.toLowerCase().trim();
  for (const dangerous of blacklist) {
    if (lower.includes(dangerous.toLowerCase())) {
      throw new SafetyError(
        `Blocked dangerous command: "${command}" matches blacklist entry "${dangerous}"`,
      );
    }
  }

  // Check regex patterns
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      throw new SafetyError(
        `Blocked dangerous command pattern: "${command}"`,
      );
    }
  }
}

export function checkPathSafety(
  filePath: string,
  config?: AliceConfig,
): void {
  const restrictions = config?.safety.pathRestrictions ?? [];

  // Resolve path (handle non-existent files by using path.resolve)
  const { resolve: pathResolve } = require("path");
  const resolved = pathResolve(process.cwd(), filePath) as string;

  for (const restricted of restrictions) {
    if (resolved.startsWith(restricted)) {
      throw new SafetyError(
        `Access to restricted path: "${filePath}" (resolves to "${resolved}")`,
      );
    }
  }

  // Block common sensitive paths
  const sensitivePatterns = [
    /\/\.ssh\//,
    /\/\.gnupg\//,
    /\/\.aws\/credentials/,
    /\/\.env\.production/,
  ];

  for (const pattern of sensitivePatterns) {
    if (pattern.test(resolved)) {
      throw new SafetyError(
        `Access to sensitive path blocked: "${filePath}"`,
      );
    }
  }
}
