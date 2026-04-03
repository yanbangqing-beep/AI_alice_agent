/**
 * 会话环境类 (Session Environment)
 * 管理项目级状态和会话记忆
 */

import type { Message } from "../../core/types.js";

export type MemoryScope = "none" | "session" | "project";

export interface SessionEnvironment {
  /**
   * 记忆范围
   */
  scope: MemoryScope;

  /**
   * 项目标识
   */
  projectId: string;

  /**
   * 项目根目录
   */
  projectRoot: string;

  /**
   * 会话 ID
   */
  sessionId: string;

  /**
   * 是否启用 session memory (参考 Claude Code)
   */
  enableSessionMemory: boolean;

  /**
   * Session memory 路径
   */
  sessionMemoryPath?: string;
}

/**
 * 创建项目级会话环境
 */
export function createProjectEnvironment(
  projectRoot: string,
  projectId?: string,
): SessionEnvironment {
  return {
    scope: "project",
    projectId: projectId || crypto.randomUUID(),
    projectRoot,
    sessionId: crypto.randomUUID(),
    enableSessionMemory: true,
    sessionMemoryPath: `${projectRoot}/.alice/session-memory.md`,
  };
}

/**
 * 构建会话环境上下文
 */
export function buildEnvironmentContext(env: SessionEnvironment): string {
  const scopeDesc = {
    none: "无状态",
    session: "会话级记忆",
    project: "项目级记忆",
  }[env.scope];

  return `
## 会话环境
- 范围: ${scopeDesc}
- 项目: ${env.projectId}
- 会话: ${env.sessionId}
- 项目根: ${env.projectRoot}
- Session Memory: ${env.enableSessionMemory ? "启用" : "禁用"}
`;
}

/**
 * 项目级 session memory 管理器 (参考 Claude Code SessionMemory)
 */
export class ProjectSessionMemory {
  private memoryPath: string;
  private initialized: boolean = false;

  constructor(projectRoot: string) {
    this.memoryPath = `${projectRoot}/.alice/session-memory.md`;
  }

  /**
   * 初始化 session memory
   */
  async initialize(): Promise<void> {
    // 参考 Claude Code SessionMemory 实现
    // 使用 forked subagent 在后台定期提取关键信息
    this.initialized = true;
  }

  /**
   * 获取当前 memory 内容
   */
  async getMemory(): Promise<string> {
    try {
      const content = await Bun.file(this.memoryPath).text();
      return content;
    } catch {
      return "";
    }
  }

  /**
   * 更新 memory
   */
  async update(messages: Message[]): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
    // 实现 memory 更新逻辑
    // 参考 Claude Code: 使用 LLM 提取关键信息并写入 memory
  }

  /**
   * 检查是否需要更新
   */
  shouldUpdate(messageCount: number, threshold: number = 20): boolean {
    return messageCount >= threshold;
  }
}