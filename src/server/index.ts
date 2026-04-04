import type { AliceConfig } from "../core/types.js";
import { AnthropicProvider } from "../core/provider.js";
import { Agent } from "../core/agent.js";
import { ToolRegistry } from "../tools/registry.js";
import { getBuiltinTools } from "../tools/builtin/index.js";
import { ContextAssembly, type AgentMode, getModeLabel, AVAILABLE_MODES } from "../context/assembly/index.js";
import { HttpTransport } from "../transport/http.js";
import { WsTransport } from "../transport/ws.js";
import type { ClientMessage } from "../transport/types.js";

export interface ServerOptions {
  port: number;
  hostname?: string;
}

/**
 * 创建并返回 Agent 实例（单用户单会话，预留扩展）。
 */
function createAgent(config: AliceConfig): Agent {
  const provider = new AnthropicProvider(config.provider);
  const tools = new ToolRegistry();
  for (const tool of getBuiltinTools()) {
    tools.register(tool);
  }
  const contextAssembly = new ContextAssembly(process.cwd());
  return new Agent(provider, tools, config, contextAssembly);
}

// CORS headers for cross-origin requests
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

/**
 * 启动 HTTP 服务器，支持 SSE 和 WebSocket。
 */
export function startServer(config: AliceConfig, options: ServerOptions) {
  let agent = createAgent(config);
  // 当前活跃的 WebSocket transport（单用户模式）
  let activeWsTransport: WsTransport | null = null;
  // 是否有 SSE 请求正在处理中
  let sseInProgress = false;

  const server = Bun.serve({
    port: options.port,
    hostname: options.hostname ?? "0.0.0.0",

    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;

      // CORS preflight
      if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: CORS_HEADERS });
      }

      // ─── Health Check ──────────────────────────────────
      if (path === "/api/health" && req.method === "GET") {
        return jsonResponse({ status: "ok", version: "0.1.0" });
      }

      // ─── Session Info ──────────────────────────────────
      if (path === "/api/session" && req.method === "GET") {
        const session = agent.getSession();
        return jsonResponse({
          id: session.id,
          model: session.model,
          messageCount: session.messages.length,
          totalTokens: session.totalTokens,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
        });
      }

      // ─── Clear Session ─────────────────────────────────
      if (path === "/api/session/clear" && req.method === "POST") {
        agent = createAgent(config);
        return jsonResponse({ status: "cleared" });
      }

      // ─── Switch Mode ───────────────────────────────────
      if (path === "/api/mode" && req.method === "POST") {
        const body = await req.json() as { mode?: string };
        if (!body.mode) {
          return jsonResponse({ error: "mode is required" }, 400);
        }
        if (!AVAILABLE_MODES.includes(body.mode as AgentMode)) {
          return jsonResponse({
            error: `Invalid mode. Available: ${AVAILABLE_MODES.join(", ")}`,
          }, 400);
        }
        agent.switchMode(body.mode as AgentMode);
        return jsonResponse({
          mode: body.mode,
          label: getModeLabel(body.mode as AgentMode),
        });
      }

      // ─── Get Current Mode ──────────────────────────────
      if (path === "/api/mode" && req.method === "GET") {
        const ctx = agent.getContextAssembly();
        const mode = ctx.getMode();
        return jsonResponse({
          mode,
          label: getModeLabel(mode),
          available: AVAILABLE_MODES,
        });
      }

      // ─── Chat (SSE) ───────────────────────────────────
      if (path === "/api/chat" && req.method === "POST") {
        if (sseInProgress) {
          return jsonResponse(
            { error: "A chat request is already in progress" },
            409,
          );
        }

        const body = await req.json() as { message?: string };
        if (!body.message) {
          return jsonResponse({ error: "message is required" }, 400);
        }

        sseInProgress = true;
        const transport = new HttpTransport();
        const stream = transport.createStream();

        // 绑定 Agent 事件 → SSE
        const handler = (event: import("../core/types.js").AgentEvent) => {
          transport.send(event);
        };
        agent.on(handler);

        // 异步执行 agent，完成后关闭 SSE 流
        (async () => {
          try {
            await agent.runStreaming(body.message!);
          } catch (error) {
            transport.send({
              type: "error",
              data: {
                message: error instanceof Error ? error.message : String(error),
              },
            });
          } finally {
            transport.close();
            sseInProgress = false;
            // 移除事件处理器（Agent 目前不支持 off，通过重建解决）
          }
        })();

        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
            ...CORS_HEADERS,
          },
        });
      }

      // ─── WebSocket Upgrade ─────────────────────────────
      if (path === "/api/ws" && req.method === "GET") {
        const upgraded = server.upgrade(req);
        if (!upgraded) {
          return jsonResponse({ error: "WebSocket upgrade failed" }, 400);
        }
        return undefined as unknown as Response;
      }

      // ─── 404 ──────────────────────────────────────────
      return jsonResponse({ error: "Not found" }, 404);
    },

    websocket: {
      open(ws) {
        const transport = new WsTransport(ws);
        activeWsTransport = transport;

        // 绑定 Agent 事件 → WebSocket
        agent.on((event) => transport.send(event));

        transport.onDisconnect(() => {
          if (activeWsTransport === transport) {
            activeWsTransport = null;
          }
        });

        ws.send(JSON.stringify({
          type: "connected",
          data: {
            sessionId: agent.getSession().id,
            model: agent.getSession().model,
          },
        }));
      },

      async message(ws, raw) {
        if (!activeWsTransport) return;

        const msg = activeWsTransport.handleRawMessage(raw as string);
        if (!msg) return;

        switch (msg.type) {
          case "chat":
            try {
              await agent.runStreaming(msg.message);
              // 发送完成信号
              ws.send(JSON.stringify({
                type: "chat_complete",
                data: { totalTokens: agent.getSession().totalTokens },
              }));
            } catch (error) {
              ws.send(JSON.stringify({
                type: "error",
                data: {
                  message: error instanceof Error ? error.message : String(error),
                },
              }));
            }
            break;

          case "abort":
            agent.abort();
            break;

          case "mode":
            if (AVAILABLE_MODES.includes(msg.mode as AgentMode)) {
              agent.switchMode(msg.mode as AgentMode);
              ws.send(JSON.stringify({
                type: "mode_changed",
                data: { mode: msg.mode, label: getModeLabel(msg.mode as AgentMode) },
              }));
            }
            break;

          case "session":
            const session = agent.getSession();
            ws.send(JSON.stringify({
              type: "session_info",
              data: {
                id: session.id,
                model: session.model,
                messageCount: session.messages.length,
                totalTokens: session.totalTokens,
              },
            }));
            break;

          case "clear":
            agent = createAgent(config);
            // 重新绑定事件
            agent.on((event) => activeWsTransport?.send(event));
            ws.send(JSON.stringify({
              type: "session_cleared",
              data: { sessionId: agent.getSession().id },
            }));
            break;
        }
      },

      close(ws) {
        activeWsTransport?.handleClose();
      },
    },
  });

  return server;
}
