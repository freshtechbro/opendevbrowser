import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import type { ToolDeps } from "./deps";
import { failure, ok, serializeError } from "./response";

const z = tool.schema;

type RelayStatus = ReturnType<NonNullable<ToolDeps["relay"]>["status"]>;
type RelayObservedStatus = {
  instanceId: string;
  running: boolean;
  port?: number;
  extensionConnected: boolean;
  extensionHandshakeComplete: boolean;
  cdpConnected: boolean;
  pairingRequired: boolean;
};

export function createLaunchTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description: "Launch a browser session (extension relay first) and return a sessionId.",
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
      let attemptedRebind = false;

      while (true) {
        try {
          await deps.relay?.refresh?.();
          const config = deps.config.get();
          let relayStatus = deps.relay?.status();
          let relayUrl = deps.relay?.getCdpUrl() ?? null;
          const relayPort = relayStatus?.port;
          if (!relayUrl && isValidPort(relayPort)) {
            relayUrl = `ws://127.0.0.1:${relayPort}/cdp`;
          }
          const waitTimeoutMs = clampWaitTimeout(args.waitTimeoutMs ?? 30000);
          const headlessExplicit = args.headless === true;
          const managedExplicit = Boolean(args.noExtension || headlessExplicit);
          const managedHeadless = headlessExplicit ? true : false;

          if (args.waitForExtension && !managedExplicit) {
            const observedPort = resolveObservedPort(relayStatus, config.relayPort);
            const connected = await waitForExtensionHandshake(deps.relay, observedPort, waitTimeoutMs);
            if (connected) {
              relayStatus = deps.relay?.status() ?? relayStatus;
              relayUrl = deps.relay?.getCdpUrl() ?? relayUrl;
            }
          }

          const observedPort = resolveObservedPort(relayStatus, config.relayPort);
          const shouldFetchObserved = !managedExplicit && (!relayUrl || !(relayStatus?.extensionHandshakeComplete || relayStatus?.extensionConnected));
          const observedStatus = shouldFetchObserved ? await fetchRelayObservedStatus(observedPort) : null;
          if (!relayUrl) {
            const fallbackPort = isValidPort(observedStatus?.port) ? observedStatus?.port : observedPort;
            relayUrl = fallbackPort ? `ws://127.0.0.1:${fallbackPort}/cdp` : null;
          }
          const extensionReady = Boolean(
            relayUrl && (
              relayStatus?.extensionHandshakeComplete ||
              relayStatus?.extensionConnected ||
              observedStatus?.extensionHandshakeComplete ||
              observedStatus?.extensionConnected
            )
          );
          let usedRelay = false;
          let result:
            | Awaited<ReturnType<typeof deps.manager.launch>>
            | Awaited<ReturnType<typeof deps.manager.connectRelay>>
            | null = null;

          if (args.extensionOnly && !extensionReady) {
            const diagnostics = buildRelayNotReadyDiagnostics("Extension not connected.", {
              relayUrl,
              relayStatus,
              observedStatus,
              observedPort
            });
            if (await maybeRetryHubMismatch(diagnostics.hint, attemptedRebind, deps)) {
              attemptedRebind = true;
              continue;
            }
            return failure(buildExtensionMissingMessage(diagnostics.message), "extension_not_connected");
          }

          if (!managedExplicit) {
            if (!extensionReady || !relayUrl) {
              const diagnostics = buildRelayNotReadyDiagnostics("Extension not connected.", {
                relayUrl,
                relayStatus,
                observedStatus,
                observedPort
              });
              if (await maybeRetryHubMismatch(diagnostics.hint, attemptedRebind, deps)) {
                attemptedRebind = true;
                continue;
              }
              return failure(buildExtensionMissingMessage(diagnostics.message), "extension_not_connected");
            }
            try {
              result = await deps.manager.connectRelay(relayUrl);
              usedRelay = true;
            } catch (error) {
              const errorMessage = serializeError(error).message;
              const unauthorized = errorMessage.toLowerCase().includes("unauthorized") || errorMessage.includes("401");
              const errorObservedStatus = observedStatus ?? await fetchRelayObservedStatus(observedPort);
              const diagnostics = buildRelayNotReadyDiagnostics(
                unauthorized
                  ? "Extension relay connection failed: relay /cdp unauthorized (token mismatch)."
                  : `Extension relay connection failed: ${errorMessage}`,
                {
                  relayUrl,
                  relayStatus,
                  observedStatus: errorObservedStatus,
                  observedPort
                }
              );
              if (await maybeRetryHubMismatch(diagnostics.hint, attemptedRebind, deps)) {
                attemptedRebind = true;
                continue;
              }
              return failure(buildExtensionMissingMessage(diagnostics.message), "extension_connect_failed");
            }
          }

          if (!result) {
            try {
              result = await deps.manager.launch({
                profile: args.profile,
                headless: managedHeadless,
                startUrl: args.startUrl,
                chromePath: args.chromePath,
                flags: args.flags,
                persistProfile: args.persistProfile,
                noExtension: args.noExtension
              });
            } catch (error) {
              return failure(buildManagedFailureMessage(error), "launch_failed");
            }
          }

          if (usedRelay && args.startUrl && result.activeTargetId) {
            await deps.manager.goto(result.sessionId, args.startUrl, "load", 30000);
          }

          const warnings = result.warnings ?? [];
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
    }
  });
}

const buildExtensionMissingMessage = (reason: string): string => {
  return [
    reason,
    "Connect the extension: open the Chrome extension popup and click Connect, then retry.",
    "Tip: If the popup says Connected, it may be connected to a different relay instance/port than this tool expects.",
    "Legend: ext=extension websocket, handshake=extension handshake, cdp=active /cdp client, pairing=token required.",
    "",
    "Other options (explicit):",
    "- Managed (headed): npx opendevbrowser launch --no-extension",
    "- Managed (headless): npx opendevbrowser launch --no-extension --headless",
    "- CDPConnect (default port): npx opendevbrowser connect --cdp-port 9222",
    "- CDPConnect (explicit WS): npx opendevbrowser connect --ws-endpoint ws://127.0.0.1:9222/devtools/browser/<id>",
    "Note: CDPConnect requires Chrome started with --remote-debugging-port=9222."
  ].join("\n");
};

const buildManagedFailureMessage = (error: unknown): string => {
  const detail = serializeError(error).message;
  return [
    `Managed session failed: ${detail}`,
    "",
    "Final option (explicit):",
    "- CDPConnect (default port): npx opendevbrowser connect --cdp-port 9222",
    "- CDPConnect (explicit WS): npx opendevbrowser connect --ws-endpoint ws://127.0.0.1:9222/devtools/browser/<id>"
  ].join("\n");
};

const MIN_WAIT_TIMEOUT_MS = 3000;
const WAIT_MIN_DELAY_MS = 250;
const WAIT_MAX_DELAY_MS = 2000;

function clampWaitTimeout(timeoutMs: number): number {
  if (!Number.isFinite(timeoutMs)) {
    return MIN_WAIT_TIMEOUT_MS;
  }
  return Math.max(timeoutMs, MIN_WAIT_TIMEOUT_MS);
}

async function waitForExtensionHandshake(
  relay: { status: () => { extensionHandshakeComplete: boolean } } | undefined,
  observedPort: number | null,
  timeoutMs: number
): Promise<boolean> {
  const start = Date.now();
  let delay = WAIT_MIN_DELAY_MS;
  while (Date.now() - start < timeoutMs) {
    if (relay?.status().extensionHandshakeComplete) {
      return true;
    }
    const observedStatus = await fetchRelayObservedStatus(observedPort);
    if (observedStatus?.extensionHandshakeComplete) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(delay * 2, WAIT_MAX_DELAY_MS);
  }
  return false;
}

function resolveObservedPort(relayStatus: RelayStatus | undefined, configPort: number): number | null {
  const relayPort = relayStatus?.port;
  if (isValidPort(relayPort)) return relayPort;
  if (isValidPort(configPort)) return configPort;
  return null;
}

function isValidPort(port: unknown): port is number {
  return typeof port === "number" && Number.isInteger(port) && port > 0 && port <= 65535;
}

function shortInstanceId(value: string | undefined): string {
  if (!value) return "?";
  return value.slice(0, 8);
}

function formatRelayUrl(relayUrl: string | null): string {
  return relayUrl ?? "null";
}

function formatLocalStatus(status: RelayStatus | undefined): string {
  return [
    "local(instance=",
    shortInstanceId(status?.instanceId),
    " port=",
    typeof status?.port === "number" ? String(status.port) : "?",
    " ext=",
    String(Boolean(status?.extensionConnected)),
    " handshake=",
    String(Boolean(status?.extensionHandshakeComplete)),
    " cdp=",
    String(Boolean(status?.cdpConnected)),
    " pairing=",
    String(Boolean(status?.pairingRequired)),
    ")"
  ].join("");
}

function formatObservedStatus(status: RelayObservedStatus | null, port: number | null): string {
  const label = port ?? "?";
  if (!status) {
    return `observed@${label}=none`;
  }
  return [
    "observed@",
    label,
    "=instance=",
    shortInstanceId(status.instanceId),
    " ext=",
    String(Boolean(status.extensionConnected)),
    " handshake=",
    String(Boolean(status.extensionHandshakeComplete)),
    " cdp=",
    String(Boolean(status.cdpConnected)),
    " pairing=",
    String(Boolean(status.pairingRequired))
  ].join("");
}

type RelayNotReadyDiagnostics = {
  message: string;
  hint: string;
};

function buildRelayNotReadyDiagnostics(
  baseReason: string,
  detail: {
    relayUrl: string | null;
    relayStatus: RelayStatus | undefined;
    observedStatus: RelayObservedStatus | null;
    observedPort: number | null;
  }
): RelayNotReadyDiagnostics {
  const localExt = Boolean(detail.relayStatus?.extensionConnected);
  const observedExt = Boolean(detail.observedStatus?.extensionConnected);
  let hint = "none";
  if (detail.relayUrl === null) {
    hint = "relayUrl_null";
  } else if (detail.observedStatus && !localExt && observedExt) {
    hint = "possible_mismatch";
  } else if (detail.relayStatus?.instanceId && detail.observedStatus?.instanceId
    && detail.relayStatus.instanceId !== detail.observedStatus.instanceId) {
    hint = "possible_mismatch";
  }
  const diagnostics = [
    "Diagnostics: relayUrl=",
    formatRelayUrl(detail.relayUrl),
    " ",
    formatLocalStatus(detail.relayStatus),
    " ",
    formatObservedStatus(detail.observedStatus, detail.observedPort),
    " hint=",
    hint
  ].join("");
  return { message: [baseReason, diagnostics].join("\n"), hint };
}

async function maybeRetryHubMismatch(
  hint: string,
  attempted: boolean,
  deps: ToolDeps
): Promise<boolean> {
  if (attempted) return false;
  if (hint !== "possible_mismatch") return false;
  if (!deps.ensureHub) return false;
  await deps.ensureHub();
  await deps.relay?.refresh?.();
  return true;
}

async function fetchRelayObservedStatus(port: number | null): Promise<RelayObservedStatus | null> {
  if (!isValidPort(port)) return null;
  if (typeof fetch !== "function") return null;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 500);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/status`, { signal: controller.signal });
    if (!response.ok) return null;
    const payload = await response.json() as Partial<RelayObservedStatus>;
    if (!payload || typeof payload.instanceId !== "string") return null;
    return {
      instanceId: payload.instanceId,
      running: Boolean(payload.running),
      port: typeof payload.port === "number" ? payload.port : undefined,
      extensionConnected: Boolean(payload.extensionConnected),
      extensionHandshakeComplete: Boolean(payload.extensionHandshakeComplete),
      cdpConnected: Boolean(payload.cdpConnected),
      pairingRequired: Boolean(payload.pairingRequired)
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}
