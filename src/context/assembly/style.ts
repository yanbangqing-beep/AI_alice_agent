/**
 * 表达风格类 (Expression Style)
 * 定义 agent 的输出风格
 */

export type ToneStyle = "professional" | "casual" | "technical" | "friendly";
export type AdaptationMode = "fixed" | "task-adaptive" | "user-adaptive";

export interface ExpressionStyle {
  /**
   * 语气风格
   */
  tone: ToneStyle;

  /**
   * 适应模式
   */
  adaptationMode: AdaptationMode;

  /**
   * 是否使用代码高亮
   */
  codeHighlighting: boolean;

  /**
   * 是否使用 emoji
   */
  useEmoji: boolean;

  /**
   * 代码块语言标签
   */
  codeLanguage: string;
}

/**
 * 默认表达风格
 */
export const DEFAULT_EXPRESSION_STYLE: ExpressionStyle = {
  tone: "professional",
  adaptationMode: "fixed",
  codeHighlighting: true,
  useEmoji: false,
  codeLanguage: "typescript",
};

/**
 * 获取风格描述
 */
function getToneDescription(tone: ToneStyle): string {
  const descriptions: Record<ToneStyle, string> = {
    professional: "保持一致的专业语言风格",
    casual: "轻松友好的交流风格",
    technical: "技术导向，强调准确性和完整性",
    friendly: "亲切温和的表达方式",
  };
  return descriptions[tone];
}

/**
 * 构建表达风格上下文
 */
export function buildStyleContext(style: ExpressionStyle): string {
  return `
## 表达风格
- 语气: ${getToneDescription(style.tone)}
- 代码高亮: ${style.codeHighlighting ? "启用" : "禁用"}
- Emoji: ${style.useEmoji ? "使用" : "不使用"}
`;
}