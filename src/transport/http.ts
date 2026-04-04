import type { AgentEvent } from "../core/types.js";
import type { Transport } from "./types.js";

/**
 * HTTP/SSE Transport：每次 POST /api/chat 创建一个实例，
 * Agent 事件通过 SSE 流式推送给客户端。
 * 请求结束后 SSE 流自动关闭。
 */
export class HttpTransport implements Transport {
  private controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  private encoder = new TextEncoder();
  private closed = false;
  private disconnectHandler: (() => void) | null = null;

  /** 创建 SSE ReadableStream，用于 Response 构造 */
  createStream(): ReadableStream<Uint8Array> {
    return new ReadableStream({
      start: (controller) => {
        this.controller = controller;
      },
      cancel: () => {
        this.closed = true;
        this.disconnectHandler?.();
      },
    });
  }

  send(event: AgentEvent): void {
    if (this.closed || !this.controller) return;
    try {
      const data = JSON.stringify(event);
      this.controller.enqueue(
        this.encoder.encode(`event: ${event.type}\ndata: ${data}\n\n`),
      );
    } catch {
      // Controller may be closed
    }
  }

  /** SSE 模式下不需要 onMessage，消息通过 HTTP POST body 传入 */
  onMessage(_handler: (message: string) => void): void {
    // no-op for SSE — messages come via HTTP POST
  }

  onDisconnect(handler: () => void): void {
    this.disconnectHandler = handler;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      // 发送 done 事件通知客户端流结束
      this.controller?.enqueue(
        this.encoder.encode(`event: done\ndata: {}\n\n`),
      );
      this.controller?.close();
    } catch {
      // Already closed
    }
    this.disconnectHandler?.();
  }
}
