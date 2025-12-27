import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import type { ToolDeps } from "./deps";
import { failure, ok, serializeError } from "./response";

const z = tool.schema;

export function createLaunchTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description: "Launch a managed Chrome session and return a sessionId.",
    args: {
      profile: z.string().optional().describe("Profile name for persistent browsing"),
      headless: z.boolean().optional().describe("Run Chrome in headless mode"),
      startUrl: z.string().optional().describe("Optional URL to open after launch"),
      chromePath: z.string().optional().describe("Override Chrome executable path"),
      flags: z.array(z.string()).optional().describe("Extra Chrome flags"),
      persistProfile: z.boolean().optional().describe("Persist profile data between sessions")
    },
    async execute(args) {
      try {
        const relayStatus = deps.relay?.status();
        const relayUrl = deps.relay?.getCdpUrl();
        const useRelay = Boolean(relayStatus?.extensionConnected && relayUrl);
        let usedRelay = false;
        let relayWarning: string | null = null;
        let result:
          | Awaited<ReturnType<typeof deps.manager.launch>>
          | Awaited<ReturnType<typeof deps.manager.connectRelay>>
          | null = null;

        if (useRelay && relayUrl) {
          try {
            result = await deps.manager.connectRelay(relayUrl);
            usedRelay = true;
          } catch {
            relayWarning = "Relay connection failed; falling back to managed Chrome.";
          }
        }

        if (!result) {
          result = await deps.manager.launch({
            profile: args.profile,
            headless: args.headless,
            startUrl: args.startUrl,
            chromePath: args.chromePath,
            flags: args.flags,
            persistProfile: args.persistProfile
          });
        }

        if (usedRelay && args.startUrl && result.activeTargetId) {
          await deps.manager.goto(result.sessionId, args.startUrl, "load", 30000);
        }

        const warnings = [
          ...(result.warnings ?? []),
          ...(relayWarning ? [relayWarning] : [])
        ];
        return ok({
          sessionId: result.sessionId,
          mode: result.mode,
          browserWsEndpoint: result.wsEndpoint,
          activeTargetId: result.activeTargetId,
          warnings: warnings.length ? warnings : undefined
        });
      } catch (error) {
        return failure(serializeError(error).message, "launch_failed");
      }
    }
  });
}
