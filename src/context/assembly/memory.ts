/**
 * 记忆与持久化类 (Memory & Persistence)
 * 定义 agent 的长期记忆机制：什么该记、怎么记、怎么检索
 *
 * 参考 Claude Code memdir 机制:
 * - 文件化记忆，写入文件系统
 * - MEMORY.md 索引
 * - 分类型记忆 (user/feedback/project/reference)
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join, basename } from "path";

// ─── 类型定义 ─────────────────────────────────────────────────

export type MemoryType = "user" | "feedback" | "project" | "reference";

export interface MemoryEntry {
  /** 记忆名称 */
  name: string;
  /** 一行描述（用于检索时判断相关性） */
  description: string;
  /** 记忆类型 */
  type: MemoryType;
  /** 记忆内容 */
  content: string;
  /** 文件名 */
  filename: string;
}

export interface MemoryConfig {
  /** 记忆目录路径 */
  memoryDir: string;
  /** 索引文件路径 */
  indexFile: string;
  /** 启用的记忆类型 */
  enabledTypes: MemoryType[];
  /** 索引最大行数 */
  maxIndexLines: number;
  /** 是否自动保存 */
  autoSave: boolean;
}

// ─── 记忆类型描述 ─────────────────────────────────────────────────

const MEMORY_TYPE_DESCRIPTIONS: Record<MemoryType, { what: string; when: string }> = {
  user: {
    what: "用户的角色、目标、偏好、知识水平",
    when: "了解到用户的任何个人信息或工作风格时",
  },
  feedback: {
    what: "用户对工作方式的指导——纠正和确认",
    when: "用户纠正做法或确认某个非显而易见的方法有效时",
  },
  project: {
    what: "项目的进行中工作、目标、约束、截止日期",
    when: "了解到谁在做什么、为什么做、什么时候到期时",
  },
  reference: {
    what: "外部系统中信息的位置指针",
    when: "了解到外部资源及其用途时",
  },
};

// ─── 不应保存的内容 ─────────────────────────────────────────────────

const MEMORY_EXCLUSIONS = [
  "代码模式、架构、文件路径——这些可以从代码中读取",
  "Git 历史——用 git log/git blame 查询",
  "调试方案——修复在代码中，上下文在 commit message 里",
  "CLAUDE.md/ALICE.md 中已有的内容",
  "临时任务细节——仅当前会话有用的信息",
];

// ─── 默认配置 ─────────────────────────────────────────────────

export function createMemoryConfig(projectRoot: string): MemoryConfig {
  const memoryDir = join(projectRoot, ".alice", "memory");
  return {
    memoryDir,
    indexFile: join(memoryDir, "MEMORY.md"),
    enabledTypes: ["user", "feedback", "project", "reference"],
    maxIndexLines: 200,
    autoSave: true,
  };
}

// ─── 记忆管理器 ─────────────────────────────────────────────────

export class MemoryManager {
  private config: MemoryConfig;
  private entries: MemoryEntry[] = [];

  constructor(config: MemoryConfig) {
    this.config = config;
  }

  /** 确保记忆目录存在 */
  ensureDir(): void {
    if (!existsSync(this.config.memoryDir)) {
      mkdirSync(this.config.memoryDir, { recursive: true });
    }
  }

  /** 加载所有记忆条目 */
  loadAll(): MemoryEntry[] {
    if (!existsSync(this.config.memoryDir)) return [];

    this.entries = [];
    const files = readdirSync(this.config.memoryDir).filter(f => f.endsWith(".md") && f !== "MEMORY.md");

    for (const file of files) {
      const entry = this.parseMemoryFile(join(this.config.memoryDir, file));
      if (entry) this.entries.push(entry);
    }

    return this.entries;
  }

  /** 保存一条记忆 */
  save(entry: Omit<MemoryEntry, "filename">): void {
    this.ensureDir();
    const filename = `${entry.type}_${entry.name.replace(/\s+/g, "_").toLowerCase()}.md`;
    const filePath = join(this.config.memoryDir, filename);

    const content = `---
name: ${entry.name}
description: ${entry.description}
type: ${entry.type}
---

${entry.content}
`;

    writeFileSync(filePath, content, "utf-8");
    this.updateIndex();
  }

  /** 按类型搜索记忆 */
  findByType(type: MemoryType): MemoryEntry[] {
    return this.entries.filter(e => e.type === type);
  }

  /** 按关键词搜索记忆 */
  search(query: string): MemoryEntry[] {
    const queryLower = query.toLowerCase();
    return this.entries.filter(
      e =>
        e.name.toLowerCase().includes(queryLower) ||
        e.description.toLowerCase().includes(queryLower) ||
        e.content.toLowerCase().includes(queryLower),
    );
  }

  /** 获取索引内容 */
  getIndex(): string {
    if (!existsSync(this.config.indexFile)) return "";
    return readFileSync(this.config.indexFile, "utf-8");
  }

  /** 更新 MEMORY.md 索引 */
  private updateIndex(): void {
    const entries = this.loadAll();
    const lines = entries.map(
      e => `- [${e.name}](${e.filename}) — ${e.description}`,
    );

    // 截断到最大行数
    const truncated = lines.slice(0, this.config.maxIndexLines);
    writeFileSync(this.config.indexFile, truncated.join("\n") + "\n", "utf-8");
  }

  /** 解析记忆文件的 frontmatter */
  private parseMemoryFile(filePath: string): MemoryEntry | null {
    try {
      const raw = readFileSync(filePath, "utf-8");
      const frontmatterMatch = raw.match(/^---\n([\s\S]*?)\n---\n\n?([\s\S]*)$/);
      if (!frontmatterMatch) return null;

      const meta: Record<string, string> = {};
      for (const line of frontmatterMatch[1]!.split("\n")) {
        const [key, ...valueParts] = line.split(": ");
        if (key) meta[key.trim()] = valueParts.join(": ").trim();
      }

      return {
        name: meta.name || basename(filePath, ".md"),
        description: meta.description || "",
        type: (meta.type as MemoryType) || "project",
        content: frontmatterMatch[2]!.trim(),
        filename: basename(filePath),
      };
    } catch {
      return null;
    }
  }
}

// ─── 构建记忆指导 Prompt ─────────────────────────────────────────────────

export function buildMemoryContext(config: MemoryConfig): string {
  const typeGuide = config.enabledTypes
    .map(t => {
      const desc = MEMORY_TYPE_DESCRIPTIONS[t];
      return `  - ${t}: ${desc.what}（${desc.when}）`;
    })
    .join("\n");

  const exclusions = MEMORY_EXCLUSIONS.map(e => `  - ${e}`).join("\n");

  // 尝试加载现有索引
  let indexContent = "";
  if (existsSync(config.indexFile)) {
    try {
      indexContent = readFileSync(config.indexFile, "utf-8").trim();
    } catch { /* ignore */ }
  }

  const indexSection = indexContent
    ? `\n### 已有记忆\n${indexContent}`
    : "\n### 已有记忆\n暂无记忆条目。";

  return `
## 记忆与持久化

你有一个文件化的记忆系统，位于 \`${config.memoryDir}/\`。

### 记忆类型
${typeGuide}

### 保存规则
- 保存记忆是两步操作：先写入独立文件（带 frontmatter），再更新 MEMORY.md 索引
- 索引每行不超过 150 字符，最多 ${config.maxIndexLines} 行
- 按主题组织，不要按时间排列
- 更新或删除过时的记忆
- 先检查是否已有相关记忆，避免重复

### 不应保存的内容
${exclusions}

### 何时访问记忆
- 当记忆可能相关时主动查阅
- 用户明确要求回忆或检查时必须查阅
- 记忆可能过时——在据此行动前先验证当前状态
${indexSection}
`;
}
