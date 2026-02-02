import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import type { ToolDeps } from "./deps";
import { failure, ok, serializeError } from "./response";

const z = tool.schema;

function normalizeRelayEndpoint(
  wsEndpoint: string | undefined,
  path: "cdp" | "ops",
  allowBase: boolean
): string | null {
  if (!wsEndpoint) return null;
  try {
    const url = new URL(wsEndpoint);
    if (url.protocol !== "ws:" && url.protocol !== "wss:") return null;
    if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") return null;
    if (!url.port || !/^\d+$/.test(url.port)) return null;
    const normalizedPath = url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : url.pathname;
    if (!allowBase && normalizedPath === "") return null;
    if (normalizedPath && normalizedPath !== `/${path}`) return null;
    return `${url.protocol}//${url.hostname}:${url.port}/${path}`;
  } catch {
    return null;
  }
}

export function createConnectTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description: "Connect to an existing Chrome CDP endpoint or extension relay.",
    args: {
      wsEndpoint: z.string().optional().describe("Full WebSocket endpoint to connect to"),
      host: z.string().optional().describe("Host for /json/version lookup"),
      port: z.number().int().optional().describe("Port for /json/version lookup"),
      extensionLegacy: z.boolean().optional().describe("Use legacy extension relay (/cdp) instead of ops")
    },
    async execute(args) {
      try {
        await deps.relay?.refresh?.();
        const wsEndpoint = args.wsEndpoint;
        const extensionLegacy = args.extensionLegacy === true;
        const hasExplicitCdp = Boolean(wsEndpoint || args.host || args.port);
        const relayUrl = extensionLegacy ? deps.relay?.getCdpUrl() ?? null : deps.relay?.getOpsUrl?.() ?? null;
        const normalizedOpsEndpoint = normalizeRelayEndpoint(wsEndpoint, "ops", true);
        const normalizedLegacyEndpoint = normalizeRelayEndpoint(wsEndpoint, "cdp", false);
        if (normalizedLegacyEndpoint && !extensionLegacy) {
          return failure("Legacy extension relay (/cdp) requires extensionLegacy=true.", "extension_legacy_required");
        }
        const relayEndpoint = relayUrl && wsEndpoint === relayUrl ? relayUrl : normalizedOpsEndpoint ?? (extensionLegacy ? normalizedLegacyEndpoint : null);
        let result;
        if (relayEndpoint || (!hasExplicitCdp && relayUrl)) {
          result = await deps.manager.connectRelay(relayEndpoint ?? relayUrl ?? "");
        } else {
          if (!hasExplicitCdp) {
            return failure("Extension relay not available. Connect the extension or pass wsEndpoint/host/port.", "extension_not_connected");
          }
          result = await deps.manager.connect({
            wsEndpoint,
            host: args.host,
            port: args.port
          });
        }
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
