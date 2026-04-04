import type { AgentEvent } from "../core/types.js";

// ─── Transport Interface ────────────────────────────────────────

/**
 * Transport 抽象层：Agent 通过此接口与不同客户端通信。
 * CLI、HTTP/SSE、WebSocket 各自实现此接口。
 */
export interface Transport {
  /** 发送 AgentEvent 给客户端 */
  send(event: AgentEvent): void;
  /** 注册消息接收回调 (用户输入) */
  onMessage(handler: (message: string) => void): void;
  /** 注册断开连接回调 */
  onDisconnect(handler: () => void): void;
  /** 关闭传输层 */
  close(): void;
}

// ─── Client Message Types (WebSocket) ───────────────────────────

export type ClientMessage =
  | { type: "chat"; message: string }
  | { type: "abort" }
  | { type: "mode"; mode: string }
  | { type: "session" }
  | { type: "clear" };
