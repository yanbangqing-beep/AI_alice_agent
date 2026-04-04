import type { AgentEvent } from "../core/types.js";
import type { Transport, ClientMessage } from "./types.js";

/**
 * WebSocket Transport：双向实时通信。
 * 客户端发送 ClientMessage JSON，服务端推送 AgentEvent JSON。
 */
export class WsTransport implements Transport {
  private ws: any; // Bun ServerWebSocket
  private messageHandler: ((message: string) => void) | null = null;
  private disconnectHandler: (() => void) | null = null;
  private closed = false;

  constructor(ws: any) {
    this.ws = ws;
  }

  send(event: AgentEvent): void {
    if (this.closed) return;
    try {
      this.ws.send(JSON.stringify(event));
    } catch {
      // WebSocket may be closed
    }
  }

  onMessage(handler: (message: string) => void): void {
    this.messageHandler = handler;
  }

  onDisconnect(handler: () => void): void {
    this.disconnectHandler = handler;
  }

  /**
   * 处理从 WebSocket 收到的原始消息。
   * 由 server 的 websocket.message 回调调用。
   * 返回解析后的 ClientMessage，调用方根据类型分发。
   */
  handleRawMessage(raw: string | Buffer): ClientMessage | null {
    try {
      const text = typeof raw === "string" ? raw : raw.toString();
      const msg = JSON.parse(text) as ClientMessage;

      if (msg.type === "chat" && msg.message) {
        this.messageHandler?.(msg.message);
      }

      return msg;
    } catch {
      return null;
    }
  }

  /** WebSocket 断开时由 server 调用 */
  handleClose(): void {
    this.closed = true;
    this.disconnectHandler?.();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.ws.close();
    } catch {
      // Already closed
    }
    this.disconnectHandler?.();
  }
}
