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
      persistProfile: z.boolean().optional().describe("Persist profile data between sessions"),
      noExtension: z.boolean().optional().describe("Skip extension relay and launch a new browser"),
      extensionOnly: z.boolean().optional().describe("Require extension relay or fail"),
      waitForExtension: z.boolean().optional().describe("Wait for extension to connect before launching"),
      waitTimeoutMs: z.number().int().optional().describe("Timeout for waiting on extension (ms)")
    },
    async execute(args) {
      try {
        let relayStatus = deps.relay?.status();
        const relayUrl = deps.relay?.getCdpUrl();
        const waitTimeoutMs = args.waitTimeoutMs ?? 30000;

        if (args.waitForExtension && deps.relay) {
          const connected = await waitForExtension(deps.relay, waitTimeoutMs);
          if (connected) {
            relayStatus = deps.relay.status();
          }
        }

        const useRelay = Boolean(!args.noExtension && relayStatus?.extensionConnected && relayUrl);
        let usedRelay = false;
        let relayWarning: string | null = null;
        let result:
          | Awaited<ReturnType<typeof deps.manager.launch>>
          | Awaited<ReturnType<typeof deps.manager.connectRelay>>
          | null = null;

        if (args.extensionOnly && !useRelay) {
          return failure("Extension not connected; use --no-extension to launch a new browser.", "extension_not_connected");
        }

        if (useRelay && relayUrl) {
          try {
            result = await deps.manager.connectRelay(relayUrl);
            usedRelay = true;
          } catch {
            if (args.extensionOnly) {
              return failure("Extension relay connection failed.", "extension_connect_failed");
            }
            relayWarning = "Relay connection failed; falling back to managed Chrome.";
          }
        }

        if (!result) {
          if (relayUrl && !args.noExtension) {
            relayWarning ??= "Extension not connected; launching managed Chrome instead.";
          }
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

async function waitForExtension(relay: { status: () => { extensionConnected: boolean } }, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (relay.status().extensionConnected) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}
