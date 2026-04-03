/**
 * 风险治理类 (Risk Governance)
 * 定义风险分级和确认策略 (参考 Claude Code 权限系统)
 */

export type RiskLevel = "low" | "medium" | "high" | "critical";
export type ConfirmationStrategy = "none" | "分级确认" | "always";

export interface RiskRule {
  /**
   * 规则名称
   */
  name: string;

  /**
   * 风险等级
   */
  level: RiskLevel;

  /**
   * 匹配模式 (正则或关键词)
   */
  pattern: string;

  /**
   * 需要确认
   */
  requireConfirmation: boolean;

  /**
   * 描述
   */
  description: string;
}

export interface RiskGovernance {
  /**
   * 确认策略
   */
  strategy: ConfirmationStrategy;

  /**
   * 默认风险等级
   */
  defaultLevel: RiskLevel;

  /**
   * 风险规则
   */
  rules: RiskRule[];

  /**
   * 超时时间 (ms)
   */
  confirmationTimeout: number;
}

/**
 * 默认风险治理配置 (参考 Claude Code 权限系统设计)
 */
export const DEFAULT_RISK_GOVERNANCE: RiskGovernance = {
  strategy: "分级确认",
  defaultLevel: "low",
  confirmationTimeout: 30000,
  rules: [
    {
      name: "文件系统删除",
      level: "high",
      pattern: "rm|r(del|emove)|unlink",
      requireConfirmation: true,
      description: "删除文件或目录",
    },
    {
      name: "系统命令执行",
      level: "high",
      pattern: "sudo|chmod|chown|kill",
      requireConfirmation: true,
      description: "执行系统权限命令",
    },
    {
      name: "网络请求",
      level: "medium",
      pattern: "curl|wget|fetch|fetch\\(",
      requireConfirmation: false,
      description: "发起网络请求",
    },
    {
      name: "环境变量修改",
      level: "medium",
      pattern: "export|env|setenv",
      requireConfirmation: true,
      description: "修改环境变量",
    },
    {
      name: "代码执行",
      level: "critical",
      pattern: "eval|exec|compile",
      requireConfirmation: true,
      description: "执行动态代码",
    },
  ],
};

/**
 * 评估操作风险等级
 */
export function assessRisk(operation: string, governance: RiskGovernance): RiskLevel {
  const operationLower = operation.toLowerCase();

  for (const rule of governance.rules) {
    try {
      const regex = new RegExp(rule.pattern, "i");
      if (regex.test(operation)) {
        return rule.level;
      }
    } catch {
      // 如果正则无效，尝试简单匹配
      if (operationLower.includes(rule.pattern.toLowerCase())) {
        return rule.level;
      }
    }
  }

  return governance.defaultLevel;
}

/**
 * 判断是否需要确认
 */
export function requiresConfirmation(operation: string, governance: RiskGovernance): boolean {
  const level = assessRisk(operation, governance);

  if (governance.strategy === "always") return true;
  if (governance.strategy === "none") return false;

  // 分级确认策略
  return level === "high" || level === "critical";
}

/**
 * 构建风险治理上下文
 */
export function buildRiskContext(governance: RiskGovernance): string {
  const strategyDesc = {
    none: "无需确认",
    分级确认: "高风险操作确认，低风险自动执行",
    always: "所有操作都需确认",
  }[governance.strategy];

  const highRiskRules = governance.rules
    .filter((r) => r.level === "high" || r.level === "critical")
    .map((r) => r.name)
    .join(", ");

  return `
## 风险治理
- 策略: ${strategyDesc}
- 高风险操作: ${highRiskRules || "无"}
`;
}