import type { BackgroundMessage, PopupMessage } from "./types.js";
import {
  DEFAULT_AUTO_CONNECT,
  DEFAULT_AUTO_PAIR,
  DEFAULT_DISCOVERY_PORT,
  DEFAULT_PAIRING_ENABLED,
  DEFAULT_PAIRING_TOKEN,
  DEFAULT_RELAY_PORT
} from "./relay-settings.js";

const statusEl = document.getElementById("status");
const statusIndicator = document.getElementById("statusIndicator");
const statusPill = document.getElementById("statusPill");
const statusNote = document.getElementById("statusNote");
const toggleButton = document.getElementById("toggle");
const relayPortInput = document.getElementById("relayPort") as HTMLInputElement | null;
const pairingTokenInput = document.getElementById("pairingToken") as HTMLInputElement | null;
const pairingEnabledInput = document.getElementById("pairingEnabled") as HTMLInputElement | null;
const autoPairInput = document.getElementById("autoPair") as HTMLInputElement | null;
const autoConnectInput = document.getElementById("autoConnect") as HTMLInputElement | null;

if (!statusEl || !statusIndicator || !statusPill || !statusNote || !toggleButton || !relayPortInput || !pairingTokenInput || !pairingEnabledInput || !autoPairInput || !autoConnectInput) {
  throw new Error("Popup DOM missing required elements");
}

const defaultNote = "Local relay only. Tokens stay on-device.";

const setNote = (message?: string) => {
  const next = message && message.trim() ? message : defaultNote;
  statusNote.textContent = next;
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

const sendMessage = (message: PopupMessage): Promise<BackgroundMessage> => {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response: BackgroundMessage) => {
      resolve(response);
    });
  });
};

const setStorage = (items: Record<string, unknown>): Promise<void> => {
  return new Promise((resolve) => {
    chrome.storage.local.set(items, () => resolve());
  });
};

const refreshStatus = async () => {
  const response = await sendMessage({ type: "status" });
  setStatus(response.status);
  setNote(response.note);
};

const fetchTokenFromPlugin = async (port: number): Promise<string | null> => {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/pair`, {
      method: "GET",
      headers: { "Accept": "application/json" }
    });
    if (!response.ok) {
      return null;
    }
    const data = await response.json();
    return typeof data.token === "string" ? data.token : null;
  } catch {
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
    return { relayPort, pairingRequired };
  } catch {
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
    chrome.storage.local.get(["pairingToken", "pairingEnabled", "relayPort", "autoPair", "autoConnect"], (items) => {
      resolve(items);
    });
  });
  
  const autoPair = typeof data.autoPair === "boolean" ? data.autoPair : DEFAULT_AUTO_PAIR;
  const autoConnect = typeof data.autoConnect === "boolean" ? data.autoConnect : DEFAULT_AUTO_CONNECT;
  const pairingEnabled = typeof data.pairingEnabled === "boolean"
    ? data.pairingEnabled
    : DEFAULT_PAIRING_ENABLED;
  const rawToken = typeof data.pairingToken === "string" ? data.pairingToken.trim() : "";
  const tokenValue = pairingEnabled ? (rawToken || DEFAULT_PAIRING_TOKEN || "") : rawToken;
  const portValue = parsePort(data.relayPort) ?? DEFAULT_RELAY_PORT;

  autoConnectInput.checked = autoConnect;
  autoPairInput.checked = autoPair;
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
  if (typeof data.pairingEnabled !== "boolean") {
    updates.pairingEnabled = pairingEnabled;
  }
  if (Object.keys(updates).length > 0) {
    chrome.storage.local.set(updates);
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
    const pairingRequired = config?.pairingRequired ?? true;
    if (pairingRequired) {
      const fetchedToken = await fetchTokenFromPlugin(relayPort);
      if (fetchedToken) {
        pairingTokenInput.value = fetchedToken;
        await setStorage({ pairingToken: fetchedToken });
      } else {
        setStatus("disconnected");
        setNote("Auto-pair failed. Start the plugin and retry.");
        setTimeout(() => refreshStatus(), 2000);
        return;
      }
    }
  }
  
  const response = await sendMessage({
    type: isConnected ? "disconnect" : "connect"
  });
  setStatus(response.status);
  setNote(response.note);
};

toggleButton.addEventListener("click", () => {
  toggle().catch(() => {
    setStatus("disconnected");
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
    toggle().catch(() => {
      setStatus("disconnected");
      setNote();
    });
  }
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

refreshStatus().catch(() => {
  setStatus("disconnected");
  setNote();
});

loadSettings().catch(() => {
  autoConnectInput.checked = DEFAULT_AUTO_CONNECT;
  autoPairInput.checked = DEFAULT_AUTO_PAIR;
  pairingEnabledInput.checked = DEFAULT_PAIRING_ENABLED;
  pairingTokenInput.disabled = !DEFAULT_PAIRING_ENABLED;
  pairingTokenInput.value = DEFAULT_PAIRING_TOKEN || "";
  relayPortInput.value = String(DEFAULT_RELAY_PORT);
  setNote();
});
