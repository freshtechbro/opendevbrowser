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
      return core.manager.connect({
        wsEndpoint: optionalString(params.wsEndpoint),
        host: optionalString(params.host),
        port: optionalNumber(params.port)
      });
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
  const relayUrl = core.relay.getCdpUrl();
  const noExtension = optionalBoolean(params.noExtension) ?? false;
  const extensionOnly = optionalBoolean(params.extensionOnly) ?? false;
  const waitForExtension = optionalBoolean(params.waitForExtension) ?? false;
  const waitTimeoutMs = optionalNumber(params.waitTimeoutMs) ?? 30000;

  if (waitForExtension) {
    const connected = await waitForRelay(core.relay, waitTimeoutMs);
    if (connected) {
      relayStatus = core.relay.status();
    }
  }

  const useRelay = Boolean(!noExtension && relayStatus.extensionConnected && relayUrl);
  let relayWarning: string | null = null;

  if (extensionOnly && !useRelay) {
    throw new Error("Extension not connected; use --no-extension to launch a new browser.");
  }

  if (useRelay && relayUrl) {
    try {
      const result = await core.manager.connectRelay(relayUrl);
      return { ...result, warnings: result.warnings ?? [] };
    } catch (error) {
      if (extensionOnly) {
        throw error instanceof Error ? error : new Error("Extension relay connection failed.");
      }
      relayWarning = "Relay connection failed; falling back to managed Chrome.";
    }
  }

  if (relayUrl && !noExtension) {
    relayWarning ??= "Extension not connected; launching managed Chrome instead.";
  }

  const result = await core.manager.launch({
    profile: optionalString(params.profile),
    headless: optionalBoolean(params.headless),
    startUrl: optionalString(params.startUrl),
    chromePath: optionalString(params.chromePath),
    flags: optionalStringArray(params.flags),
    persistProfile: optionalBoolean(params.persistProfile)
  });

  const warnings = [
    ...(result.warnings ?? []),
    ...(relayWarning ? [relayWarning] : [])
  ];
  return { ...result, warnings };
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

async function waitForRelay(relay: { status: () => { extensionConnected: boolean } }, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (relay.status().extensionConnected) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}
