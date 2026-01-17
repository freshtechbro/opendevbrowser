import { ConnectionManager } from "./services/ConnectionManager.js";
import {
  DEFAULT_AUTO_CONNECT,
  DEFAULT_AUTO_PAIR,
  DEFAULT_DISCOVERY_PORT,
  DEFAULT_PAIRING_ENABLED,
  DEFAULT_RELAY_PORT
} from "./relay-settings.js";
import type { BackgroundMessage, ConnectionStatus, PopupMessage } from "./types.js";

const connection = new ConnectionManager();
let autoConnectInFlight = false;

type RelayConfig = {
  relayPort: number;
  pairingRequired: boolean;
};

const updateBadge = (status: ConnectionStatus): void => {
  const isConnected = status === "connected";
  chrome.action.setBadgeText({ text: isConnected ? "ON" : "OFF" });
  chrome.action.setBadgeBackgroundColor({
    color: isConnected ? "#20d5c6" : "#5b667a"
  });
};

const buildStatusMessage = (): BackgroundMessage => {
  const error = connection.getLastError();
  const status = connection.getStatus();
  let note = error?.message;
  if (!error && status === "connected") {
    const identity = connection.getRelayIdentity();
    if (identity.relayPort && identity.instanceId) {
      note = `Connected to 127.0.0.1:${identity.relayPort} (relay ${identity.instanceId.slice(0, 8)})`;
    } else if (identity.relayPort) {
      note = `Connected to 127.0.0.1:${identity.relayPort}`;
    }
  }
  return {
    type: "status",
    status,
    note
  };
};

const setStorage = (items: Record<string, unknown>): Promise<void> => {
  return new Promise((resolve) => {
    chrome.storage.local.set(items, () => resolve());
  });
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

const attemptAutoConnect = async (): Promise<void> => {
  const data = await new Promise<Record<string, unknown>>((resolve) => {
    chrome.storage.local.get(["autoConnect", "autoPair", "pairingEnabled", "pairingToken", "relayPort"], (items) => {
      resolve(items);
    });
  });

  const autoConnect = typeof data.autoConnect === "boolean" ? data.autoConnect : DEFAULT_AUTO_CONNECT;
  if (!autoConnect || connection.getStatus() === "connected") {
    return;
  }

  const autoPair = typeof data.autoPair === "boolean" ? data.autoPair : DEFAULT_AUTO_PAIR;
  const pairingEnabled = typeof data.pairingEnabled === "boolean" ? data.pairingEnabled : DEFAULT_PAIRING_ENABLED;

  if (autoPair && pairingEnabled) {
    const config = await fetchRelayConfig(DEFAULT_DISCOVERY_PORT);
    const relayPort = config?.relayPort ?? parsePort(data.relayPort) ?? DEFAULT_RELAY_PORT;
    if (config?.relayPort) {
      await setStorage({ relayPort: config.relayPort });
    }
    const pairingRequired = config?.pairingRequired ?? true;
    if (pairingRequired) {
      const fetchedToken = await fetchTokenFromPlugin(relayPort);
      if (fetchedToken) {
        await setStorage({ pairingToken: fetchedToken });
      } else {
        return;
      }
    }
  }

  await connection.connect();
};

const autoConnect = async () => {
  if (autoConnectInFlight) {
    return;
  }
  autoConnectInFlight = true;
  try {
    await attemptAutoConnect();
  } catch {
    connection.disconnect();
  } finally {
    autoConnectInFlight = false;
  }
};

connection.onStatus(updateBadge);
updateBadge(connection.getStatus());

chrome.runtime.onStartup.addListener(() => {
  autoConnect().catch(() => {});
});

chrome.runtime.onInstalled.addListener(() => {
  autoConnect().catch(() => {});
});

autoConnect().catch(() => {});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") {
    return;
  }
  if (changes.autoConnect?.newValue === true) {
    autoConnect().catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((message: PopupMessage, _sender, sendResponse) => {
  const respond = (status: BackgroundMessage) => {
    sendResponse(status);
  };

  if (message.type === "status") {
    respond(buildStatusMessage());
    return true;
  }

  if (message.type === "connect") {
    (async () => {
      await connection.connect();
      respond(buildStatusMessage());
    })().catch(() => {
      connection.disconnect();
      respond(buildStatusMessage());
    });
    return true;
  }

  if (message.type === "disconnect") {
    (async () => {
      await connection.disconnect();
      connection.clearLastError();
      respond(buildStatusMessage());
    })().catch(() => {
      connection.disconnect();
      connection.clearLastError();
      respond(buildStatusMessage());
    });
    return true;
  }

  return false;
});
