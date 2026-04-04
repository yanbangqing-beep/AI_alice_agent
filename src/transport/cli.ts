import type { AgentEvent } from "../core/types.js";
import type { Transport } from "./types.js";
import { Renderer, type RendererOptions } from "../cli/renderer.js";
import { InputHandler } from "../cli/input.js";

/**
 * CLI Transport：包装终端 Renderer + InputHandler。
 * send() 委托给 renderer.handleEvent()，
 * onMessage() 启动 readline 输入循环。
 */
export class CliTransport implements Transport {
  private renderer: Renderer;
  private input: InputHandler;
  private messageHandler: ((message: string) => void) | null = null;
  private disconnectHandler: (() => void) | null = null;

  constructor(options: Partial<RendererOptions> = {}) {
    this.renderer = new Renderer(options);
    this.input = new InputHandler();
  }

  send(event: AgentEvent): void {
    this.renderer.handleEvent(event);
  }

  onMessage(handler: (message: string) => void): void {
    this.messageHandler = handler;
  }

  onDisconnect(handler: () => void): void {
    this.disconnectHandler = handler;
  }

  /**
   * 启动 REPL 输入循环。
   * 返回用户输入的字符串，null 表示 EOF/空行。
   */
  async prompt(): Promise<string | null> {
    return this.input.prompt();
  }

  close(): void {
    this.input.close();
    this.disconnectHandler?.();
  }
}
