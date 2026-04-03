/**
 * 工具使用类 (Tool Usage)
 * 定义 agent 的工具调用策略
 */

export type ToolPolicy = "passive" | "autonomous" | "adaptive";

export interface ToolUsageConfig {
  /**
   * 工具使用策略
   */
  policy: ToolPolicy;

  /**
   * 是否允许并行工具调用
   */
  allowParallel: boolean;

  /**
   * 最大并行数
   */
  maxParallelTools: number;

  /**
   * 工具选择超时 (ms)
   */
  toolSelectionTimeout: number;

  /**
   * 敏感工具列表 (需要确认)
   */
  sensitiveTools: string[];

  /**
   * 必需工具列表 (总是可用)
   */
  requiredTools: string[];
}

/**
 * 默认工具配置
 */
export const DEFAULT_TOOL_CONFIG: ToolUsageConfig = {
  policy: "autonomous",
  allowParallel: true,
  maxParallelTools: 5,
  toolSelectionTimeout: 3000,
  sensitiveTools: ["Bash", "Edit", "Write", "Delete"],
  requiredTools: ["Read", "Glob", "Grep"],
};

/**
 * 判断是否为敏感工具
 */
export function isSensitiveTool(toolName: string, config: ToolUsageConfig): boolean {
  return config.sensitiveTools.includes(toolName);
}

/**
 * 判断是否为必需工具
 */
export function isRequiredTool(toolName: string, config: ToolUsageConfig): boolean {
  return config.requiredTools.includes(toolName);
}

/**
 * 构建工具使用上下文
 */
export function buildToolContext(config: ToolUsageConfig): string {
  const policyDesc = {
    passive: "按需使用，用户指定才调用",
    autonomous: "自主判断并使用工具",
    adaptive: "根据任务类型自动选择工具",
  }[config.policy];

  return `
## 工具使用
- 策略: ${policyDesc}
- 并行: ${config.allowParallel ? `允许 (最大 ${config.maxParallelTools})` : "禁用"}
- 敏感工具: ${config.sensitiveTools.join(", ")}
- 必需工具: ${config.requiredTools.join(", ")}
`;
}