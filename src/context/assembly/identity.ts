/**
 * 身份类 (Identity)
 * 根据任务动态确定 agent 的身份角色
 */

export type AgentRole = "developer" | "advisor" | "executor" | "analyst" | "collaborator";

export interface IdentityConfig {
  /**
   * 当前角色 - 动态确定
   */
  role: AgentRole;

  /**
   * 角色描述 - 用于上下文注入
   */
  roleDescription: string;

  /**
   * 能力边界声明
   */
  capabilities: string[];

  /**
   * 约束说明
   */
  constraints: string[];
}

/**
 * 根据任务确定合适的角色
 */
export function resolveRole(task: string): AgentRole {
  const taskLower = task.toLowerCase();

  if (taskLower.includes("开发") || taskLower.includes("实现") || taskLower.includes("写代码")) {
    return "developer";
  }
  if (taskLower.includes("建议") || taskLower.includes("分析") || taskLower.includes("考虑")) {
    return "advisor";
  }
  if (taskLower.includes("执行") || taskLower.includes("运行") || taskLower.includes("操作")) {
    return "executor";
  }
  if (taskLower.includes("分析") || taskLower.includes("检查") || taskLower.includes("审查")) {
    return "analyst";
  }
  return "collaborator";
}

/**
 * 获取角色的默认描述
 */
export function getRoleDescription(role: AgentRole): string {
  const descriptions: Record<AgentRole, string> = {
    developer: "你是一个专业的软件开发工程师，专注于编写高质量的代码。",
    advisor: "你是一个经验丰富的技术顾问，提供专业建议和指导。",
    executor: "你是一个高效的执行者，准确完成指定的任务。",
    analyst: "你是一个细心的分析师，深入检查和评估问题。",
    collaborator: "你是一个协作型助手，与用户共同解决问题。",
  };
  return descriptions[role];
}

/**
 * 构建身份上下文片段
 */
export function buildIdentityContext(identity: IdentityConfig): string {
  return `
## 身份
- 角色: ${identity.role}
- 描述: ${identity.roleDescription}
- 能力: ${identity.capabilities.join(", ")}
- 约束: ${identity.constraints.join(", ")}
`;
}