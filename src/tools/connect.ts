import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import { parseGoogleAuthIntent } from "../core/auth-intent";
import {
  classifySessionRelayEndpoint,
  isSessionOpsRelayEndpoint,
  resolveSessionRelayRoute
} from "../relay/relay-endpoints";
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
      extensionLegacy: z.boolean().optional().describe("Use legacy extension relay (/cdp) instead of ops"),
      googleAuthIntent: z.string().optional().describe("Google auth continuity intent: none or user-owned"),
      disableSystemCookieBootstrap: z.boolean().optional().describe("Disable system browser cookie bootstrap for managed/CDP sessions"),
      allowGoogleCookieBootstrap: z.boolean().optional().describe("Explicitly allow Google-sensitive cookie bootstrap for managed/CDP sessions")
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
        const googleAuthIntent = parseGoogleAuthIntent(args.googleAuthIntent);
        const googleAuthUsesOpsRelay = typeof args.host === "undefined"
          && typeof args.port === "undefined"
          && !extensionLegacy
          && (!wsEndpoint || isSessionOpsRelayEndpoint(wsEndpoint));
        if (googleAuthIntent === "user_owned_google" && !googleAuthUsesOpsRelay) {
          return failure(
            "Google user-owned auth requires the extension /ops relay. Use a local /ops wsEndpoint or omit wsEndpoint/host/port/extensionLegacy and connect the extension, then retry.",
            "unsupported_mode"
          );
        }
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
          const relayOptions = {
            ...(startUrl ? { startUrl } : {}),
            ...(googleAuthIntent === "user_owned_google" ? { googleAuthIntent } : {})
          };
          result = Object.keys(relayOptions).length > 0
            ? await deps.manager.connectRelay(preferredRelayEndpoint, relayOptions)
            : await deps.manager.connectRelay(preferredRelayEndpoint);
        } else {
          if (!hasExplicitCdp) {
            return failure("Extension relay not available. Connect the extension or pass wsEndpoint/host/port.", "extension_not_connected");
          }
          result = await deps.manager.connect({
            wsEndpoint,
            host: args.host,
            port: args.port,
            startUrl,
            googleAuthIntent,
            disableSystemCookieBootstrap: args.disableSystemCookieBootstrap,
            allowGoogleCookieBootstrap: args.allowGoogleCookieBootstrap
          });
        }
        return ok({
          sessionId: result.sessionId,
          mode: result.mode,
          browserWsEndpoint: result.wsEndpoint,
          activeTargetId: result.activeTargetId,
          warnings: result.warnings.length ? result.warnings : undefined,
          diagnostics: result.diagnostics
        });
      } catch (error) {
        return failure(serializeError(error).message, "connect_failed");
      }
    }
  });
}
