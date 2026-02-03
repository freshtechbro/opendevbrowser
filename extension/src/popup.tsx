import type {
  AnnotationCommand,
  BackgroundMessage,
  NativeTransportHealth,
  PopupAnnotationProbeResponse,
  PopupAnnotationGetPayloadResponse,
  PopupAnnotationLastMetaResponse,
  PopupAnnotationMeta,
  PopupAnnotationStartResponse,
  PopupMessage,
  RelayHealthStatus
} from "./types.js";
import {
  DEFAULT_AUTO_CONNECT,
  DEFAULT_AUTO_PAIR,
  DEFAULT_DISCOVERY_PORT,
  DEFAULT_NATIVE_ENABLED,
  DEFAULT_PAIRING_ENABLED,
  DEFAULT_PAIRING_TOKEN,
  DEFAULT_RELAY_PORT
} from "./relay-settings.js";
import { logError } from "./logging.js";

const statusEl = document.getElementById("status");
const statusIndicator = document.getElementById("statusIndicator");
const statusPill = document.getElementById("statusPill");
const statusNote = document.getElementById("statusNote");
const toggleButton = document.getElementById("toggle");
const healthRelay = document.getElementById("healthRelay");
const healthHandshake = document.getElementById("healthHandshake");
const healthAnnotation = document.getElementById("healthAnnotation");
const healthInjected = document.getElementById("healthInjected");
const healthCdp = document.getElementById("healthCdp");
const healthPairing = document.getElementById("healthPairing");
const healthNative = document.getElementById("healthNative");
const healthNote = document.getElementById("healthNote");
const relayPortInput = document.getElementById("relayPort") as HTMLInputElement | null;
const pairingTokenInput = document.getElementById("pairingToken") as HTMLInputElement | null;
const pairingEnabledInput = document.getElementById("pairingEnabled") as HTMLInputElement | null;
const autoPairInput = document.getElementById("autoPair") as HTMLInputElement | null;
const autoConnectInput = document.getElementById("autoConnect") as HTMLInputElement | null;
const nativeEnabledInput = document.getElementById("nativeEnabled") as HTMLInputElement | null;
const annotationContextInput = document.getElementById("annotationContext") as HTMLInputElement | null;
const annotationStartButton = document.getElementById("annotationStart");
const annotationCopyButton = document.getElementById("annotationCopy") as HTMLButtonElement | null;
const annotationNote = document.getElementById("annotationNote");

if (
  !statusEl
  || !statusIndicator
  || !statusPill
  || !statusNote
  || !toggleButton
  || !healthRelay
  || !healthHandshake
  || !healthAnnotation
  || !healthInjected
  || !healthCdp
  || !healthPairing
  || !healthNative
  || !healthNote
  || !relayPortInput
  || !pairingTokenInput
  || !pairingEnabledInput
  || !autoPairInput
  || !autoConnectInput
  || !nativeEnabledInput
  || !annotationContextInput
  || !annotationStartButton
  || !annotationCopyButton
  || !annotationNote
) {
  throw new Error("Popup DOM missing required elements");
}

const defaultNote = "Local relay only. Tokens stay on-device.";
const defaultAnnotationNote = "No annotations captured yet.";
const LAST_ANNOTATION_META_KEY = "annotationLastMeta";

const setNote = (message?: string) => {
  const next = message && message.trim() ? message : defaultNote;
  statusNote.textContent = next;
};

const setAnnotationNote = (message?: string) => {
  const next = message && message.trim() ? message : defaultAnnotationNote;
  annotationNote.textContent = next;
};

const setStatus = (status: BackgroundMessage["status"]) => {
  const isConnected = status === "connected";
  statusEl.textContent = isConnected ? "Connected" : "Disconnected";
  toggleButton.textContent = isConnected ? "Disconnect" : "Connect";
  
  if (isConnected) {
    statusIndicator.classList.add("connected");
    statusPill.classList.add("connected");
  } else {
    statusIndicator.classList.remove("connected");
    statusPill.classList.remove("connected");
  }
};

const setHealthValue = (element: HTMLElement, value: string, tone: "ok" | "warn" | "off") => {
  element.textContent = value;
  element.dataset.tone = tone;
};

const formatReason = (reason: string): string => {
  return reason.replace(/_/g, " ");
};

const setHealth = (health?: RelayHealthStatus | null) => {
  if (!health) {
    setHealthValue(healthRelay, "Unknown", "off");
    setHealthValue(healthHandshake, "Unknown", "off");
    setHealthValue(healthAnnotation, "Unknown", "off");
    setHealthValue(healthInjected, "Unknown", "off");
    setHealthValue(healthCdp, "Unknown", "off");
    setHealthValue(healthPairing, "Unknown", "off");
    healthNote.textContent = "Health check pending.";
    return;
  }

  setHealthValue(healthRelay, health.ok ? "Online" : "Offline", health.ok ? "ok" : "warn");
  setHealthValue(
    healthHandshake,
    health.extensionHandshakeComplete ? "Complete" : (health.extensionConnected ? "Pending" : "Offline"),
    health.extensionHandshakeComplete ? "ok" : (health.extensionConnected ? "warn" : "off")
  );
  setHealthValue(healthAnnotation, health.annotationConnected ? "Connected" : "Idle", health.annotationConnected ? "ok" : "off");
  setHealthValue(healthInjected, "Unknown", "off");
  setHealthValue(healthCdp, health.cdpConnected ? "Active" : "Idle", health.cdpConnected ? "ok" : "off");
  setHealthValue(healthPairing, health.pairingRequired ? "Required" : "Not required", health.pairingRequired ? "warn" : "ok");

  if (health.lastHandshakeError) {
    const detail = health.lastHandshakeError.message ? ` ${health.lastHandshakeError.message}` : "";
    healthNote.textContent = `Last handshake error: ${health.lastHandshakeError.code}.${detail}`;
  } else if (!health.ok) {
    healthNote.textContent = `Relay health: ${formatReason(health.reason)}.`;
  } else {
    healthNote.textContent = "Relay health OK.";
  }
};

const setInjectionStatus = (injected: boolean | null, detail?: string) => {
  if (injected === null) {
    setHealthValue(healthInjected, "Unknown", "off");
    return;
  }
  if (injected) {
    setHealthValue(healthInjected, "Injected", "ok");
    return;
  }
  setHealthValue(healthInjected, "Not injected", "warn");
  if (detail && healthNote.textContent === "Relay health OK.") {
    healthNote.textContent = `Annotation UI: ${detail}`;
  }
};

const formatNativeHealth = (health: NativeTransportHealth | null): { label: string; tone: "ok" | "warn" | "off"; note?: string } => {
  if (!health) {
    return { label: "Unknown", tone: "off" };
  }
  if (health.status === "connected") {
    return { label: "Connected", tone: "ok" };
  }
  switch (health.error) {
    case "host_not_installed":
      return { label: "Not installed", tone: "warn", note: "Native host not installed." };
    case "host_forbidden":
      return { label: "Forbidden", tone: "warn", note: "Native host forbidden." };
    case "host_timeout":
      return { label: "Timeout", tone: "warn", note: "Native host timed out." };
    case "host_message_too_large":
      return { label: "Too large", tone: "warn", note: "Native host rejected message size." };
    case "host_disconnect":
      return { label: "Disconnected", tone: "off", note: "Native host disconnected." };
    default:
      return { label: "Unavailable", tone: "off", note: "Native host unavailable." };
  }
};

const setNativeHealth = (health: NativeTransportHealth | null, enabled: boolean) => {
  if (!enabled) {
    setHealthValue(healthNative, "Disabled", "off");
    return;
  }
  const formatted = formatNativeHealth(health);
  setHealthValue(healthNative, formatted.label, formatted.tone);
  if (formatted.note && healthNote.textContent === "Relay health OK.") {
    healthNote.textContent = `${healthNote.textContent} ${formatted.note}`;
  }
};

const applyStatus = (response: BackgroundMessage) => {
  setStatus(response.status);
  setNote(response.note);
  setHealth(response.relayHealth ?? null);
  setNativeHealth(response.nativeHealth ?? null, response.nativeEnabled === true);
};

const sendMessage = <TResponse,>(message: PopupMessage): Promise<TResponse> => {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: TResponse) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message));
        return;
      }
      if (!response) {
        reject(new Error("No response from background"));
        return;
      }
      resolve(response);
    });
  });
};

const setStorage = (items: Record<string, unknown>): Promise<void> => {
  return new Promise((resolve) => {
    chrome.storage.local.set(items, () => resolve());
  });
};

const refreshInjectionStatus = async () => {
  try {
    const response = await sendMessage<PopupAnnotationProbeResponse>({ type: "annotation:probe" });
    setInjectionStatus(response.injected, response.detail);
  } catch (error) {
    logError("popup.annotation_probe", error, { code: "annotation_probe_failed" });
    setInjectionStatus(null);
  }
};

const refreshStatus = async () => {
  try {
    const response = await sendMessage<BackgroundMessage>({ type: "status" });
    applyStatus(response);
    void refreshInjectionStatus();
  } catch (error) {
    logError("popup.status_refresh", error, { code: "status_refresh_failed" });
    setStatus("disconnected");
    const message = error instanceof Error ? error.message : "Background unavailable";
    setNote(message);
    setHealth(null);
    setNativeHealth(null, nativeEnabledInput.checked);
    setInjectionStatus(null);
  }
};

const setCopyEnabled = (enabled: boolean) => {
  annotationCopyButton.disabled = !enabled;
};

const buildPopupAnnotationOptions = (): AnnotationCommand["options"] | undefined => {
  const context = annotationContextInput.value.trim();
  return context ? { context } : undefined;
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
      epoch: typeof data.epoch === "number" ? data.epoch : null
    };
  } catch (error) {
    logError("popup.token_fetch", error, { code: "relay_pair_fetch_failed", extra: { port } });
    return null;
  }
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

type RelayConfig = {
  relayPort: number;
  pairingRequired: boolean;
  instanceId: string | null;
  epoch: number | null;
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
    const epoch = typeof data.epoch === "number" ? data.epoch : null;
    return { relayPort, pairingRequired, instanceId, epoch };
  } catch (error) {
    logError("popup.relay_config_fetch", error, { code: "relay_config_fetch_failed", extra: { port } });
    return null;
  }
};

const applyRelayPort = (port: number): void => {
  const nextValue = String(port);
  if (relayPortInput.value !== nextValue) {
    relayPortInput.value = nextValue;
  }
  chrome.storage.local.set({ relayPort: port });
};

const loadSettings = async () => {
  const data = await new Promise<Record<string, unknown>>((resolve) => {
    chrome.storage.local.get(["pairingToken", "pairingEnabled", "relayPort", "autoPair", "autoConnect", "nativeEnabled"], (items) => {
      resolve(items);
    });
  });
  
  const autoPair = typeof data.autoPair === "boolean" ? data.autoPair : DEFAULT_AUTO_PAIR;
  const autoConnect = typeof data.autoConnect === "boolean" ? data.autoConnect : DEFAULT_AUTO_CONNECT;
  const nativeEnabled = typeof data.nativeEnabled === "boolean" ? data.nativeEnabled : DEFAULT_NATIVE_ENABLED;
  const pairingEnabled = typeof data.pairingEnabled === "boolean"
    ? data.pairingEnabled
    : DEFAULT_PAIRING_ENABLED;
  const rawToken = typeof data.pairingToken === "string" ? data.pairingToken.trim() : "";
  const tokenValue = pairingEnabled ? (rawToken || DEFAULT_PAIRING_TOKEN || "") : rawToken;
  const portValue = parsePort(data.relayPort) ?? DEFAULT_RELAY_PORT;

  autoConnectInput.checked = autoConnect;
  autoPairInput.checked = autoPair;
  nativeEnabledInput.checked = nativeEnabled;
  pairingEnabledInput.checked = pairingEnabled;
  pairingTokenInput.disabled = !pairingEnabled || autoPair;
  pairingTokenInput.value = tokenValue;
  relayPortInput.value = Number.isInteger(portValue) ? String(portValue) : String(DEFAULT_RELAY_PORT);
  setNote();

  const updates: Record<string, unknown> = {};
  if (typeof data.autoConnect !== "boolean") {
    updates.autoConnect = autoConnect;
  }
  if (typeof data.autoPair !== "boolean") {
    updates.autoPair = autoPair;
  }
  if (typeof data.nativeEnabled !== "boolean") {
    updates.nativeEnabled = nativeEnabled;
  }
  if (typeof data.pairingEnabled !== "boolean") {
    updates.pairingEnabled = pairingEnabled;
  }
  if (Object.keys(updates).length > 0) {
    chrome.storage.local.set(updates);
  }
};

const formatAnnotationSummary = (meta: PopupAnnotationMeta): string => {
  if (meta.status !== "ok") {
    if (meta.error?.message) {
      return `Last annotation ${meta.status}: ${meta.error.message}`;
    }
    return `Last annotation ${meta.status}.`;
  }
  const count = meta.annotationCount ?? 0;
  const target = meta.url ? ` on ${meta.url}` : "";
  return `Last annotation: ${count} item${count === 1 ? "" : "s"}${target}.`;
};

const refreshLastAnnotationMeta = async () => {
  try {
    const response = await sendMessage<PopupAnnotationLastMetaResponse>({ type: "annotation:lastMeta" });
    const meta = response.meta;
    if (meta && meta.status === "ok") {
      setCopyEnabled(true);
      setAnnotationNote(formatAnnotationSummary(meta));
      return;
    }
    setCopyEnabled(false);
    if (meta) {
      setAnnotationNote(formatAnnotationSummary(meta));
    } else {
      setAnnotationNote();
    }
  } catch (error) {
    logError("popup.annotation_meta", error, { code: "annotation_meta_failed" });
    setCopyEnabled(false);
    setAnnotationNote("Annotation status unavailable.");
  }
};

const copyTextToClipboard = async (text: string): Promise<void> => {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch (error) {
    logError("popup.clipboard_async", error, { code: "clipboard_write_failed" });
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.top = "-1000px";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const ok = document.execCommand("copy");
  document.body.removeChild(textarea);
  if (!ok) {
    throw new Error("Clipboard copy failed");
  }
};

const toggle = async () => {
  const isConnected = statusEl.textContent === "Connected";
  setNote();
  
  if (!isConnected && autoPairInput.checked && pairingEnabledInput.checked) {
    const config = await fetchRelayConfig(DEFAULT_DISCOVERY_PORT);
    const relayPort = config?.relayPort ?? parsePort(relayPortInput.value) ?? DEFAULT_RELAY_PORT;
    if (config?.relayPort) {
      applyRelayPort(config.relayPort);
    }
    if (config?.relayPort || config?.instanceId || config?.epoch) {
      await setStorage({
        relayPort: config?.relayPort ?? relayPort,
        relayInstanceId: config?.instanceId ?? null,
        relayEpoch: config?.epoch ?? null
      });
    }
    const pairingRequired = config?.pairingRequired ?? true;
    if (pairingRequired) {
      const fetchedToken = await fetchTokenFromPlugin(relayPort);
      if (fetchedToken) {
        pairingTokenInput.value = fetchedToken.token;
        await setStorage({
          pairingToken: fetchedToken.token,
          tokenEpoch: fetchedToken.epoch ?? config?.epoch ?? null,
          relayInstanceId: config?.instanceId ?? fetchedToken.instanceId ?? null,
          relayEpoch: config?.epoch ?? fetchedToken.epoch ?? null
        });
      } else {
        setStatus("disconnected");
        setNote("Auto-pair failed. Start the daemon and retry.");
        setTimeout(() => refreshStatus(), 2000);
        return;
      }
    }
  }
  
  try {
    const response = await sendMessage<BackgroundMessage>({
      type: isConnected ? "disconnect" : "connect"
    });
    applyStatus(response);
    void refreshInjectionStatus();
  } catch (error) {
    logError("popup.toggle", error, { code: "toggle_failed" });
    setStatus("disconnected");
    const message = error instanceof Error ? error.message : "Background unavailable";
    setNote(message);
    setHealth(null);
  }
};

toggleButton.addEventListener("click", () => {
  toggle().catch((error) => {
    logError("popup.toggle", error, { code: "toggle_failed" });
    setStatus("disconnected");
  });
});

annotationStartButton.addEventListener("click", () => {
  (async () => {
    setAnnotationNote("Starting annotation...");
    const options = buildPopupAnnotationOptions();
    const response = await sendMessage<PopupAnnotationStartResponse>({
      type: "annotation:start",
      options
    });
    if (!response.ok) {
      const message = response.error?.message ?? "Annotation start failed.";
      setAnnotationNote(message);
      setCopyEnabled(false);
      return;
    }
    setAnnotationNote("Annotation started. Switch to the tab to select elements.");
    setCopyEnabled(false);
    void refreshInjectionStatus();
  })().catch((error) => {
    const message = error instanceof Error ? error.message : "Annotation start failed.";
    setAnnotationNote(message);
    setCopyEnabled(false);
  });
});

annotationCopyButton.addEventListener("click", () => {
  (async () => {
    setAnnotationNote("Preparing annotation payload...");
    let response = await sendMessage<PopupAnnotationGetPayloadResponse>({
      type: "annotation:getPayload",
      includeScreenshots: true
    });
    if (!response.payload) {
      response = await sendMessage<PopupAnnotationGetPayloadResponse>({
        type: "annotation:getPayload",
        includeScreenshots: false
      });
    }
    if (!response.payload) {
      setAnnotationNote("No completed annotation payload available.");
      setCopyEnabled(false);
      return;
    }
    await copyTextToClipboard(JSON.stringify(response.payload, null, 2));
    if (response.warning) {
      setAnnotationNote(`Copied payload (${response.warning.replace(/\.$/, "")}).`);
    } else {
      setAnnotationNote("Copied annotation payload to clipboard.");
    }
    await refreshLastAnnotationMeta();
  })().catch((error) => {
    const message = error instanceof Error ? error.message : "Copy failed.";
    setAnnotationNote(message);
  });
});

autoPairInput.addEventListener("change", () => {
  const enabled = autoPairInput.checked;
  pairingTokenInput.disabled = !pairingEnabledInput.checked || enabled;
  chrome.storage.local.set({ autoPair: enabled });
  
  if (enabled) {
    pairingTokenInput.placeholder = "Will be fetched automatically";
  } else {
    pairingTokenInput.placeholder = "Enter token or enable auto-pair";
  }
});

autoConnectInput.addEventListener("change", () => {
  const enabled = autoConnectInput.checked;
  chrome.storage.local.set({ autoConnect: enabled });
  if (enabled && statusEl.textContent !== "Connected") {
    toggle().catch((error) => {
      logError("popup.auto_connect", error, { code: "auto_connect_failed" });
      setStatus("disconnected");
      setNote();
    });
  }
});

nativeEnabledInput.addEventListener("change", () => {
  const enabled = nativeEnabledInput.checked;
  chrome.storage.local.set({ nativeEnabled: enabled });
  setNativeHealth(null, enabled);
  void refreshStatus();
});

pairingTokenInput.addEventListener("input", () => {
  const value = pairingTokenInput.value.trim();
  chrome.storage.local.set({ pairingToken: value });
});

pairingEnabledInput.addEventListener("change", () => {
  const enabled = pairingEnabledInput.checked;
  pairingTokenInput.disabled = !enabled || autoPairInput.checked;
  const updates: Record<string, unknown> = { pairingEnabled: enabled };
  if (enabled && !autoPairInput.checked) {
    const tokenValue = pairingTokenInput.value.trim() || DEFAULT_PAIRING_TOKEN || "";
    pairingTokenInput.value = tokenValue;
    updates.pairingToken = tokenValue;
  }
  chrome.storage.local.set(updates);
});

relayPortInput.addEventListener("input", () => {
  const raw = relayPortInput.value.trim();
  if (!raw) {
    chrome.storage.local.set({ relayPort: DEFAULT_RELAY_PORT });
    return;
  }
  const parsed = Number(raw);
  if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535) {
    chrome.storage.local.set({ relayPort: parsed });
  }
});

refreshStatus().catch((error) => {
  logError("popup.refresh_status", error, { code: "status_refresh_failed" });
  setStatus("disconnected");
  setNote();
});

loadSettings().catch((error) => {
  logError("popup.load_settings", error, { code: "settings_load_failed" });
  autoConnectInput.checked = DEFAULT_AUTO_CONNECT;
  autoPairInput.checked = DEFAULT_AUTO_PAIR;
  nativeEnabledInput.checked = DEFAULT_NATIVE_ENABLED;
  pairingEnabledInput.checked = DEFAULT_PAIRING_ENABLED;
  pairingTokenInput.disabled = !DEFAULT_PAIRING_ENABLED;
  pairingTokenInput.value = DEFAULT_PAIRING_TOKEN || "";
  relayPortInput.value = String(DEFAULT_RELAY_PORT);
  setNote();
});

refreshLastAnnotationMeta().catch((error) => {
  logError("popup.annotation_meta", error, { code: "annotation_meta_failed" });
  setCopyEnabled(false);
  setAnnotationNote();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  if (!changes[LAST_ANNOTATION_META_KEY]) return;
  refreshLastAnnotationMeta().catch((error) => {
    logError("popup.annotation_meta", error, { code: "annotation_meta_failed" });
  });
});
