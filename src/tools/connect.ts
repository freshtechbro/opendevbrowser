import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import { classifySessionRelayEndpoint, resolveSessionRelayRoute } from "../relay/relay-endpoints";
import type { ToolDeps } from "./deps";
import { failure, ok, serializeError } from "./response";

const z = tool.schema;

export function createConnectTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description: "Connect to an existing Chrome CDP endpoint or extension relay.",
    args: {
      wsEndpoint: z.string().optional().describe("Full WebSocket endpoint to connect to"),
      host: z.string().optional().describe("Host for /json/version lookup"),
      port: z.number().int().optional().describe("Port for /json/version lookup"),
      startUrl: z.string().optional().describe("Open this URL immediately after connect"),
      extensionLegacy: z.boolean().optional().describe("Use legacy extension relay (/cdp) instead of ops")
    },
    async execute(args) {
      try {
        await deps.relay?.refresh?.();
        const wsEndpoint = args.wsEndpoint;
        const extensionLegacy = args.extensionLegacy === true;
        const startUrl = typeof args.startUrl === "string" && args.startUrl.trim().length > 0
          ? args.startUrl.trim()
          : undefined;
        const hasExplicitCdp = Boolean(wsEndpoint || args.host || args.port);
        const relayUrl = extensionLegacy ? deps.relay?.getCdpUrl() ?? null : deps.relay?.getOpsUrl?.() ?? null;
        const parsedRelayEndpoint = classifySessionRelayEndpoint(wsEndpoint);
        const resolvedRelayEndpoint = parsedRelayEndpoint
          ? resolveSessionRelayRoute(parsedRelayEndpoint, { extensionLegacy })
          : null;
        if (resolvedRelayEndpoint && "code" in resolvedRelayEndpoint) {
          return failure(resolvedRelayEndpoint.message, resolvedRelayEndpoint.code);
        }
        const relayEndpoint = relayUrl && wsEndpoint === relayUrl
          ? relayUrl
          : resolvedRelayEndpoint?.normalizedEndpoint ?? null;
        const preferredRelayEndpoint = relayEndpoint ?? (!hasExplicitCdp ? relayUrl : null);
        let result;
        if (preferredRelayEndpoint) {
          result = startUrl
            ? await deps.manager.connectRelay(preferredRelayEndpoint, { startUrl })
            : await deps.manager.connectRelay(preferredRelayEndpoint);
        } else {
          if (!hasExplicitCdp) {
            return failure("Extension relay not available. Connect the extension or pass wsEndpoint/host/port.", "extension_not_connected");
          }
          result = await deps.manager.connect({
            wsEndpoint,
            host: args.host,
            port: args.port,
            startUrl
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
