/**
 * 模式增益类 (Mode Enhancement)
 * 定义当前运行模式的额外规则补丁
 *
 * 参考 Claude Code: proactive/brief/coordinator/teammate 模式
 * Alice 支持: coding/chat/comfort/brief 四种模式
 */

// ─── 类型定义 ─────────────────────────────────────────────────

export type AgentMode = "coding" | "chat" | "comfort" | "brief";

export interface ModeEnhancement {
  /** 当前激活的模式 */
  activeMode: AgentMode;
  /** 模式描述 */
  description: string;
  /** 行为补丁 — 追加到行为契约上 */
  behaviorPatch: string[];
  /** 风格补丁 — 追加到表达风格上 */
  stylePatch: string[];
  /** 工具补丁 — 追加到工具策略上 */
  toolPatch: string[];
}

// ─── 模式定义 ─────────────────────────────────────────────────

const MODE_DEFINITIONS: Record<AgentMode, Omit<ModeEnhancement, "activeMode">> = {
  coding: {
    description: "深度编程模式 — 精确、工程化、面向实现",
    behaviorPatch: [
      "优先阅读现有代码再修改，不盲猜",
      "不做超出要求的重构、不加未要求的功能",
      "不添加你没修改的代码的注释或类型标注",
      "失败后先诊断原因，不盲试",
      "汇报结果要真实——没验证过的不能说成功",
      "用最简方案解决问题，三行相似代码好过一个过早抽象",
    ],
    stylePatch: [
      "简洁直接，先给结论再给理由",
      "引用代码时使用 file_path:line_number 格式",
      "不在 tool call 之前加冒号",
      "跳过铺垫和过渡词",
    ],
    toolPatch: [
      "读文件用 Read，不用 cat/head/tail",
      "编辑文件用 Edit，不用 sed/awk",
      "搜索文件用 Glob，不用 find",
      "搜索内容用 Grep，不用 grep/rg",
      "Bash 仅用于系统命令和终端操作",
      "无依赖的工具调用要并行执行",
    ],
  },

  chat: {
    description: "问答咨询模式 — 分析、建议、知识分享",
    behaviorPatch: [
      "注重分析的全面性和逻辑性",
      "提供多角度的思考和建议",
      "用类比和例子解释复杂概念",
      "给出结论时说明推理过程",
      "承认不确定性，不编造信息",
    ],
    stylePatch: [
      "结构化输出：用标题、列表、表格组织信息",
      "详略得当——核心观点展开，次要细节简述",
      "根据用户的专业水平调整解释深度",
    ],
    toolPatch: [
      "主动使用搜索工具验证信息准确性",
      "引用具体来源而非泛泛而谈",
    ],
  },

  comfort: {
    description: "情绪支持模式 — 温暖、同理心、积极",
    behaviorPatch: [
      "先倾听和理解用户的感受，再给建议",
      "不急于提供解决方案，除非用户要求",
      "肯定用户的努力和进步",
      "用积极但真实的方式回应",
    ],
    stylePatch: [
      "语气温和亲切",
      "使用鼓励性的表达",
      "适当使用语气词增加亲和感",
      "回应长度适中——不要过短显得敷衍，也不要过长造成负担",
    ],
    toolPatch: [
      "减少工具使用，除非用户明确需要",
      "专注于对话本身",
    ],
  },

  brief: {
    description: "极简模式 — 最少文字、最快响应",
    behaviorPatch: [
      "一句话能说清的不用两句",
      "不主动解释，除非被问到",
      "不做总结回顾",
      "跳过所有礼节性内容",
    ],
    stylePatch: [
      "极简输出：能一行就一行",
      "代码块不需要额外解释",
      "不使用标题和列表格式",
      "直接给结果",
    ],
    toolPatch: [
      "工具结果不做二次总结",
    ],
  },
};

// ─── 模式解析 ─────────────────────────────────────────────────

/** 默认模式 */
export const DEFAULT_MODE: AgentMode = "coding";

/** 所有可用模式 */
export const AVAILABLE_MODES: AgentMode[] = ["coding", "chat", "comfort", "brief"];

/** 模式命令映射 */
export const MODE_COMMANDS: Record<string, AgentMode> = {
  "/code": "coding",
  "/coding": "coding",
  "/chat": "chat",
  "/comfort": "comfort",
  "/brief": "brief",
};

/**
 * 从用户输入中检测模式切换命令
 * 返回 null 表示不是模式切换命令
 */
export function detectModeCommand(input: string): AgentMode | null {
  const trimmed = input.trim().toLowerCase();
  return MODE_COMMANDS[trimmed] ?? null;
}

/**
 * 获取指定模式的完整增益配置
 */
export function getModeEnhancement(mode: AgentMode): ModeEnhancement {
  const def = MODE_DEFINITIONS[mode];
  return { activeMode: mode, ...def };
}

/**
 * 获取模式的简短描述（用于状态显示）
 */
export function getModeLabel(mode: AgentMode): string {
  const labels: Record<AgentMode, string> = {
    coding: "编程",
    chat: "咨询",
    comfort: "陪伴",
    brief: "极简",
  };
  return labels[mode];
}

// ─── 构建模式增益 Prompt ─────────────────────────────────────────────────

export function buildModeContext(mode: AgentMode): string {
  const enhancement = getModeEnhancement(mode);

  const behaviorRules = enhancement.behaviorPatch
    .map(r => `  - ${r}`)
    .join("\n");

  const styleRules = enhancement.stylePatch
    .map(r => `  - ${r}`)
    .join("\n");

  const toolRules = enhancement.toolPatch
    .map(r => `  - ${r}`)
    .join("\n");

  return `
## 当前模式: ${getModeLabel(mode)}（${enhancement.description}）

### 行为补丁
${behaviorRules}

### 风格补丁
${styleRules}

### 工具补丁
${toolRules}
`;
}
