import type { BackgroundMessage, PopupMessage } from "./types.js";
import { DEFAULT_AUTO_PAIR, DEFAULT_PAIRING_ENABLED, DEFAULT_PAIRING_TOKEN, DEFAULT_RELAY_PORT } from "./relay-settings.js";

const statusEl = document.getElementById("status");
const statusIndicator = document.getElementById("statusIndicator");
const toggleButton = document.getElementById("toggle");
const relayPortInput = document.getElementById("relayPort") as HTMLInputElement | null;
const pairingTokenInput = document.getElementById("pairingToken") as HTMLInputElement | null;
const pairingEnabledInput = document.getElementById("pairingEnabled") as HTMLInputElement | null;
const autoPairInput = document.getElementById("autoPair") as HTMLInputElement | null;

if (!statusEl || !statusIndicator || !toggleButton || !relayPortInput || !pairingTokenInput || !pairingEnabledInput || !autoPairInput) {
  throw new Error("Popup DOM missing required elements");
}

const setStatus = (status: BackgroundMessage["status"]) => {
  const isConnected = status === "connected";
  statusEl.textContent = isConnected ? "Connected" : "Disconnected";
  toggleButton.textContent = isConnected ? "Disconnect" : "Connect";
  
  if (isConnected) {
    statusIndicator.classList.add("connected");
  } else {
    statusIndicator.classList.remove("connected");
  }
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

const loadSettings = async () => {
  const data = await new Promise<Record<string, unknown>>((resolve) => {
    chrome.storage.local.get(["pairingToken", "pairingEnabled", "relayPort", "autoPair"], (items) => {
      resolve(items);
    });
  });
  
  const autoPair = typeof data.autoPair === "boolean" ? data.autoPair : DEFAULT_AUTO_PAIR;
  const pairingEnabled = typeof data.pairingEnabled === "boolean"
    ? data.pairingEnabled
    : DEFAULT_PAIRING_ENABLED;
  const rawToken = typeof data.pairingToken === "string" ? data.pairingToken.trim() : "";
  const tokenValue = pairingEnabled ? (rawToken || DEFAULT_PAIRING_TOKEN || "") : rawToken;
  const portValue = typeof data.relayPort === "number" ? data.relayPort : DEFAULT_RELAY_PORT;

  autoPairInput.checked = autoPair;
  pairingEnabledInput.checked = pairingEnabled;
  pairingTokenInput.disabled = !pairingEnabled || autoPair;
  pairingTokenInput.value = tokenValue;
  relayPortInput.value = Number.isInteger(portValue) ? String(portValue) : String(DEFAULT_RELAY_PORT);

  const updates: Record<string, unknown> = {};
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
  
  if (!isConnected && autoPairInput.checked && pairingEnabledInput.checked) {
    const port = parseInt(relayPortInput.value, 10) || DEFAULT_RELAY_PORT;
    const fetchedToken = await fetchTokenFromPlugin(port);
    if (fetchedToken) {
      pairingTokenInput.value = fetchedToken;
      chrome.storage.local.set({ pairingToken: fetchedToken });
    } else {
      statusEl.textContent = "Failed to fetch token from plugin";
      setTimeout(() => refreshStatus(), 2000);
      return;
    }
  }
  
  const response = await sendMessage({
    type: isConnected ? "disconnect" : "connect"
  });
  setStatus(response.status);
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
    pairingTokenInput.placeholder = "Enter token or enable Auto-Pair";
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
});

loadSettings().catch(() => {
  autoPairInput.checked = DEFAULT_AUTO_PAIR;
  pairingEnabledInput.checked = DEFAULT_PAIRING_ENABLED;
  pairingTokenInput.disabled = !DEFAULT_PAIRING_ENABLED;
  pairingTokenInput.value = DEFAULT_PAIRING_TOKEN || "";
  relayPortInput.value = String(DEFAULT_RELAY_PORT);
});
