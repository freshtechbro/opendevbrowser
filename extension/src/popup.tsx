import type { BackgroundMessage, PopupMessage } from "./types";

const statusEl = document.getElementById("status");
const toggleButton = document.getElementById("toggle");
const relayPortInput = document.getElementById("relayPort") as HTMLInputElement | null;
const pairingTokenInput = document.getElementById("pairingToken") as HTMLInputElement | null;

if (!statusEl || !toggleButton || !relayPortInput || !pairingTokenInput) {
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
    chrome.storage.local.get(["pairingToken", "relayPort"], (items) => {
      resolve(items);
    });
  });
  pairingTokenInput.value = typeof data.pairingToken === "string" ? data.pairingToken : "";
  const portValue = typeof data.relayPort === "number" ? data.relayPort : 8787;
  relayPortInput.value = Number.isInteger(portValue) ? String(portValue) : "8787";
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

relayPortInput.addEventListener("input", () => {
  const raw = relayPortInput.value.trim();
  if (!raw) {
    chrome.storage.local.set({ relayPort: 8787 });
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
  pairingTokenInput.value = "";
  relayPortInput.value = "8787";
});
