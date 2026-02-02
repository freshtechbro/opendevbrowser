import type { OpenDevBrowserCore } from "../core";
import {
  bindRelay,
  waitForBinding,
  releaseRelay,
  renewRelay,
  requireBinding,
  registerSessionLease,
  getSessionLease,
  requireSessionLease,
  releaseSessionLease,
  touchSessionLease,
  getBindingRenewConfig,
  getHubInstanceId
} from "./daemon-state";
import { fetchWithTimeout } from "./utils/http";

export type DaemonCommandRequest = {
  name: string;
  params?: Record<string, unknown>;
};

export async function handleDaemonCommand(core: OpenDevBrowserCore, request: DaemonCommandRequest): Promise<unknown> {
  const params = request.params ?? {};
  const bindingId = optionalString(params.bindingId);

  switch (request.name) {
    case "relay.status":
      return core.relay.status();
    case "relay.cdpUrl":
      return core.relay.getCdpUrl();
    case "relay.annotationUrl":
      return core.relay.getAnnotationUrl?.() ?? null;
    case "relay.opsUrl":
      return core.relay.getOpsUrl?.() ?? null;
    case "relay.bind": {
      const clientId = requireClientId(params);
      const binding = bindRelay(clientId);
      const relayStatus = core.relay.status();
      return {
        ...binding,
        hubInstanceId: getHubInstanceId(),
        relayInstanceId: relayStatus.instanceId,
        relayPort: relayStatus.port ?? null,
        bindingConfig: getBindingRenewConfig()
      };
    }
    case "relay.wait": {
      const clientId = requireClientId(params);
      const timeoutMs = optionalNumber(params.timeoutMs, "timeoutMs");
      const binding = await waitForBinding(clientId, timeoutMs);
      const relayStatus = core.relay.status();
      return {
        ...binding,
        hubInstanceId: getHubInstanceId(),
        relayInstanceId: relayStatus.instanceId,
        relayPort: relayStatus.port ?? null,
        bindingConfig: getBindingRenewConfig()
      };
    }
    case "relay.renew": {
      const clientId = requireClientId(params);
      const binding = renewRelay(clientId, requireString(bindingId, "bindingId"));
      const relayStatus = core.relay.status();
      return {
        ...binding,
        hubInstanceId: getHubInstanceId(),
        relayInstanceId: relayStatus.instanceId,
        relayPort: relayStatus.port ?? null,
        bindingConfig: getBindingRenewConfig()
      };
    }
    case "relay.release": {
      const clientId = requireClientId(params);
      return releaseRelay(clientId, requireString(bindingId, "bindingId"));
    }
    case "session.launch":
      return launchWithRelay(core, params, requireClientId(params), bindingId);
    case "session.connect":
      return connectWithRelayRouting(core, params, requireClientId(params), bindingId);
    case "session.disconnect":
      return disconnectSession(core, params, requireClientId(params), bindingId);
    case "session.status":
      await authorizeSessionCommand(core, params, request.name, bindingId);
      return core.manager.status(requireString(params.sessionId, "sessionId"));
    case "annotate": {
      const sessionId = requireString(params.sessionId, "sessionId");
      const clientId = requireClientId(params);
      const status = await core.manager.status(sessionId);
      const transport = requireAnnotationTransport(params.transport);
      if (status.mode === "extension") {
        requireBinding(clientId, bindingId);
      }
      if (transport === "relay" && status.mode !== "extension") {
        throw new Error("Relay annotations require extension mode.");
      }
      const url = optionalString(params.url);
      const targetId = optionalString(params.targetId);
      const tabId = optionalNumber(params.tabId, "tabId");
      const screenshotMode = requireScreenshotMode(params.screenshotMode);
      const debug = optionalBoolean(params.debug) ?? false;
      const context = optionalString(params.context);
      const timeoutMs = optionalNumber(params.timeoutMs, "timeoutMs");
      return core.annotationManager.requestAnnotation({
        sessionId,
        transport,
        targetId,
        tabId,
        url,
        screenshotMode,
        debug,
        context,
        timeoutMs
      });
    }
    case "targets.list":
      await authorizeSessionCommand(core, params, request.name, bindingId);
      return core.manager.listTargets(
        requireString(params.sessionId, "sessionId"),
        optionalBoolean(params.includeUrls) ?? false
      );
    case "targets.use":
      await authorizeSessionCommand(core, params, request.name, bindingId);
      return core.manager.useTarget(
        requireString(params.sessionId, "sessionId"),
        requireString(params.targetId, "targetId")
      );
    case "targets.new":
      await authorizeSessionCommand(core, params, request.name, bindingId);
      return core.manager.newTarget(
        requireString(params.sessionId, "sessionId"),
        optionalString(params.url)
      );
    case "targets.close":
      await authorizeSessionCommand(core, params, request.name, bindingId);
      await core.manager.closeTarget(
        requireString(params.sessionId, "sessionId"),
        requireString(params.targetId, "targetId")
      );
      return { ok: true };
    case "page.open":
      await authorizeSessionCommand(core, params, request.name, bindingId);
      return core.manager.page(
        requireString(params.sessionId, "sessionId"),
        requireString(params.name, "name"),
        optionalString(params.url)
      );
    case "page.list":
      await authorizeSessionCommand(core, params, request.name, bindingId);
      return core.manager.listPages(requireString(params.sessionId, "sessionId"));
    case "page.close":
      await authorizeSessionCommand(core, params, request.name, bindingId);
      await core.manager.closePage(
        requireString(params.sessionId, "sessionId"),
        requireString(params.name, "name")
      );
      return { ok: true };
    case "nav.goto":
      await authorizeSessionCommand(core, params, request.name, bindingId);
      return core.manager.goto(
        requireString(params.sessionId, "sessionId"),
        requireString(params.url, "url"),
        requireWaitUntil(params.waitUntil),
        optionalNumber(params.timeoutMs, "timeoutMs") ?? 30000
      );
    case "nav.wait":
      await authorizeSessionCommand(core, params, request.name, bindingId);
      if (typeof params.ref === "string") {
        return core.manager.waitForRef(
          requireString(params.sessionId, "sessionId"),
          requireString(params.ref, "ref"),
          requireState(params.state),
          optionalNumber(params.timeoutMs, "timeoutMs") ?? 30000
        );
      }
      return core.manager.waitForLoad(
        requireString(params.sessionId, "sessionId"),
        requireWaitUntil(params.until),
        optionalNumber(params.timeoutMs, "timeoutMs") ?? 30000
      );
    case "nav.snapshot":
      await authorizeSessionCommand(core, params, request.name, bindingId);
      return core.manager.snapshot(
        requireString(params.sessionId, "sessionId"),
        requireSnapshotMode(params.mode),
        optionalNumber(params.maxChars, "maxChars") ?? 16000,
        optionalString(params.cursor)
      );
    case "interact.click":
      await authorizeSessionCommand(core, params, request.name, bindingId);
      return core.manager.click(
        requireString(params.sessionId, "sessionId"),
        requireString(params.ref, "ref")
      );
    case "interact.hover":
      await authorizeSessionCommand(core, params, request.name, bindingId);
      return core.manager.hover(
        requireString(params.sessionId, "sessionId"),
        requireString(params.ref, "ref")
      );
    case "interact.press":
      await authorizeSessionCommand(core, params, request.name, bindingId);
      return core.manager.press(
        requireString(params.sessionId, "sessionId"),
        requireString(params.key, "key"),
        optionalString(params.ref)
      );
    case "interact.check":
      await authorizeSessionCommand(core, params, request.name, bindingId);
      return core.manager.check(
        requireString(params.sessionId, "sessionId"),
        requireString(params.ref, "ref")
      );
    case "interact.uncheck":
      await authorizeSessionCommand(core, params, request.name, bindingId);
      return core.manager.uncheck(
        requireString(params.sessionId, "sessionId"),
        requireString(params.ref, "ref")
      );
    case "interact.type":
      await authorizeSessionCommand(core, params, request.name, bindingId);
      return core.manager.type(
        requireString(params.sessionId, "sessionId"),
        requireString(params.ref, "ref"),
        requireString(params.text, "text"),
        optionalBoolean(params.clear) ?? false,
        optionalBoolean(params.submit) ?? false
      );
    case "interact.select":
      await authorizeSessionCommand(core, params, request.name, bindingId);
      return core.manager.select(
        requireString(params.sessionId, "sessionId"),
        requireString(params.ref, "ref"),
        requireStringArray(params.values, "values")
      );
    case "interact.scroll":
      await authorizeSessionCommand(core, params, request.name, bindingId);
      return core.manager.scroll(
        requireString(params.sessionId, "sessionId"),
        optionalNumber(params.dy, "dy") ?? 0,
        optionalString(params.ref)
      );
    case "interact.scrollIntoView":
      await authorizeSessionCommand(core, params, request.name, bindingId);
      return core.manager.scrollIntoView(
        requireString(params.sessionId, "sessionId"),
        requireString(params.ref, "ref")
      );
    case "dom.getHtml":
      await authorizeSessionCommand(core, params, request.name, bindingId);
      return core.manager.domGetHtml(
        requireString(params.sessionId, "sessionId"),
        requireString(params.ref, "ref"),
        optionalNumber(params.maxChars, "maxChars") ?? 8000
      );
    case "dom.getText":
      await authorizeSessionCommand(core, params, request.name, bindingId);
      return core.manager.domGetText(
        requireString(params.sessionId, "sessionId"),
        requireString(params.ref, "ref"),
        optionalNumber(params.maxChars, "maxChars") ?? 8000
      );
    case "dom.getAttr":
      await authorizeSessionCommand(core, params, request.name, bindingId);
      return core.manager.domGetAttr(
        requireString(params.sessionId, "sessionId"),
        requireString(params.ref, "ref"),
        requireString(params.name, "name")
      );
    case "dom.getValue":
      await authorizeSessionCommand(core, params, request.name, bindingId);
      return core.manager.domGetValue(
        requireString(params.sessionId, "sessionId"),
        requireString(params.ref, "ref")
      );
    case "dom.isVisible":
      await authorizeSessionCommand(core, params, request.name, bindingId);
      return core.manager.domIsVisible(
        requireString(params.sessionId, "sessionId"),
        requireString(params.ref, "ref")
      );
    case "dom.isEnabled":
      await authorizeSessionCommand(core, params, request.name, bindingId);
      return core.manager.domIsEnabled(
        requireString(params.sessionId, "sessionId"),
        requireString(params.ref, "ref")
      );
    case "dom.isChecked":
      await authorizeSessionCommand(core, params, request.name, bindingId);
      return core.manager.domIsChecked(
        requireString(params.sessionId, "sessionId"),
        requireString(params.ref, "ref")
      );
    case "export.clonePage":
      await authorizeSessionCommand(core, params, request.name, bindingId);
      return core.manager.clonePage(requireString(params.sessionId, "sessionId"));
    case "export.cloneComponent":
      await authorizeSessionCommand(core, params, request.name, bindingId);
      return core.manager.cloneComponent(
        requireString(params.sessionId, "sessionId"),
        requireString(params.ref, "ref")
      );
    case "devtools.perf":
      await authorizeSessionCommand(core, params, request.name, bindingId);
      return core.manager.perfMetrics(requireString(params.sessionId, "sessionId"));
    case "page.screenshot":
      await authorizeSessionCommand(core, params, request.name, bindingId);
      return core.manager.screenshot(
        requireString(params.sessionId, "sessionId"),
        optionalString(params.path)
      );
    case "devtools.consolePoll":
      await authorizeSessionCommand(core, params, request.name, bindingId);
      return core.manager.consolePoll(
        requireString(params.sessionId, "sessionId"),
        optionalNumber(params.sinceSeq, "sinceSeq"),
        optionalNumber(params.max, "max") ?? 50
      );
    case "devtools.networkPoll":
      await authorizeSessionCommand(core, params, request.name, bindingId);
      return core.manager.networkPoll(
        requireString(params.sessionId, "sessionId"),
        optionalNumber(params.sinceSeq, "sinceSeq"),
        optionalNumber(params.max, "max") ?? 50
      );
    default:
      throw new Error(`Unknown daemon command: ${request.name}`);
  }
}

async function launchWithRelay(
  core: OpenDevBrowserCore,
  params: Record<string, unknown>,
  clientId: string,
  bindingId?: string
) {
  let relayStatus = core.relay.status();
  const extensionLegacy = optionalBoolean(params.extensionLegacy) ?? false;
  let relayUrl = extensionLegacy ? core.relay.getCdpUrl() : core.relay.getOpsUrl?.() ?? null;
  const relayPort = core.config.relayPort;
  const noExtension = optionalBoolean(params.noExtension) ?? false;
  const extensionOnly = optionalBoolean(params.extensionOnly) ?? false;
  const waitForExtension = optionalBoolean(params.waitForExtension) ?? false;
  const headlessExplicit = optionalBoolean(params.headless) === true;
  const managedExplicit = Boolean(noExtension || headlessExplicit);
  const managedHeadless = headlessExplicit ? true : false;
  const waitTimeoutMs = clampWaitTimeout(optionalNumber(params.waitTimeoutMs, "waitTimeoutMs") ?? 30000);

  if (!managedExplicit && extensionLegacy) {
    requireBinding(clientId, bindingId);
  }

  if (waitForExtension && !managedExplicit) {
    const observedPort = resolveObservedPort(relayStatus, relayPort);
    const connected = await waitForRelayHandshake(core.relay, observedPort, waitTimeoutMs);
    if (connected) {
      relayStatus = core.relay.status();
      relayUrl = extensionLegacy ? core.relay.getCdpUrl() ?? relayUrl : core.relay.getOpsUrl?.() ?? relayUrl;
    }
  }

  const observedPort = resolveObservedPort(relayStatus, relayPort);
  const shouldFetchObserved = !managedExplicit && (!relayUrl || !(relayStatus.extensionHandshakeComplete || relayStatus.extensionConnected));
  const observedStatus = shouldFetchObserved ? await fetchRelayObservedStatus(observedPort) : null;
  if (!relayUrl) {
    const fallbackPort = isValidPort(observedStatus?.port) ? observedStatus?.port : observedPort;
    relayUrl = fallbackPort ? `ws://127.0.0.1:${fallbackPort}/${extensionLegacy ? "cdp" : "ops"}` : null;
  }
  const extensionReady = Boolean(
    relayUrl && (
      relayStatus.extensionHandshakeComplete ||
      observedStatus?.extensionHandshakeComplete ||
      relayStatus.extensionConnected ||
      observedStatus?.extensionConnected
    )
  );
  const diagnostics = observedStatus
    ? `Diagnostics: relayPort=${observedPort ?? "?"} instance=${observedStatus.instanceId.slice(0, 8)} ext=${observedStatus.extensionConnected} handshake=${observedStatus.extensionHandshakeComplete} ops=${observedStatus.opsConnected} cdp=${observedStatus.cdpConnected}`
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
      const leaseId = extractLeaseId(result);
      if (result.mode === "extension" && leaseId) {
        registerSessionLease(result.sessionId, leaseId, clientId);
      }
      return { ...result, warnings: result.warnings ?? [], ...(leaseId ? { leaseId } : {}) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const unauthorized = message.toLowerCase().includes("unauthorized") || message.includes("401");
      const relayLabel = extensionLegacy ? "/cdp" : "/ops";
      const reason = unauthorized
        ? `Extension relay connection failed: relay ${relayLabel} unauthorized (token mismatch).`
        : `Extension relay connection failed: ${message}`;
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

async function connectWithRelayRouting(
  core: OpenDevBrowserCore,
  params: Record<string, unknown>,
  clientId: string,
  bindingId?: string
) {
  const wsEndpoint = optionalString(params.wsEndpoint);
  const extensionLegacy = optionalBoolean(params.extensionLegacy) ?? false;
  const relayUrl = extensionLegacy ? core.relay.getCdpUrl() : core.relay.getOpsUrl?.() ?? null;
  const normalizedOpsEndpoint = normalizeRelayEndpoint(wsEndpoint, "ops", true);
  const normalizedLegacyEndpoint = normalizeRelayEndpoint(wsEndpoint, "cdp", false);
  const relayEndpoint = relayUrl && wsEndpoint === relayUrl ? relayUrl : normalizedOpsEndpoint ?? (extensionLegacy ? normalizedLegacyEndpoint : null);

  const hasExplicitCdp = Boolean(wsEndpoint || params.host || params.port);
  if (normalizedLegacyEndpoint && !extensionLegacy) {
    throw new Error("Legacy extension relay (/cdp) requires --extension-legacy.");
  }

  if (relayEndpoint || (!hasExplicitCdp && relayUrl)) {
    if (extensionLegacy) {
      requireBinding(clientId, bindingId);
    }
    const result = await core.manager.connectRelay(relayEndpoint ?? relayUrl ?? "");
    const leaseId = extractLeaseId(result);
    if (result.mode === "extension" && leaseId) {
      registerSessionLease(result.sessionId, leaseId, clientId);
    }
    return { ...result, ...(leaseId ? { leaseId } : {}) };
  }

  if (!hasExplicitCdp) {
    throw new Error("Extension relay not available. Connect the extension or pass --cdp-port/--ws-endpoint.");
  }

  return core.manager.connect({
    wsEndpoint,
    host: optionalString(params.host),
    port: optionalNumber(params.port, "port")
  });
}

async function disconnectSession(
  core: OpenDevBrowserCore,
  params: Record<string, unknown>,
  clientId: string,
  bindingId?: string
): Promise<{ ok: true; bindingReleased?: boolean }> {
  const sessionId = requireString(params.sessionId, "sessionId");
  const status = await core.manager.status(sessionId);
  if (status.mode === "extension") {
    const lease = getSessionLease(sessionId);
    if (lease) {
      requireSessionLease(sessionId, clientId, optionalString(params.leaseId));
    } else {
      requireBinding(clientId, bindingId);
    }
  }
  await core.manager.disconnect(sessionId, optionalBoolean(params.closeBrowser) ?? false);
  releaseSessionLease(sessionId);
  if (status.mode === "extension" && bindingId) {
    releaseRelay(clientId, bindingId);
    return { ok: true, bindingReleased: true };
  }
  return { ok: true };
}

async function authorizeSessionCommand(
  core: OpenDevBrowserCore,
  params: Record<string, unknown>,
  commandName: string,
  bindingId?: string
): Promise<void> {
  const sessionId = optionalString(params.sessionId);
  if (!sessionId) return;
  const clientId = requireClientId(params);
  const lease = getSessionLease(sessionId);
  if (lease) {
    const leaseId = optionalString(params.leaseId);
    if (lease.clientId === clientId && leaseId === lease.leaseId) {
      touchSessionLease(sessionId);
      return;
    }
    if (isReadOnlyCommand(commandName)) {
      return;
    }
    if (!leaseId) {
      throw new Error("RELAY_LEASE_REQUIRED: leaseId is required for session operations.");
    }
    throw new Error("RELAY_LEASE_INVALID: Lease does not match session owner.");
  }
  const status = await core.manager.status(sessionId);
  if (status.mode !== "extension") {
    return;
  }
  requireBinding(clientId, bindingId);
}

const READ_ONLY_COMMANDS = new Set([
  "nav.snapshot",
  "dom.getHtml",
  "dom.getText",
  "dom.getAttr",
  "dom.getValue",
  "dom.isVisible",
  "dom.isEnabled",
  "dom.isChecked"
]);

function isReadOnlyCommand(commandName: string): boolean {
  return READ_ONLY_COMMANDS.has(commandName);
}

function extractLeaseId(result: unknown): string | undefined {
  if (!result || typeof result !== "object") return undefined;
  const leaseId = (result as Record<string, unknown>).leaseId;
  return typeof leaseId === "string" ? leaseId : undefined;
}

function buildExtensionMissingMessage(reason: string): string {
  return [
    reason,
    "Connect the extension: open the Chrome extension popup and click Connect, then retry.",
    "Tip: If the popup says Connected, it may be connected to a different relay instance/port than the daemon expects.",
    "Legend: ext=extension websocket, handshake=extension handshake, ops=active /ops client, cdp=active /cdp client, pairing=token required.",
    "",
    "Other options (explicit):",
    "- Managed (headed): npx opendevbrowser launch --no-extension",
    "- Managed (headless): npx opendevbrowser launch --no-extension --headless",
    "- Legacy extension relay: npx opendevbrowser launch --extension-legacy",
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

function requireClientId(params: Record<string, unknown>): string {
  return requireString(params.clientId, "clientId");
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

function optionalNumber(value: unknown, label: string): number | undefined {
  if (typeof value === "undefined") {
    return undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  throw new Error(`Invalid ${label}`);
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

function requireScreenshotMode(value: unknown): "visible" | "full" | "none" {
  if (value === "visible" || value === "full" || value === "none") {
    return value;
  }
  return "visible";
}

function requireAnnotationTransport(value: unknown): "auto" | "direct" | "relay" {
  if (value === "auto" || value === "direct" || value === "relay") {
    return value;
  }
  if (typeof value === "undefined") {
    return "auto";
  }
  throw new Error("Invalid transport");
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
  opsConnected: boolean;
  pairingRequired: boolean;
};

const MIN_WAIT_TIMEOUT_MS = 3000;
const WAIT_MIN_DELAY_MS = 250;
const WAIT_MAX_DELAY_MS = 2000;
const RELAY_STATUS_TIMEOUT_MS = 1500;

function clampWaitTimeout(timeoutMs: number): number {
  if (!Number.isFinite(timeoutMs)) {
    return MIN_WAIT_TIMEOUT_MS;
  }
  return Math.max(timeoutMs, MIN_WAIT_TIMEOUT_MS);
}

async function waitForRelayHandshake(
  relay: { status: () => { extensionHandshakeComplete: boolean } },
  observedPort: number | null,
  timeoutMs: number
): Promise<boolean> {
  const start = Date.now();
  let delay = WAIT_MIN_DELAY_MS;
  while (Date.now() - start < timeoutMs) {
    if (relay.status().extensionHandshakeComplete) {
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
    const response = await fetchWithTimeout(
      `http://127.0.0.1:${port}/status`,
      undefined,
      RELAY_STATUS_TIMEOUT_MS
    );
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
      opsConnected: Boolean(record.opsConnected),
      pairingRequired: Boolean(record.pairingRequired)
    };
  } catch {
    return null;
  }
}
