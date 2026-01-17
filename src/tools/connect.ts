import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import type { ToolDeps } from "./deps";
import { failure, ok, serializeError } from "./response";

const z = tool.schema;

function normalizeRelayEndpoint(wsEndpoint: string | undefined): string | null {
  if (!wsEndpoint) return null;
  try {
    const url = new URL(wsEndpoint);
    if (url.protocol !== "ws:" && url.protocol !== "wss:") return null;
    if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") return null;
    if (!url.port || !/^\d+$/.test(url.port)) return null;
    const normalizedPath = url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : url.pathname;
    if (normalizedPath && normalizedPath !== "/cdp") return null;
    return `${url.protocol}//${url.hostname}:${url.port}/cdp`;
  } catch {
    return null;
  }
}

export function createConnectTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description: "Connect to an existing Chrome CDP endpoint.",
    args: {
      wsEndpoint: z.string().optional().describe("Full WebSocket endpoint to connect to"),
      host: z.string().optional().describe("Host for /json/version lookup"),
      port: z.number().int().optional().describe("Port for /json/version lookup")
    },
    async execute(args) {
      try {
        const wsEndpoint = args.wsEndpoint;
        const relayUrl = deps.relay?.getCdpUrl();
        const normalizedRelayEndpoint = normalizeRelayEndpoint(wsEndpoint);
        const relayEndpoint = relayUrl && wsEndpoint === relayUrl ? relayUrl : normalizedRelayEndpoint;
        const result = relayEndpoint
          ? await deps.manager.connectRelay(relayEndpoint)
          : await deps.manager.connect({
            wsEndpoint,
            host: args.host,
            port: args.port
          });
        return ok({
          sessionId: result.sessionId,
          mode: result.mode,
          browserWsEndpoint: result.wsEndpoint,
          activeTargetId: result.activeTargetId,
          warnings: result.warnings.length ? result.warnings : undefined
        });
      } catch (error) {
        return failure(serializeError(error).message, "connect_failed");
      }
    }
  });
}
