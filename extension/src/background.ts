import { ConnectionManager } from "./services/ConnectionManager.js";
import { NativePortManager } from "./services/NativePortManager.js";
import {
  DEFAULT_AUTO_CONNECT,
  DEFAULT_AUTO_PAIR,
  DEFAULT_DISCOVERY_PORT,
  DEFAULT_PAIRING_ENABLED,
  DEFAULT_RELAY_PORT
} from "./relay-settings.js";
import { logError } from "./logging.js";
import { OpsRuntime } from "./ops/ops-runtime.js";
import type {
  AnnotationCommand,
  AnnotationErrorCode,
  AnnotationPayload,
  AnnotationResponse,
  AnnotationScreenshotMode,
  BackgroundMessage,
  ConnectionStatus,
  NativeTransportHealth,
  PopupAnnotationGetPayloadResponse,
  PopupAnnotationLastMetaResponse,
  PopupAnnotationMeta,
  PopupAnnotationStartResponse,
  PopupMessage,
  RelayAnnotationCommand,
  RelayAnnotationEvent,
  RelayAnnotationResponse,
  RelayHealthStatus
} from "./types.js";

const connection = new ConnectionManager();
const opsRuntime = new OpsRuntime({
  send: (message) => connection.sendOpsMessage(message),
  cdp: connection.getCdpRouter()
});
const nativePort = new NativePortManager({
  onMessage: (payload) => {
    handleNativePortMessage(payload).catch((error) => {
      logError("native_port.message", error, { code: "native_message_failed" });
    });
  },
  onDisconnect: () => {
    updateBadge(getEffectiveStatus());
  }
});
let autoConnectInFlight = false;
let statusNoteOverride: string | null = null;
let retryScheduled = false;
let retryDelayMs = 5000;

const RETRY_ALARM_NAME = "opendevbrowser-auto-connect";
const RETRY_MAX_MS = 60_000;
const ANNOTATION_CONTENT_SCRIPT = "dist/annotate-content.js";
const ANNOTATION_CONTENT_STYLE = "dist/annotate-content.css";
const ANNOTATION_MAX_PAYLOAD_BYTES = 10 * 1024 * 1024;
const ANNOTATION_REQUEST_TIMEOUT_MS = 120_000;
const LAST_ANNOTATION_META_KEY = "annotationLastMeta";
const LAST_ANNOTATION_PAYLOAD_KEY = "annotationLastPayloadSansScreenshots";

type AnnotationTransport = "relay" | "native" | "popup";

type AnnotationSession = {
  requestId: string;
  tabId: number;
  options?: AnnotationCommand["options"];
  createdAt: number;
  timeoutId: number;
  transport: AnnotationTransport;
};

const annotationSessions = new Map<string, AnnotationSession>();
let lastAnnotationFull: { meta: PopupAnnotationMeta; payload: AnnotationPayload } | null = null;

connection.onAnnotationCommand((command) => {
  handleRelayAnnotationCommand(command).catch((error) => {
    logError("annotation.relay_command", error, { code: "annotation_command_failed" });
  });
});

connection.onOpsMessage((message) => {
  opsRuntime.handleMessage(message);
});

const RESTRICTED_PROTOCOLS = new Set([
  "chrome:",
  "chrome-extension:",
  "chrome-search:",
  "chrome-untrusted:",
  "devtools:",
  "chrome-devtools:",
  "edge:",
  "brave:"
]);

type RelayConfig = {
  relayPort: number;
  pairingRequired: boolean;
  instanceId: string | null;
  epoch: number | null;
};

type ContentScriptMessage =
  | {
    type: "annotation:capture";
    requestId: string;
    mode: AnnotationScreenshotMode;
  }
  | {
    type: "annotation:complete";
    requestId: string;
    payload: AnnotationPayload;
  }
  | {
    type: "annotation:cancelled";
    requestId: string;
  }
  | {
    type: "annotation:error";
    requestId: string;
    error: { code: AnnotationErrorCode; message: string };
  };

const updateBadge = (status: ConnectionStatus): void => {
  const isConnected = status === "connected";
  chrome.action.setBadgeText({ text: isConnected ? "ON" : "OFF" });
  chrome.action.setBadgeBackgroundColor({
    color: isConnected ? "#20d5c6" : "#5b667a"
  });
};

const getEffectiveStatus = (): ConnectionStatus => {
  if (connection.getStatus() === "connected") {
    return "connected";
  }
  if (nativePort.isConnected()) {
    return "connected";
  }
  return "disconnected";
};

const buildStatusMessage = async (): Promise<BackgroundMessage> => {
  const error = connection.getLastError();
  const relayStatus = connection.getStatus();
  const status = getEffectiveStatus();
  let note = error?.message;
  let relayHealth: RelayHealthStatus | null = null;
  let nativeHealth: NativeTransportHealth | null = nativePort.getHealth();

  if (nativePort.isConnected()) {
    try {
      await nativePort.ping(1000);
    } catch (error) {
      logError("native_port.ping", error, { code: "native_ping_failed" });
    }
    nativeHealth = nativePort.getHealth();
  }

  if (!error) {
    if (relayStatus === "connected") {
      const identity = connection.getRelayIdentity();
      if (identity.relayPort && identity.instanceId) {
        note = `Connected to 127.0.0.1:${identity.relayPort} (relay ${identity.instanceId.slice(0, 8)})`;
      } else if (identity.relayPort) {
        note = `Connected to 127.0.0.1:${identity.relayPort}`;
      }
      relayHealth = await connection.relayHealthCheck();
    } else if (nativeHealth?.status === "connected") {
      note = "Connected via native host.";
    } else {
      const stored = await new Promise<Record<string, unknown>>((resolve) => {
        chrome.storage.local.get(["relayPort"], (items) => resolve(items));
      });
      const port = parsePort(stored.relayPort) ?? DEFAULT_RELAY_PORT;
      relayHealth = await fetchRelayHealth(port);
      note = statusNoteOverride ?? buildRelayHealthNote(relayHealth);
      if (!statusNoteOverride && nativeHealth?.status === "error") {
        note = buildNativeHealthNote(nativeHealth);
      }
    }
  }

  if (!error) {
    const relayNotice = connection.getRelayNotice();
    if (relayNotice) {
      note = relayNotice;
    }
  }

  return {
    type: "status",
    status,
    note,
    relayHealth,
    nativeHealth
  };
};

const setStorage = (items: Record<string, unknown>): Promise<void> => {
  return new Promise((resolve) => {
    chrome.storage.local.set(items, () => resolve());
  });
};

const setStatusNoteOverride = (note: string | null): void => {
  statusNoteOverride = note;
};

const buildRelayHealthNote = (health: RelayHealthStatus | null): string => {
  if (!health) {
    return "Relay unreachable. Start the daemon and retry.";
  }
  switch (health.reason) {
    case "pairing_invalid":
      return "Pairing token mismatch. Update the token and reconnect.";
    case "pairing_required":
      return "Pairing required. Enable auto-pair or set the token.";
    case "handshake_incomplete":
      return "Extension handshake pending. Keep the relay running and retry.";
    case "extension_disconnected":
      return "Extension not connected to relay. Click Connect.";
    case "annotation_disconnected":
      return "Annotation channel disconnected. Keep the extension open and retry.";
    case "ops_disconnected":
      return "Ops channel disconnected. Start a new session and retry.";
    case "cdp_disconnected":
      return "No CDP clients connected. Start a session and retry.";
    case "relay_down":
      return "Relay down. Start the daemon and retry.";
    default:
      return "Local relay only. Tokens stay on-device.";
  }
};

const buildNativeHealthNote = (health: NativeTransportHealth): string => {
  if (health.status === "connected") {
    return "Native host connected.";
  }
  switch (health.error) {
    case "host_not_installed":
      return "Native host not installed. Run `opendevbrowser native install <extension-id>`.";
    case "host_forbidden":
      return "Native host forbidden. Verify the extension ID matches the manifest.";
    case "host_disconnect":
      return "Native host disconnected. Restart the host.";
    case "host_timeout":
      return "Native host ping timed out.";
    case "host_message_too_large":
      return "Native host rejected message size.";
    default:
      return "Native host unavailable.";
  }
};

const clearRetry = (): void => {
  retryScheduled = false;
  retryDelayMs = 5000;
  if (chrome.alarms?.clear) {
    chrome.alarms.clear(RETRY_ALARM_NAME);
  }
};

const scheduleRetry = (): void => {
  if (retryScheduled) {
    return;
  }
  retryScheduled = true;
  const delayMs = retryDelayMs;
  retryDelayMs = Math.min(retryDelayMs * 2, RETRY_MAX_MS);

  if (chrome.alarms?.create) {
    chrome.alarms.create(RETRY_ALARM_NAME, { when: Date.now() + delayMs });
    return;
  }

  setTimeout(() => {
    retryScheduled = false;
    autoConnect().catch((error) => {
      logError("auto_connect.retry", error, { code: "auto_connect_failed" });
    });
  }, delayMs);
};

const attemptNativeConnect = async (): Promise<boolean> => {
  const connected = await nativePort.connect();
  if (!connected) {
    return false;
  }
  try {
    await nativePort.ping(1500);
  } catch (error) {
    logError("native_port.ping", error, { code: "native_ping_failed" });
  }
  updateBadge(getEffectiveStatus());
  return nativePort.isConnected();
};

const parsePort = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 65535) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535) {
      return parsed;
    }
  }
  return null;
};

const parseEpoch = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return null;
};

const isWebStoreUrl = (url: URL): boolean => {
  if (url.hostname === "chromewebstore.google.com") {
    return true;
  }
  if (url.hostname === "chrome.google.com" && url.pathname.startsWith("/webstore")) {
    return true;
  }
  return false;
};

const getRestrictionMessage = (url: URL): string | null => {
  if (RESTRICTED_PROTOCOLS.has(url.protocol)) {
    return "Active tab uses a restricted URL scheme. Open a normal http(s) page and retry.";
  }
  if (isWebStoreUrl(url)) {
    return "Chrome Web Store tabs cannot be annotated. Open a normal tab and retry.";
  }
  return null;
};

const fetchRelayConfig = async (port: number): Promise<RelayConfig | null> => {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/config`, {
      method: "GET",
      headers: { "Accept": "application/json" }
    });
    if (!response.ok) {
      return null;
    }
    const data = await response.json();
    const relayPort = parsePort(data.relayPort);
    if (!relayPort) {
      return null;
    }
    const pairingRequired = typeof data.pairingRequired === "boolean" ? data.pairingRequired : true;
    const instanceId = typeof data.instanceId === "string" ? data.instanceId : null;
    const epoch = parseEpoch(data.epoch);
    return { relayPort, pairingRequired, instanceId, epoch };
  } catch (error) {
    logError("relay.config_fetch", error, { code: "relay_config_fetch_failed", extra: { port } });
    return null;
  }
};

const fetchRelayHealth = async (port: number): Promise<RelayHealthStatus | null> => {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/status`, {
      method: "GET",
      headers: { "Accept": "application/json" }
    });
    if (!response.ok) {
      return null;
    }
    const data = await response.json() as Record<string, unknown>;
    if (data.health && typeof data.health === "object") {
      return data.health as RelayHealthStatus;
    }
    const extensionConnected = data.extensionConnected === true;
    const handshake = data.extensionHandshakeComplete === true;
    const cdpConnected = data.cdpConnected === true;
    const annotationConnected = data.annotationConnected === true;
    const opsConnected = data.opsConnected === true;
    const pairingRequired = data.pairingRequired === true;
    const ok = extensionConnected && handshake;
    return {
      ok,
      reason: ok ? "ok" : (extensionConnected ? "handshake_incomplete" : "extension_disconnected"),
      extensionConnected,
      extensionHandshakeComplete: handshake,
      cdpConnected,
      annotationConnected,
      opsConnected,
      pairingRequired
    };
  } catch (error) {
    logError("relay.health_fetch", error, { code: "relay_health_fetch_failed", extra: { port } });
    return null;
  }
};

const sendAnnotationResponse = (payload: AnnotationResponse, transport: AnnotationTransport = "relay"): void => {
  if (transport === "popup") {
    return;
  }
  const response: RelayAnnotationResponse = { type: "annotationResponse", payload };
  if (transport === "native") {
    nativePort.send(response);
    return;
  }
  connection.sendAnnotationResponse(response);
};

const sendAnnotationEvent = (payload: RelayAnnotationEvent["payload"], transport: AnnotationTransport = "relay"): void => {
  if (transport === "popup") {
    return;
  }
  const event: RelayAnnotationEvent = { type: "annotationEvent", payload };
  if (transport === "native") {
    nativePort.send(event);
    return;
  }
  connection.sendAnnotationEvent(event);
};

const startAnnotationTimeout = (requestId: string, transport: AnnotationTransport): number => {
  return setTimeout(() => {
    const session = annotationSessions.get(requestId);
    if (!session) return;
    annotationSessions.delete(requestId);
    const response: AnnotationResponse = {
      version: 1,
      requestId,
      status: "error",
      error: { code: "timeout", message: "Annotation request timed out." }
    };
    const meta = buildLastAnnotationMeta(requestId, response, false);
    lastAnnotationFull = null;
    persistLastAnnotation(meta, null).catch((error) => {
      logError("annotation.persist_timeout_meta", error, { code: "annotation_persist_failed" });
    });
    sendAnnotationResponse(response, transport);
  }, ANNOTATION_REQUEST_TIMEOUT_MS);
};

const getTab = async (tabId: number): Promise<chrome.tabs.Tab | null> => {
  try {
    return await chrome.tabs.get(tabId);
  } catch (error) {
    logError("tabs.get", error, { code: "tab_lookup_failed", extra: { tabId } });
    return null;
  }
};

const createTab = async (url?: string): Promise<chrome.tabs.Tab> => {
  return await new Promise((resolve, reject) => {
    chrome.tabs.create({ url, active: true }, (tab) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message));
        return;
      }
      if (!tab) {
        reject(new Error("Tab creation failed"));
        return;
      }
      resolve(tab);
    });
  });
};

const updateTabUrl = async (tabId: number, url: string): Promise<chrome.tabs.Tab> => {
  return await new Promise((resolve, reject) => {
    chrome.tabs.update(tabId, { url, active: true }, (tab) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message));
        return;
      }
      if (!tab) {
        reject(new Error("Tab update failed"));
        return;
      }
      resolve(tab);
    });
  });
};

const waitForTabComplete = async (tabId: number, timeoutMs = 10000): Promise<void> => {
  const tab = await getTab(tabId);
  if (tab?.status === "complete") return;
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("Tab load timeout"));
    }, timeoutMs);

    const listener = (updatedId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
      if (updatedId !== tabId) return;
      if (changeInfo.status === "complete") {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
};

const getActiveTab = async (): Promise<chrome.tabs.Tab | null> => {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tabs[0] ?? null;
};

const resolveAnnotationTab = async (command: AnnotationCommand): Promise<chrome.tabs.Tab> => {
  if (typeof command.tabId === "number") {
    if (command.url) {
      const updated = await updateTabUrl(command.tabId, command.url);
      await waitForTabComplete(command.tabId);
      return updated;
    }
    const existing = await getTab(command.tabId);
    if (!existing) {
      throw new Error("Target tab unavailable");
    }
    return existing;
  }

  if (command.url) {
    const created = await createTab(command.url);
    if (typeof created.id === "number") {
      await waitForTabComplete(created.id);
    }
    return created;
  }

  const active = await getActiveTab();
  if (!active) {
    throw new Error("No active tab available");
  }
  return active;
};

const isRestrictedTab = (tab: chrome.tabs.Tab): string | null => {
  if (!tab.url) return "Active tab URL unavailable.";
  let parsed: URL | null = null;
  try {
    parsed = new URL(tab.url);
  } catch (error) {
    logError("annotation.parse_tab_url", error, { code: "tab_url_parse_failed" });
    return "Active tab URL is invalid.";
  }
  return getRestrictionMessage(parsed);
};

const injectAnnotationAssets = async (tabId: number): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    chrome.scripting.insertCSS({ target: { tabId }, files: [ANNOTATION_CONTENT_STYLE] }, () => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message));
        return;
      }
      resolve();
    });
  });

  await new Promise<void>((resolve, reject) => {
    chrome.scripting.executeScript({ target: { tabId }, files: [ANNOTATION_CONTENT_SCRIPT] }, () => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message));
        return;
      }
      resolve();
    });
  });
};

const sendMessageToTab = async (tabId: number, message: Record<string, unknown>): Promise<unknown> => {
  return await new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message));
        return;
      }
      resolve(response);
    });
  });
};

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const pingAnnotation = async (tabId: number): Promise<void> => {
  const response = await sendMessageToTab(tabId, { type: "annotation:ping" });
  const ok = typeof response === "object" && response !== null && (response as { ok?: boolean }).ok === true;
  if (!ok) {
    throw new Error("Annotation ping failed");
  }
};

const ensureAnnotationInjected = async (tabId: number): Promise<void> => {
  try {
    await pingAnnotation(tabId);
    return;
  } catch (error) {
    logError("annotation.ping", error, { code: "annotation_ping_failed", extra: { tabId } });
  }

  const backoff = [150, 400];
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= backoff.length; attempt += 1) {
    try {
      await injectAnnotationAssets(tabId);
      await pingAnnotation(tabId);
      return;
    } catch (error) {
      lastError = error;
      logError("annotation.inject", error, { code: "annotation_injection_failed", extra: { tabId, attempt } });
      if (attempt < backoff.length) {
        const delay = backoff[attempt] ?? 0;
        await sleep(delay);
      }
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error("Annotation injection failed");
};

const probeAnnotationInjected = async (): Promise<{ injected: boolean; detail?: string }> => {
  const active = await getActiveTab();
  if (!active || typeof active.id !== "number") {
    return { injected: false, detail: "No active tab available." };
  }
  const restricted = isRestrictedTab(active);
  if (restricted) {
    return { injected: false, detail: restricted };
  }
  try {
    await pingAnnotation(active.id);
    return { injected: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Annotation not injected.";
    return { injected: false, detail: message };
  }
};

const toggleAnnotationUi = async (): Promise<void> => {
  const tab = await getActiveTab();
  if (!tab || typeof tab.id !== "number") {
    return;
  }
  const restricted = isRestrictedTab(tab);
  if (restricted) {
    return;
  }
  await ensureAnnotationInjected(tab.id);
  await sendMessageToTab(tab.id, { type: "annotation:toggle" });
};

const startAnnotationSession = async (command: AnnotationCommand, transport: AnnotationTransport): Promise<void> => {
  const requestId = command.requestId;
  if (annotationSessions.has(requestId)) {
    sendAnnotationResponse({
      version: 1,
      requestId,
      status: "error",
      error: { code: "invalid_request", message: "Duplicate annotation requestId." }
    }, transport);
    return;
  }

  const tab = await resolveAnnotationTab(command);
  const restricted = isRestrictedTab(tab);
  if (restricted) {
    sendAnnotationResponse({
      version: 1,
      requestId,
      status: "error",
      error: { code: "restricted_url", message: restricted }
    }, transport);
    return;
  }

  if (typeof tab.id !== "number") {
    sendAnnotationResponse({
      version: 1,
      requestId,
      status: "error",
      error: { code: "invalid_request", message: "Target tab missing id." }
    }, transport);
    return;
  }

  let timeoutId: number | null = null;
  try {
    await ensureAnnotationInjected(tab.id);
    timeoutId = startAnnotationTimeout(requestId, transport);
    annotationSessions.set(requestId, {
      requestId,
      tabId: tab.id,
      options: command.options,
      createdAt: Date.now(),
      timeoutId,
      transport
    });
    await sendMessageToTab(tab.id, {
      type: "annotation:start",
      requestId,
      options: command.options ?? {},
      url: command.url
    });
  } catch (error) {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
    annotationSessions.delete(requestId);
    throw error instanceof Error ? error : new Error("Annotation injection failed");
  }
};

const cancelAnnotationSession = async (requestId: string, transport: AnnotationTransport): Promise<void> => {
  const session = annotationSessions.get(requestId);
  if (!session) {
    sendAnnotationResponse({
      version: 1,
      requestId,
      status: "cancelled",
      error: { code: "cancelled", message: "Annotation session not active." }
    }, transport);
    return;
  }
  clearTimeout(session.timeoutId);
  annotationSessions.delete(requestId);
  await sendMessageToTab(session.tabId, { type: "annotation:cancel", requestId });
  sendAnnotationResponse({
    version: 1,
    requestId,
    status: "cancelled",
    error: { code: "cancelled", message: "Annotation cancelled." }
  }, session.transport);
};

const validatePayloadSize = (payload: AnnotationPayload): boolean => {
  const size = new TextEncoder().encode(JSON.stringify(payload)).length;
  return size <= ANNOTATION_MAX_PAYLOAD_BYTES;
};

const generateAnnotationRequestId = (): string => {
  return crypto.randomUUID();
};

const stripScreenshots = (payload: AnnotationPayload): AnnotationPayload => {
  const { screenshots: _screenshots, annotations, ...rest } = payload;
  return {
    ...rest,
    annotations: annotations.map((item) => {
      const { screenshotId: _screenshotId, ...restItem } = item;
      return restItem;
    })
  };
};

const buildLastAnnotationMeta = (
  requestId: string,
  response: AnnotationResponse,
  hasFullPayloadInMemory: boolean
): PopupAnnotationMeta => {
  const payload = response.payload;
  const annotationCount = payload ? payload.annotations.length : undefined;
  const screenshotCount = payload?.screenshots?.length ?? 0;
  return {
    requestId,
    status: response.status,
    error: response.error,
    url: payload?.url,
    title: payload?.title,
    timestamp: payload?.timestamp,
    annotationCount,
    screenshotCount: payload ? screenshotCount : undefined,
    screenshotMode: payload?.screenshotMode,
    storedAt: Date.now(),
    hasScreenshots: screenshotCount > 0,
    hasFullPayloadInMemory
  };
};

const persistLastAnnotation = async (meta: PopupAnnotationMeta, payload: AnnotationPayload | null): Promise<void> => {
  await setStorage({
    [LAST_ANNOTATION_META_KEY]: meta,
    [LAST_ANNOTATION_PAYLOAD_KEY]: payload
  });
};

const loadPersistedLastAnnotation = async (): Promise<{
  meta: PopupAnnotationMeta | null;
  payload: AnnotationPayload | null;
}> => {
  const data = await new Promise<Record<string, unknown>>((resolve) => {
    chrome.storage.local.get([LAST_ANNOTATION_META_KEY, LAST_ANNOTATION_PAYLOAD_KEY], (items) => resolve(items));
  });
  const metaRecord = data[LAST_ANNOTATION_META_KEY];
  const payloadRecord = data[LAST_ANNOTATION_PAYLOAD_KEY];
  const meta = metaRecord && typeof metaRecord === "object" ? metaRecord as PopupAnnotationMeta : null;
  const payload = payloadRecord && typeof payloadRecord === "object" ? payloadRecord as AnnotationPayload : null;
  return { meta, payload };
};

async function handleNativePortMessage(payload: unknown): Promise<void> {
  if (!payload || typeof payload !== "object") {
    return;
  }
  const record = payload as Record<string, unknown>;
  if (record.type === "annotationCommand") {
    await handleNativeAnnotationCommand(record as RelayAnnotationCommand);
  }
}

const handleRelayAnnotationCommand = async (
  command: RelayAnnotationCommand,
  transport: AnnotationTransport = "relay"
): Promise<void> => {
  const payload = command.payload;
  if (!payload || payload.version !== 1 || typeof payload.requestId !== "string") {
    sendAnnotationResponse({
      version: 1,
      requestId: payload?.requestId ?? "unknown",
      status: "error",
      error: { code: "invalid_request", message: "Invalid annotation command." }
    }, transport);
    return;
  }

  if (payload.command === "cancel") {
    await cancelAnnotationSession(payload.requestId, transport);
    return;
  }

  try {
    await startAnnotationSession(payload, transport);
    sendAnnotationEvent({
      version: 1,
      requestId: payload.requestId,
      event: "ready",
      message: "Annotation session started."
    }, transport);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Annotation start failed.";
    sendAnnotationResponse({
      version: 1,
      requestId: payload.requestId,
      status: "error",
      error: { code: "injection_failed", message: detail }
    }, transport);
  }
};

const handleNativeAnnotationCommand = async (command: RelayAnnotationCommand): Promise<void> => {
  await handleRelayAnnotationCommand(command, "native");
};

const finalizeAnnotationSession = (requestId: string): AnnotationSession | null => {
  const session = annotationSessions.get(requestId);
  if (!session) return null;
  clearTimeout(session.timeoutId);
  annotationSessions.delete(requestId);
  return session;
};

const handleAnnotationComplete = (requestId: string, payload: AnnotationPayload): void => {
  const session = finalizeAnnotationSession(requestId);
  if (!session) {
    return;
  }
  if (!validatePayloadSize(payload)) {
    const response: AnnotationResponse = {
      version: 1,
      requestId,
      status: "error",
      error: { code: "payload_too_large", message: "Annotation payload exceeded size limits." }
    };
    const meta = buildLastAnnotationMeta(requestId, response, false);
    lastAnnotationFull = null;
    persistLastAnnotation(meta, null).catch((error) => {
      logError("annotation.persist_payload_too_large", error, { code: "annotation_persist_failed" });
    });
    sendAnnotationResponse(response, session.transport);
    return;
  }
  const response: AnnotationResponse = {
    version: 1,
    requestId,
    status: "ok",
    payload
  };
  const meta = buildLastAnnotationMeta(requestId, response, true);
  lastAnnotationFull = { meta, payload };
  const storageMeta = { ...meta, hasFullPayloadInMemory: false };
  const sanitizedPayload = stripScreenshots(payload);
  persistLastAnnotation(storageMeta, sanitizedPayload).catch((error) => {
    logError("annotation.persist_sanitized_payload", error, { code: "annotation_persist_failed" });
  });
  sendAnnotationResponse(response, session.transport);
};

const handleAnnotationError = (requestId: string, error: { code: AnnotationErrorCode; message: string }): void => {
  const session = finalizeAnnotationSession(requestId);
  if (!session) return;
  const response: AnnotationResponse = {
    version: 1,
    requestId,
    status: "error",
    error
  };
  const meta = buildLastAnnotationMeta(requestId, response, false);
  lastAnnotationFull = null;
  persistLastAnnotation(meta, null).catch((error) => {
    logError("annotation.persist_error_meta", error, { code: "annotation_persist_failed" });
  });
  sendAnnotationResponse(response, session.transport);
};

const handleAnnotationCancelled = (requestId: string): void => {
  const session = finalizeAnnotationSession(requestId);
  if (!session) return;
  const response: AnnotationResponse = {
    version: 1,
    requestId,
    status: "cancelled",
    error: { code: "cancelled", message: "Annotation cancelled." }
  };
  const meta = buildLastAnnotationMeta(requestId, response, false);
  lastAnnotationFull = null;
  persistLastAnnotation(meta, null).catch((error) => {
    logError("annotation.persist_cancel_meta", error, { code: "annotation_persist_failed" });
  });
  sendAnnotationResponse(response, session.transport);
};

const captureVisibleTab = async (tab: chrome.tabs.Tab): Promise<string> => {
  return await new Promise((resolve, reject) => {
    chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" }, (dataUrl) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message));
        return;
      }
      if (!dataUrl) {
        reject(new Error("Capture failed"));
        return;
      }
      resolve(dataUrl);
    });
  });
};

const fetchTokenFromPlugin = async (
  port: number
): Promise<{ token: string; instanceId: string | null; epoch: number | null } | null> => {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/pair`, {
      method: "GET",
      headers: { "Accept": "application/json" }
    });
    if (!response.ok) {
      return null;
    }
    const data = await response.json();
    if (typeof data.token !== "string") {
      return null;
    }
    return {
      token: data.token,
      instanceId: typeof data.instanceId === "string" ? data.instanceId : null,
      epoch: parseEpoch(data.epoch)
    };
  } catch (error) {
    logError("relay.token_fetch", error, { code: "relay_pair_fetch_failed", extra: { port } });
    return null;
  }
};

const clearStoredRelayState = async (): Promise<void> => {
  await setStorage({
    relayPort: null,
    relayInstanceId: null,
    relayEpoch: null,
    pairingToken: null,
    tokenEpoch: null
  });
};

const attemptAutoConnect = async (): Promise<void> => {
  const data = await new Promise<Record<string, unknown>>((resolve) => {
    chrome.storage.local.get(
      ["autoConnect", "autoPair", "pairingEnabled", "pairingToken", "relayPort", "relayInstanceId", "relayEpoch", "tokenEpoch"],
      (items) => {
        resolve(items);
      }
    );
  });

  const autoConnect = typeof data.autoConnect === "boolean" ? data.autoConnect : DEFAULT_AUTO_CONNECT;
  if (!autoConnect || connection.getStatus() === "connected") {
    clearRetry();
    return;
  }

  const autoPair = typeof data.autoPair === "boolean" ? data.autoPair : DEFAULT_AUTO_PAIR;
  const pairingEnabled = typeof data.pairingEnabled === "boolean" ? data.pairingEnabled : DEFAULT_PAIRING_ENABLED;
  const storedRelayPort = parsePort(data.relayPort) ?? DEFAULT_RELAY_PORT;
  let storedPairingToken = typeof data.pairingToken === "string" ? data.pairingToken : null;

  if (autoPair && pairingEnabled) {
    let config = await fetchRelayConfig(DEFAULT_DISCOVERY_PORT);
    if (!config && storedRelayPort !== DEFAULT_DISCOVERY_PORT) {
      config = await fetchRelayConfig(storedRelayPort);
    }
    const storedRelayEpoch = parseEpoch(data.relayEpoch);
    const storedRelayInstanceId = typeof data.relayInstanceId === "string" ? data.relayInstanceId : null;
    const storedTokenEpoch = parseEpoch(data.tokenEpoch);

    if (!config) {
      setStatusNoteOverride("Relay config unreachable. Start the daemon and retry.");
      scheduleRetry();
      return;
    }

    const relayPort = config.relayPort ?? storedRelayPort;
    const configEpoch = config.epoch ?? null;
    const hasEpoch = config.epoch !== null;
    if (config.relayPort) {
      await setStorage({
        relayPort: config.relayPort,
        relayInstanceId: config.instanceId,
        relayEpoch: config.epoch
      });
    }

    if (hasEpoch && storedRelayEpoch !== null && storedRelayEpoch !== configEpoch) {
      await clearStoredRelayState();
      storedPairingToken = null;
      setStatusNoteOverride("Relay restarted. Refresh the connection.");
    }
    if (config.instanceId && storedRelayInstanceId && config.instanceId !== storedRelayInstanceId) {
      await clearStoredRelayState();
      storedPairingToken = null;
      setStatusNoteOverride("Relay instance mismatch. Open the popup and click Connect.");
    }
    if (hasEpoch && storedTokenEpoch !== null && storedTokenEpoch !== configEpoch) {
      await setStorage({ pairingToken: null, tokenEpoch: null });
      storedPairingToken = null;
    }
    if (hasEpoch && storedTokenEpoch === null && storedPairingToken) {
      await setStorage({ pairingToken: null, tokenEpoch: null });
      storedPairingToken = null;
    }

    const pairingRequired = config.pairingRequired ?? true;
    if (pairingRequired) {
      if (!storedPairingToken) {
        const fetched = await fetchTokenFromPlugin(relayPort);
        if (!fetched) {
          setStatusNoteOverride("Auto-pair failed. Start the daemon and retry.");
          scheduleRetry();
          return;
        }
        if (config.instanceId && fetched.instanceId && config.instanceId !== fetched.instanceId) {
          console.warn("[opendevbrowser] Relay instance mismatch during auto-pair. Retrying later.");
          setStatusNoteOverride("Relay instance mismatch. Open the popup and click Connect.");
          return;
        }
        const tokenEpoch = fetched.epoch ?? configEpoch;
        await setStorage({ pairingToken: fetched.token, tokenEpoch });
      }
    }
  }

  await connection.connect();
  if (connection.getStatus() !== "connected") {
    const nativeConnected = await attemptNativeConnect();
    if (nativeConnected) {
      setStatusNoteOverride("Connected via native host.");
      clearRetry();
      return;
    }
    setStatusNoteOverride(buildNativeHealthNote(nativePort.getHealth()));
    scheduleRetry();
    return;
  }
  nativePort.disconnect();
  setStatusNoteOverride(null);
  clearRetry();
};

const autoConnect = async () => {
  if (autoConnectInFlight) {
    return;
  }
  autoConnectInFlight = true;
  try {
    await attemptAutoConnect();
  } catch (error) {
    logError("auto_connect.attempt", error, { code: "auto_connect_failed" });
    connection.disconnect();
    nativePort.disconnect();
  } finally {
    autoConnectInFlight = false;
  }
};

connection.onStatus((status) => {
  const effectiveStatus =
    status === "connected" ? "connected" : nativePort.isConnected() ? "connected" : "disconnected";
  updateBadge(effectiveStatus);
  if (status === "connected") {
    nativePort.disconnect();
    setStatusNoteOverride(null);
    clearRetry();
  }
  if (status === "disconnected" && !nativePort.isConnected()) {
    for (const session of annotationSessions.values()) {
      clearTimeout(session.timeoutId);
    }
    annotationSessions.clear();
  }
});
updateBadge(getEffectiveStatus());

chrome.runtime.onStartup.addListener(() => {
  autoConnect().catch((error) => {
    logError("auto_connect.startup", error, { code: "auto_connect_failed" });
  });
});

chrome.runtime.onInstalled.addListener(() => {
  autoConnect().catch((error) => {
    logError("auto_connect.installed", error, { code: "auto_connect_failed" });
  });
});

if (chrome.alarms?.onAlarm) {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === RETRY_ALARM_NAME) {
      retryScheduled = false;
      autoConnect().catch((error) => {
        logError("auto_connect.alarm", error, { code: "auto_connect_failed" });
      });
    }
  });
}

if (chrome.commands?.onCommand) {
  chrome.commands.onCommand.addListener((command) => {
    if (command === "toggle-annotation") {
      toggleAnnotationUi().catch((error) => {
        logError("annotation.toggle", error, { code: "annotation_toggle_failed" });
      });
    }
  });
}

autoConnect().catch((error) => {
  logError("auto_connect.startup", error, { code: "auto_connect_failed" });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") {
    return;
  }
  if (changes.autoConnect?.newValue === true) {
    autoConnect().catch((error) => {
      logError("auto_connect.setting", error, { code: "auto_connect_failed" });
    });
  }
  if (changes.pairingToken) {
    autoConnect().catch((error) => {
      logError("auto_connect.pairing_token", error, { code: "auto_connect_failed" });
    });
  }
});

chrome.runtime.onMessage.addListener((message: PopupMessage | ContentScriptMessage, sender, sendResponse) => {
  const respond = (status: BackgroundMessage) => {
    sendResponse(status);
  };

  if (message.type === "status") {
    (async () => {
      respond(await buildStatusMessage());
    })().catch((error) => {
      logError("popup.status", error, { code: "status_failed" });
      respond({
        type: "status",
        status: connection.getStatus(),
        note: "Background unavailable"
      });
    });
    return true;
  }

  if (message.type === "connect") {
    (async () => {
      await connection.connect();
      if (connection.getStatus() !== "connected") {
        await attemptNativeConnect();
      }
      respond(await buildStatusMessage());
    })().catch((error) => {
      logError("popup.connect", error, { code: "connect_failed" });
      connection.disconnect();
      nativePort.disconnect();
      respond({
        type: "status",
        status: "disconnected",
        note: "Connect failed"
      });
    });
    return true;
  }

  if (message.type === "disconnect") {
    (async () => {
      await connection.disconnect();
      nativePort.disconnect();
      connection.clearLastError();
      respond(await buildStatusMessage());
    })().catch((error) => {
      logError("popup.disconnect", error, { code: "disconnect_failed" });
      connection.disconnect();
      nativePort.disconnect();
      connection.clearLastError();
      respond({
        type: "status",
        status: "disconnected",
        note: "Disconnect failed"
      });
    });
    return true;
  }

  if (message.type === "annotation:start") {
    (async () => {
      const requestId = generateAnnotationRequestId();
      const response: PopupAnnotationStartResponse = {
        type: "annotation:startResult",
        requestId,
        ok: false
      };

      try {
        const active = await getActiveTab();
        if (!active) {
          response.error = { code: "invalid_request", message: "No active tab available." };
          sendResponse(response);
          return;
        }
        const restricted = isRestrictedTab(active);
        if (restricted) {
          response.error = { code: "restricted_url", message: restricted };
          sendResponse(response);
          return;
        }
        if (typeof active.id !== "number") {
          response.error = { code: "invalid_request", message: "Target tab missing id." };
          sendResponse(response);
          return;
        }
        await startAnnotationSession({
          version: 1,
          requestId,
          command: "start",
          tabId: active.id,
          options: message.options
        }, "popup");
        if (!annotationSessions.has(requestId)) {
          response.error = { code: "injection_failed", message: "Annotation session failed to start." };
          sendResponse(response);
          return;
        }
        response.ok = true;
        sendResponse(response);
      } catch (error) {
        const detail = error instanceof Error ? error.message : "Annotation start failed.";
        response.error = { code: "injection_failed", message: detail };
        sendResponse(response);
      }
    })();
    return true;
  }

  if (message.type === "annotation:lastMeta") {
    (async () => {
      if (lastAnnotationFull) {
        const meta = { ...lastAnnotationFull.meta, hasFullPayloadInMemory: true };
        const response: PopupAnnotationLastMetaResponse = { type: "annotation:lastMetaResult", meta };
        sendResponse(response);
        return;
      }
      const stored = await loadPersistedLastAnnotation();
      const meta = stored.meta ? { ...stored.meta, hasFullPayloadInMemory: false } : null;
      const response: PopupAnnotationLastMetaResponse = { type: "annotation:lastMetaResult", meta };
      sendResponse(response);
    })().catch(() => {
      const response: PopupAnnotationLastMetaResponse = { type: "annotation:lastMetaResult", meta: null };
      sendResponse(response);
    });
    return true;
  }

  if (message.type === "annotation:probe") {
    (async () => {
      const result = await probeAnnotationInjected();
      sendResponse({ type: "annotation:probeResult", ...result });
    })().catch((error) => {
      logError("annotation.probe", error, { code: "annotation_probe_failed" });
      sendResponse({ type: "annotation:probeResult", injected: false, detail: "Probe failed." });
    });
    return true;
  }

  if (message.type === "annotation:getPayload") {
    (async () => {
      if (message.includeScreenshots && lastAnnotationFull) {
        const response: PopupAnnotationGetPayloadResponse = {
          type: "annotation:payloadResult",
          payload: lastAnnotationFull.payload,
          meta: { ...lastAnnotationFull.meta, hasFullPayloadInMemory: true },
          source: "memory"
        };
        sendResponse(response);
        return;
      }

      const stored = await loadPersistedLastAnnotation();
      const storedMeta = stored.meta ? { ...stored.meta, hasFullPayloadInMemory: false } : null;

      if (message.includeScreenshots) {
        const response: PopupAnnotationGetPayloadResponse = {
          type: "annotation:payloadResult",
          payload: null,
          meta: storedMeta,
          source: "none",
          warning: "Full payload not available; screenshots may have been dropped."
        };
        sendResponse(response);
        return;
      }

      if (lastAnnotationFull) {
        const response: PopupAnnotationGetPayloadResponse = {
          type: "annotation:payloadResult",
          payload: stripScreenshots(lastAnnotationFull.payload),
          meta: { ...lastAnnotationFull.meta, hasFullPayloadInMemory: true },
          source: "memory"
        };
        sendResponse(response);
        return;
      }

      if (stored.payload) {
        const response: PopupAnnotationGetPayloadResponse = {
          type: "annotation:payloadResult",
          payload: stored.payload,
          meta: storedMeta,
          source: "storage"
        };
        sendResponse(response);
        return;
      }

      const response: PopupAnnotationGetPayloadResponse = {
        type: "annotation:payloadResult",
        payload: null,
        meta: storedMeta,
        source: "none",
        warning: "No stored annotation payload."
      };
      sendResponse(response);
    })().catch(() => {
      const response: PopupAnnotationGetPayloadResponse = {
        type: "annotation:payloadResult",
        payload: null,
        meta: null,
        source: "none",
        warning: "Background unavailable."
      };
      sendResponse(response);
    });
    return true;
  }

  if (message.type === "annotation:capture") {
    (async () => {
      const tab = sender.tab;
      if (!tab) {
        sendResponse({ ok: false, error: "No tab for capture" });
        return;
      }
      try {
        const dataUrl = await captureVisibleTab(tab);
        sendResponse({ ok: true, dataUrl });
      } catch (error) {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : "Capture failed" });
      }
    })();
    return true;
  }

  if (message.type === "annotation:complete") {
    handleAnnotationComplete(message.requestId, message.payload);
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "annotation:cancelled") {
    handleAnnotationCancelled(message.requestId);
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "annotation:error") {
    handleAnnotationError(message.requestId, message.error);
    sendResponse({ ok: true });
    return true;
  }

  return false;
});
