/**
 * 上下文组装器 (Context Assembly)
 * 整合 8 大约束面，对应文章的完整分类体系：
 *
 * ┌─ 你是谁 ─────────── 1. 身份类 (identity)
 * │
 * ├─ 你怎么做事 ─────── 2. 行为契约类 (behavior)
 * │                     3. 工具使用类 (tools)
 * │                     4. 风险治理类 (risk)
 * │
 * ├─ 你处在什么环境 ─── 5. 会话环境类 (environment)
 * │                     6. 记忆与持久化类 (memory)
 * │
 * └─ 你以什么模式工作 ─ 7. 表达风格类 (style)
 *                       8. 模式增益类 (mode)
 *
 * 缓存分区设计 (参考 Claude Code):
 * ┌──────────────────────────────────┐
 * │  静态区 (Static Zone)            │  ← prompt cache 命中
 * │  身份 / 行为 / 工具 / 风险 / 风格  │
 * ├──────────── BOUNDARY ────────────┤
 * │  动态区 (Dynamic Zone)           │  ← 每轮可变
 * │  环境 / 记忆 / 模式增益           │
 * └──────────────────────────────────┘
 */

export * from "./identity.js";
export * from "./behavior.js";
export * from "./environment.js";
export * from "./tools.js";
export * from "./risk.js";
export * from "./style.js";
export * from "./memory.js";
export * from "./mode.js";

import type { IdentityConfig } from "./identity.js";
import type { BehaviorContract } from "./behavior.js";
import type { SessionEnvironment } from "./environment.js";
import type { ToolUsageConfig } from "./tools.js";
import type { RiskGovernance } from "./risk.js";
import type { ExpressionStyle } from "./style.js";
import type { MemoryConfig } from "./memory.js";
import type { AgentMode } from "./mode.js";

import {
  resolveRole,
  getRoleDescription,
  buildIdentityContext,
  type AgentRole,
} from "./identity.js";

import {
  DEFAULT_BEHAVIOR_CONTRACT,
  buildBehaviorContext,
  type ResponseStyle,
  type DecisionMode,
} from "./behavior.js";

import {
  createProjectEnvironment,
  buildEnvironmentContext,
  ProjectSessionMemory,
  type MemoryScope,
} from "./environment.js";

import {
  DEFAULT_TOOL_CONFIG,
  buildToolContext,
  isSensitiveTool,
  isRequiredTool,
  type ToolPolicy,
} from "./tools.js";

import {
  DEFAULT_RISK_GOVERNANCE,
  buildRiskContext,
  assessRisk,
  requiresConfirmation,
  type RiskLevel,
  type ConfirmationStrategy,
  type RiskRule,
} from "./risk.js";

import {
  DEFAULT_EXPRESSION_STYLE,
  buildStyleContext,
  type ToneStyle,
  type AdaptationMode,
} from "./style.js";

import {
  createMemoryConfig,
  buildMemoryContext,
  MemoryManager,
  type MemoryType,
  type MemoryEntry,
} from "./memory.js";

import {
  DEFAULT_MODE,
  getModeEnhancement,
  getModeLabel,
  detectModeCommand,
  buildModeContext,
  AVAILABLE_MODES,
  MODE_COMMANDS,
  type ModeEnhancement,
} from "./mode.js";

// ─── 缓存分区标记 ─────────────────────────────────────────────────

/**
 * 分隔静态区和动态区的边界标记
 * 静态区内容可以利用 prompt cache（跨轮次不变）
 * 动态区内容每轮可能变化（环境、记忆、模式）
 */
const CACHE_BOUNDARY = "\n<!-- __CONTEXT_CACHE_BOUNDARY__ -->\n";

export type CacheZone = "static" | "dynamic";

export interface ContextSection {
  /** 所属约束面 */
  dimension: string;
  /** 缓存分区 */
  zone: CacheZone;
  /** prompt 内容 */
  content: string;
}

// ─── 完整上下文配置 ─────────────────────────────────────────────────

export interface AgentContextConfig {
  /** 1. 身份配置 */
  identity: IdentityConfig;
  /** 2. 行为契约 */
  behavior: BehaviorContract;
  /** 3. 工具配置 */
  tools: ToolUsageConfig;
  /** 4. 风险治理 */
  risk: RiskGovernance;
  /** 5. 会话环境 */
  environment: SessionEnvironment;
  /** 6. 记忆配置 */
  memory: MemoryConfig;
  /** 7. 表达风格 */
  style: ExpressionStyle;
  /** 8. 当前模式 */
  mode: AgentMode;
}

// ─── 上下文组装器 ─────────────────────────────────────────────────

export class ContextAssembly {
  private config: AgentContextConfig;
  private sessionMemory?: ProjectSessionMemory;
  private memoryManager: MemoryManager;

  /** 静态区缓存（身份/行为/工具/风险/风格 — 会话内不变） */
  private staticCache: string | null = null;

  constructor(projectRoot: string, initialTask?: string, mode?: AgentMode) {
    // 1. 身份 — 根据任务动态确定
    const role = initialTask ? resolveRole(initialTask) : "collaborator";
    const identity: IdentityConfig = {
      role,
      roleDescription: getRoleDescription(role),
      capabilities: ["代码开发", "问题分析", "工具使用", "方案设计", "情感支持"],
      constraints: ["不主动执行未确认的操作", "不修改用户未指定的文件"],
    };

    // 2. 行为契约
    const behavior = DEFAULT_BEHAVIOR_CONTRACT;

    // 3. 工具配置
    const tools = DEFAULT_TOOL_CONFIG;

    // 4. 风险治理
    const risk = DEFAULT_RISK_GOVERNANCE;

    // 5. 会话环境
    const environment = createProjectEnvironment(projectRoot);
    this.sessionMemory = new ProjectSessionMemory(projectRoot);

    // 6. 记忆配置
    const memory = createMemoryConfig(projectRoot);
    this.memoryManager = new MemoryManager(memory);

    // 7. 表达风格
    const style = DEFAULT_EXPRESSION_STYLE;

    // 8. 当前模式
    const activeMode = mode ?? DEFAULT_MODE;

    this.config = {
      identity,
      behavior,
      tools,
      risk,
      environment,
      memory,
      style,
      mode: activeMode,
    };
  }

  // ─── 核心组装 ───────────────────────────────────────────────

  /**
   * 构建完整上下文（带缓存分区）
   * 返回所有 8 个约束面的 prompt，以 BOUNDARY 分隔静态/动态区
   */
  buildContext(): string {
    const staticZone = this.buildStaticZone();
    const dynamicZone = this.buildDynamicZone();

    return staticZone + CACHE_BOUNDARY + dynamicZone;
  }

  /**
   * 构建分区上下文（返回结构化数据，供 provider 层利用 cache control）
   */
  buildSections(): ContextSection[] {
    return [
      // ── 静态区 ──
      { dimension: "identity", zone: "static", content: buildIdentityContext(this.config.identity) },
      { dimension: "behavior", zone: "static", content: buildBehaviorContext(this.config.behavior) },
      { dimension: "tools", zone: "static", content: buildToolContext(this.config.tools) },
      { dimension: "risk", zone: "static", content: buildRiskContext(this.config.risk) },
      { dimension: "style", zone: "static", content: buildStyleContext(this.config.style) },
      // ── 动态区 ──
      { dimension: "environment", zone: "dynamic", content: buildEnvironmentContext(this.config.environment) },
      { dimension: "memory", zone: "dynamic", content: buildMemoryContext(this.config.memory) },
      { dimension: "mode", zone: "dynamic", content: buildModeContext(this.config.mode) },
    ];
  }

  /**
   * 获取系统提示词（注入到 LLM）
   */
  getSystemPrompt(basePrompt: string): string {
    const context = this.buildContext();
    return `${basePrompt}\n\n${context}`;
  }

  /**
   * 获取分区系统提示词（支持 prompt cache）
   * 返回 [staticPart, dynamicPart]，provider 层可对 staticPart 设置 cache_control
   */
  getSystemPromptParts(basePrompt: string): [string, string] {
    const staticZone = `${basePrompt}\n\n${this.buildStaticZone()}`;
    const dynamicZone = this.buildDynamicZone();
    return [staticZone, dynamicZone];
  }

  // ─── 分区构建 ───────────────────────────────────────────────

  /**
   * 静态区：身份 + 行为 + 工具 + 风险 + 风格
   * 会话内不变，可缓存
   */
  private buildStaticZone(): string {
    if (this.staticCache) return this.staticCache;

    const parts = [
      buildIdentityContext(this.config.identity),
      buildBehaviorContext(this.config.behavior),
      buildToolContext(this.config.tools),
      buildRiskContext(this.config.risk),
      buildStyleContext(this.config.style),
    ];

    this.staticCache = parts.join("\n");
    return this.staticCache;
  }

  /**
   * 动态区：环境 + 记忆 + 模式增益
   * 每轮可变，不缓存
   */
  private buildDynamicZone(): string {
    return [
      buildEnvironmentContext(this.config.environment),
      buildMemoryContext(this.config.memory),
      buildModeContext(this.config.mode),
    ].join("\n");
  }

  // ─── 状态更新 ───────────────────────────────────────────────

  /** 更新身份（清除静态缓存） */
  updateIdentity(role: AgentRole): void {
    this.config.identity = {
      ...this.config.identity,
      role,
      roleDescription: getRoleDescription(role),
    };
    this.invalidateStaticCache();
  }

  /** 更新行为配置（清除静态缓存） */
  updateBehavior(updates: Partial<BehaviorContract>): void {
    this.config.behavior = { ...this.config.behavior, ...updates };
    this.invalidateStaticCache();
  }

  /** 切换模式（不影响静态缓存） */
  switchMode(mode: AgentMode): void {
    this.config.mode = mode;
    // 动态区，无需清除静态缓存
  }

  /** 处理用户输入中的模式切换命令，返回是否发生了切换 */
  handleModeCommand(input: string): boolean {
    const newMode = detectModeCommand(input);
    if (newMode && newMode !== this.config.mode) {
      this.switchMode(newMode);
      return true;
    }
    return false;
  }

  /** 清除静态缓存（配置变更时调用） */
  private invalidateStaticCache(): void {
    this.staticCache = null;
  }

  /** 完全清除所有缓存（/clear 或 /compact 时调用） */
  clearAllCaches(): void {
    this.staticCache = null;
  }

  // ─── 查询接口 ───────────────────────────────────────────────

  /** 评估操作风险 */
  checkRisk(operation: string): RiskLevel {
    return assessRisk(operation, this.config.risk);
  }

  /** 检查是否需要确认 */
  needConfirmation(operation: string): boolean {
    return requiresConfirmation(operation, this.config.risk);
  }

  /** 检查是否为敏感工具 */
  checkToolSensitivity(toolName: string): boolean {
    return isSensitiveTool(toolName, this.config.tools);
  }

  /** 获取当前模式 */
  getMode(): AgentMode {
    return this.config.mode;
  }

  /** 获取模式标签 */
  getModeLabel(): string {
    return getModeLabel(this.config.mode);
  }

  /** 获取当前配置 */
  getConfig(): AgentContextConfig {
    return this.config;
  }

  /** 获取 session memory 实例 */
  getSessionMemory(): ProjectSessionMemory | undefined {
    return this.sessionMemory;
  }

  /** 获取记忆管理器 */
  getMemoryManager(): MemoryManager {
    return this.memoryManager;
  }
}

// ─── 便捷工厂函数 ─────────────────────────────────────────────────

/**
 * 创建默认上下文组装器
 */
export function createContextAssembly(
  projectRoot: string,
  task?: string,
  mode?: AgentMode,
): ContextAssembly {
  return new ContextAssembly(projectRoot, task, mode);
}

/**
 * 快速构建上下文片段（用于一次性任务）
 */
export function buildQuickContext(
  projectRoot: string,
  options?: Partial<AgentContextConfig>,
): string {
  const assembly = new ContextAssembly(projectRoot);

  if (options?.identity) {
    assembly.updateIdentity(options.identity.role);
  }
  if (options?.behavior) {
    assembly.updateBehavior(options.behavior);
  }
  if (options?.mode) {
    assembly.switchMode(options.mode);
  }

  return assembly.buildContext();
}

// ─── 类型导出 ─────────────────────────────────────────────────

export type {
  AgentRole,
  IdentityConfig,
  ResponseStyle,
  DecisionMode,
  BehaviorContract,
  MemoryScope,
  SessionEnvironment,
  ToolPolicy,
  ToolUsageConfig,
  RiskLevel,
  ConfirmationStrategy,
  RiskGovernance,
  RiskRule,
  ToneStyle,
  AdaptationMode,
  ExpressionStyle,
  MemoryType,
  MemoryEntry,
  MemoryConfig,
  AgentMode,
  ModeEnhancement,
};
