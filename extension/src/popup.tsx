import type { BackgroundMessage, PopupMessage } from "./types";
import { DEFAULT_PAIRING_ENABLED, DEFAULT_PAIRING_TOKEN, DEFAULT_RELAY_PORT } from "./relay-settings";

const statusEl = document.getElementById("status");
const toggleButton = document.getElementById("toggle");
const relayPortInput = document.getElementById("relayPort") as HTMLInputElement | null;
const pairingTokenInput = document.getElementById("pairingToken") as HTMLInputElement | null;
const pairingEnabledInput = document.getElementById("pairingEnabled") as HTMLInputElement | null;

if (!statusEl || !toggleButton || !relayPortInput || !pairingTokenInput || !pairingEnabledInput) {
  throw new Error("Popup DOM missing required elements");
}

const setStatus = (status: BackgroundMessage["status"]) => {
  statusEl.textContent = status === "connected" ? "Connected" : "Disconnected";
  toggleButton.textContent = status === "connected" ? "Disconnect" : "Connect";
};

const sendMessage = (message: PopupMessage): Promise<BackgroundMessage> => {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response: BackgroundMessage) => {
      resolve(response);
    });
  });
};

const refreshStatus = async () => {
  const response = await sendMessage({ type: "status" });
  setStatus(response.status);
};

const loadSettings = async () => {
  const data = await new Promise<Record<string, unknown>>((resolve) => {
    chrome.storage.local.get(["pairingToken", "pairingEnabled", "relayPort"], (items) => {
      resolve(items);
    });
  });
  const pairingEnabled = typeof data.pairingEnabled === "boolean"
    ? data.pairingEnabled
    : DEFAULT_PAIRING_ENABLED;
  const rawToken = typeof data.pairingToken === "string" ? data.pairingToken.trim() : "";
  const tokenValue = pairingEnabled ? (rawToken || DEFAULT_PAIRING_TOKEN) : rawToken;
  const portValue = typeof data.relayPort === "number" ? data.relayPort : DEFAULT_RELAY_PORT;

  pairingEnabledInput.checked = pairingEnabled;
  pairingTokenInput.disabled = !pairingEnabled;
  pairingTokenInput.value = tokenValue;
  relayPortInput.value = Number.isInteger(portValue) ? String(portValue) : String(DEFAULT_RELAY_PORT);

  const updates: Record<string, unknown> = {};
  if (typeof data.pairingEnabled !== "boolean") {
    updates.pairingEnabled = pairingEnabled;
  }
  if (pairingEnabled && !rawToken) {
    updates.pairingToken = DEFAULT_PAIRING_TOKEN;
  }
  if (Object.keys(updates).length > 0) {
    chrome.storage.local.set(updates);
  }
};

const toggle = async () => {
  const response = await sendMessage({
    type: statusEl.textContent === "Connected" ? "disconnect" : "connect"
  });
  setStatus(response.status);
};

toggleButton.addEventListener("click", () => {
  toggle().catch(() => {
    setStatus("disconnected");
  });
});

pairingTokenInput.addEventListener("input", () => {
  const value = pairingTokenInput.value.trim();
  chrome.storage.local.set({ pairingToken: value });
});

pairingEnabledInput.addEventListener("change", () => {
  const enabled = pairingEnabledInput.checked;
  pairingTokenInput.disabled = !enabled;
  const updates: Record<string, unknown> = { pairingEnabled: enabled };
  if (enabled) {
    const tokenValue = pairingTokenInput.value.trim() || DEFAULT_PAIRING_TOKEN;
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
});

loadSettings().catch(() => {
  pairingEnabledInput.checked = DEFAULT_PAIRING_ENABLED;
  pairingTokenInput.disabled = !DEFAULT_PAIRING_ENABLED;
  pairingTokenInput.value = DEFAULT_PAIRING_TOKEN;
  relayPortInput.value = String(DEFAULT_RELAY_PORT);
});
