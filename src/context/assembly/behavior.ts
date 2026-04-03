/**
 * 行为契约类 (Behavior Contract)
 * 定义 agent 的核心行为模式和决策风格
 */

export type ResponseStyle = "concise" | "verbose" | "adaptive";
export type DecisionMode = "autonomous" | "guided" | "confirm-first";

export interface BehaviorContract {
  /**
   * 响应风格
   */
  responseStyle: ResponseStyle;

  /**
   * 决策模式
   */
  decisionMode: DecisionMode;

  /**
   * 是否主动提供建议
   */
  proactiveSuggestions: boolean;

  /**
   * 解释阈值 - 超过多少字符才解释
   */
  explanationThreshold: number;

  /**
   * 最大连续工具调用次数
   */
  maxToolChainLength: number;
}

/**
 * 默认行为契约
 */
export const DEFAULT_BEHAVIOR_CONTRACT: BehaviorContract = {
  responseStyle: "concise",
  decisionMode: "autonomous",
  proactiveSuggestions: false,
  explanationThreshold: 500,
  maxToolChainLength: 10,
};

/**
 * 构建行为契约上下文
 */
export function buildBehaviorContext(contract: BehaviorContract): string {
  const styleDesc = {
    concise: "简洁直接，不主动解释",
    verbose: "详细说明，完整解释",
    adaptive: "根据任务自适应",
  }[contract.responseStyle];

  const modeDesc = {
    autonomous: "自主决策工具使用",
    guided: "按用户指令执行",
    "confirm-first": "关键操作前确认",
  }[contract.decisionMode];

  return `
## 行为约定
- 风格: ${styleDesc}
- 模式: ${modeDesc}
- 主动建议: ${contract.proactiveSuggestions ? "是" : "否"}
- 解释阈值: ${contract.explanationThreshold} 字符
`;
}