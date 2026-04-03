import { readdirSync, existsSync } from "fs";
import { join, resolve } from "path";

export interface Skill {
  name: string;
  description: string;
  trigger?: string;
  content: string;
  filePath: string;
}

interface SkillFrontmatter {
  name?: string;
  description?: string;
  trigger?: string;
  [key: string]: unknown;
}

/**
 * Parse YAML-like frontmatter from a markdown file.
 * Zero dependency: handles simple key: value pairs only.
 */
function parseFrontmatter(raw: string): {
  meta: SkillFrontmatter;
  content: string;
} {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    return { meta: {}, content: raw };
  }

  const meta: SkillFrontmatter = {};
  for (const line of match[1]!.split("\n")) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    let value = line.slice(colon + 1).trim();
    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    meta[key] = value;
  }

  return { meta, content: match[2]! };
}

/**
 * Load all skills from the given directories.
 * Skills are markdown files named SKILL.md in subdirectories.
 */
export function loadSkills(dirs: string[]): Skill[] {
  const skills: Skill[] = [];

  for (const dir of dirs) {
    const resolved = resolve(dir);
    if (!existsSync(resolved)) continue;

    try {
      const entries = readdirSync(resolved, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const skillFile = join(resolved, entry.name, "SKILL.md");
        if (!existsSync(skillFile)) continue;

        try {
          const raw = Bun.file(skillFile).text();
          // Since Bun.file().text() returns a Promise, we use readFileSync equivalent
          const content = require("fs").readFileSync(skillFile, "utf-8");
          const { meta, content: body } = parseFrontmatter(content);

          skills.push({
            name: (meta.name as string) || entry.name,
            description: (meta.description as string) || "",
            trigger: meta.trigger as string | undefined,
            content: body.trim(),
            filePath: skillFile,
          });
        } catch {
          // Skip unreadable skill files
        }
      }
    } catch {
      // Skip unreadable directories
    }
  }

  return skills;
}

/**
 * Find skills that match a trigger pattern against user input.
 */
export function matchSkills(skills: Skill[], input: string): Skill[] {
  return skills.filter((skill) => {
    if (!skill.trigger) return false;
    try {
      return new RegExp(skill.trigger, "i").test(input);
    } catch {
      return input.toLowerCase().includes(skill.trigger.toLowerCase());
    }
  });
}

/**
 * Format matched skills as system prompt injection.
 */
export function formatSkillsAsContext(skills: Skill[]): string {
  if (skills.length === 0) return "";

  const parts = skills.map(
    (s) => `## Skill: ${s.name}\n${s.description ? `> ${s.description}\n\n` : ""}${s.content}`,
  );

  return `\n\n# Active Skills\n\n${parts.join("\n\n---\n\n")}`;
}
