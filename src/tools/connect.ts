import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import type { ToolDeps } from "./deps";
import { failure, ok, serializeError } from "./response";

const z = tool.schema;

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
        const relayUrl = deps.relay?.getCdpUrl();
        const useRelay = Boolean(relayUrl && args.wsEndpoint === relayUrl);
        const result = useRelay && relayUrl
          ? await deps.manager.connectRelay(relayUrl)
          : await deps.manager.connect({
            wsEndpoint: args.wsEndpoint,
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
