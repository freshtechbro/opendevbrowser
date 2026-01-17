import type { OpenDevBrowserCore } from "../core";

export type DaemonCommandRequest = {
  name: string;
  params?: Record<string, unknown>;
};

export async function handleDaemonCommand(core: OpenDevBrowserCore, request: DaemonCommandRequest): Promise<unknown> {
  const params = request.params ?? {};

  switch (request.name) {
    case "session.launch":
      return launchWithRelay(core, params);
    case "session.connect":
      return connectWithRelayRouting(core, params);
    case "session.disconnect":
      await core.manager.disconnect(requireString(params.sessionId, "sessionId"), optionalBoolean(params.closeBrowser) ?? false);
      return { ok: true };
    case "session.status":
      return core.manager.status(requireString(params.sessionId, "sessionId"));
    case "nav.goto":
      return core.manager.goto(
        requireString(params.sessionId, "sessionId"),
        requireString(params.url, "url"),
        requireWaitUntil(params.waitUntil),
        optionalNumber(params.timeoutMs) ?? 30000
      );
    case "nav.wait":
      if (typeof params.ref === "string") {
        return core.manager.waitForRef(
          requireString(params.sessionId, "sessionId"),
          requireString(params.ref, "ref"),
          requireState(params.state),
          optionalNumber(params.timeoutMs) ?? 30000
        );
      }
      return core.manager.waitForLoad(
        requireString(params.sessionId, "sessionId"),
        requireWaitUntil(params.until),
        optionalNumber(params.timeoutMs) ?? 30000
      );
    case "nav.snapshot":
      return core.manager.snapshot(
        requireString(params.sessionId, "sessionId"),
        requireSnapshotMode(params.mode),
        optionalNumber(params.maxChars) ?? 16000,
        optionalString(params.cursor)
      );
    case "interact.click":
      return core.manager.click(
        requireString(params.sessionId, "sessionId"),
        requireString(params.ref, "ref")
      );
    case "interact.type":
      return core.manager.type(
        requireString(params.sessionId, "sessionId"),
        requireString(params.ref, "ref"),
        requireString(params.text, "text"),
        optionalBoolean(params.clear) ?? false,
        optionalBoolean(params.submit) ?? false
      );
    case "interact.select":
      return core.manager.select(
        requireString(params.sessionId, "sessionId"),
        requireString(params.ref, "ref"),
        requireStringArray(params.values, "values")
      );
    case "interact.scroll":
      return core.manager.scroll(
        requireString(params.sessionId, "sessionId"),
        optionalNumber(params.dy) ?? 0,
        optionalString(params.ref)
      );
    default:
      throw new Error(`Unknown daemon command: ${request.name}`);
  }
}

async function launchWithRelay(core: OpenDevBrowserCore, params: Record<string, unknown>) {
  let relayStatus = core.relay.status();
  let relayUrl = core.relay.getCdpUrl();
  const relayPort = core.config.relayPort;
  const noExtension = optionalBoolean(params.noExtension) ?? false;
  const extensionOnly = optionalBoolean(params.extensionOnly) ?? false;
  const waitForExtension = optionalBoolean(params.waitForExtension) ?? false;
  const headlessExplicit = optionalBoolean(params.headless) === true;
  const managedExplicit = Boolean(noExtension || headlessExplicit);
  const managedHeadless = headlessExplicit ? true : false;
  const waitTimeoutMs = optionalNumber(params.waitTimeoutMs) ?? 30000;

  if (waitForExtension && !managedExplicit) {
    const observedPort = resolveObservedPort(relayStatus, relayPort);
    const connected = await waitForRelayAny(core.relay, observedPort, waitTimeoutMs);
    if (connected) {
      relayStatus = core.relay.status();
      relayUrl = core.relay.getCdpUrl() ?? relayUrl;
    }
  }

  const observedPort = resolveObservedPort(relayStatus, relayPort);
  const shouldFetchObserved = !managedExplicit && (!relayUrl || !(relayStatus.extensionHandshakeComplete || relayStatus.extensionConnected));
  const observedStatus = shouldFetchObserved ? await fetchRelayObservedStatus(observedPort) : null;
  if (!relayUrl) {
    const fallbackPort = isValidPort(observedStatus?.port) ? observedStatus?.port : observedPort;
    relayUrl = fallbackPort ? `ws://127.0.0.1:${fallbackPort}/cdp` : null;
  }
  const extensionReady = Boolean(
    relayUrl && (
      relayStatus.extensionHandshakeComplete ||
      relayStatus.extensionConnected ||
      observedStatus?.extensionHandshakeComplete ||
      observedStatus?.extensionConnected
    )
  );
  const diagnostics = observedStatus
    ? `Diagnostics: relayPort=${observedPort ?? "?"} instance=${observedStatus.instanceId.slice(0, 8)} ext=${observedStatus.extensionConnected} handshake=${observedStatus.extensionHandshakeComplete} cdp=${observedStatus.cdpConnected}`
    : null;
  const missingReason = diagnostics ? `Extension not connected. ${diagnostics}` : "Extension not connected.";

  if (extensionOnly && !extensionReady) {
    throw new Error(buildExtensionMissingMessage(missingReason));
  }

  if (!managedExplicit) {
    if (!extensionReady || !relayUrl) {
      throw new Error(buildExtensionMissingMessage(missingReason));
    }
    try {
      const result = await core.manager.connectRelay(relayUrl);
      return { ...result, warnings: result.warnings ?? [] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const unauthorized = message.toLowerCase().includes("unauthorized") || message.includes("401");
      const reason = unauthorized
        ? "Extension relay connection failed: relay /cdp unauthorized (token mismatch)."
        : "Extension relay connection failed.";
      throw new Error(buildExtensionMissingMessage(reason));
    }
  }

  try {
    const result = await core.manager.launch({
      profile: optionalString(params.profile),
      headless: managedHeadless,
      startUrl: optionalString(params.startUrl),
      chromePath: optionalString(params.chromePath),
      flags: optionalStringArray(params.flags),
      persistProfile: optionalBoolean(params.persistProfile)
    });
    return { ...result, warnings: result.warnings ?? [] };
  } catch (error) {
    throw new Error(buildManagedFailureMessage(error));
  }
}

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

async function connectWithRelayRouting(core: OpenDevBrowserCore, params: Record<string, unknown>) {
  const wsEndpoint = optionalString(params.wsEndpoint);
  const relayUrl = core.relay.getCdpUrl();
  const normalizedRelayEndpoint = normalizeRelayEndpoint(wsEndpoint);
  const relayEndpoint = relayUrl && wsEndpoint === relayUrl ? relayUrl : normalizedRelayEndpoint;

  if (relayEndpoint) {
    return core.manager.connectRelay(relayEndpoint);
  }

  return core.manager.connect({
    wsEndpoint,
    host: optionalString(params.host),
    port: optionalNumber(params.port)
  });
}

function buildExtensionMissingMessage(reason: string): string {
  return [
    reason,
    "Connect the extension: open the Chrome extension popup and click Connect, then retry.",
    "Tip: If the popup says Connected, it may be connected to a different relay instance/port than the daemon expects.",
    "",
    "Other options (explicit):",
    "- Managed (headed): npx opendevbrowser launch --no-extension",
    "- Managed (headless): npx opendevbrowser launch --no-extension --headless",
    "- CDPConnect (default port): npx opendevbrowser connect --cdp-port 9222",
    "- CDPConnect (explicit WS): npx opendevbrowser connect --ws-endpoint ws://127.0.0.1:9222/devtools/browser/<id>",
    "Note: CDPConnect requires Chrome started with --remote-debugging-port=9222."
  ].join("\n");
}

function buildManagedFailureMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return [
    `Managed session failed: ${detail}`,
    "",
    "Final option (explicit):",
    "- CDPConnect (default port): npx opendevbrowser connect --cdp-port 9222",
    "- CDPConnect (explicit WS): npx opendevbrowser connect --ws-endpoint ws://127.0.0.1:9222/devtools/browser/<id>"
  ].join("\n");
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing ${label}`);
  }
  return value;
}

function requireStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`Invalid ${label}`);
  }
  return value as string[];
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function optionalStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value as string[]
    : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function requireWaitUntil(value: unknown): "domcontentloaded" | "load" | "networkidle" {
  if (value === "domcontentloaded" || value === "load" || value === "networkidle") {
    return value;
  }
  return "load";
}

function requireSnapshotMode(value: unknown): "outline" | "actionables" {
  if (value === "actionables") return "actionables";
  return "outline";
}

function requireState(value: unknown): "attached" | "visible" | "hidden" {
  if (value === "visible" || value === "hidden") return value;
  return "attached";
}

type RelayObservedStatus = {
  instanceId: string;
  running: boolean;
  port?: number;
  extensionConnected: boolean;
  extensionHandshakeComplete: boolean;
  cdpConnected: boolean;
  pairingRequired: boolean;
};

async function waitForRelayAny(
  relay: { status: () => { extensionConnected: boolean } },
  observedPort: number | null,
  timeoutMs: number
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (relay.status().extensionConnected) {
      return true;
    }
    const observedStatus = await fetchRelayObservedStatus(observedPort);
    if (observedStatus?.extensionConnected) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

function resolveObservedPort(relayStatus: { port?: number }, configPort: number): number | null {
  if (isValidPort(relayStatus.port)) return relayStatus.port;
  if (isValidPort(configPort)) return configPort;
  return null;
}

function isValidPort(port: unknown): port is number {
  return typeof port === "number" && Number.isInteger(port) && port > 0 && port <= 65535;
}

async function fetchRelayObservedStatus(port: number | null): Promise<RelayObservedStatus | null> {
  if (!isValidPort(port)) {
    return null;
  }
  try {
    const response = await fetch(`http://127.0.0.1:${port}/status`);
    if (!response.ok) {
      return null;
    }
    const data = await response.json();
    if (!data || typeof data !== "object") {
      return null;
    }
    const record = data as Record<string, unknown>;
    if (typeof record.instanceId !== "string") {
      return null;
    }
    return {
      instanceId: record.instanceId,
      running: Boolean(record.running),
      port: typeof record.port === "number" ? record.port : undefined,
      extensionConnected: Boolean(record.extensionConnected),
      extensionHandshakeComplete: Boolean(record.extensionHandshakeComplete),
      cdpConnected: Boolean(record.cdpConnected),
      pairingRequired: Boolean(record.pairingRequired)
    };
  } catch {
    return null;
  }
}
