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
let statusNoteOverride: string | null = null;
let retryScheduled = false;
let retryDelayMs = 5000;

const RETRY_ALARM_NAME = "opendevbrowser-auto-connect";
const RETRY_MAX_MS = 60_000;

type RelayConfig = {
  relayPort: number;
  pairingRequired: boolean;
  instanceId: string | null;
  epoch: number | null;
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
  if (!error) {
    if (status === "connected") {
      const identity = connection.getRelayIdentity();
      if (identity.relayPort && identity.instanceId) {
        note = `Connected to 127.0.0.1:${identity.relayPort} (relay ${identity.instanceId.slice(0, 8)})`;
      } else if (identity.relayPort) {
        note = `Connected to 127.0.0.1:${identity.relayPort}`;
      }
    } else if (statusNoteOverride) {
      note = statusNoteOverride;
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

const setStatusNoteOverride = (note: string | null): void => {
  statusNoteOverride = note;
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
    autoConnect().catch(() => {});
  }, delayMs);
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
  } catch {
    return null;
  }
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
  } catch {
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
  const storedPairingToken = typeof data.pairingToken === "string" ? data.pairingToken : null;

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
      setStatusNoteOverride("Relay restarted. Refresh the connection.");
    }
    if (config.instanceId && storedRelayInstanceId && config.instanceId !== storedRelayInstanceId) {
      await clearStoredRelayState();
      setStatusNoteOverride("Relay instance mismatch. Open the popup and click Connect.");
    }
    if (hasEpoch && storedTokenEpoch !== null && storedTokenEpoch !== configEpoch) {
      await setStorage({ pairingToken: null, tokenEpoch: null });
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
  } catch {
    connection.disconnect();
  } finally {
    autoConnectInFlight = false;
  }
};

connection.onStatus((status) => {
  updateBadge(status);
  if (status === "connected") {
    setStatusNoteOverride(null);
    clearRetry();
  }
});
updateBadge(connection.getStatus());

chrome.runtime.onStartup.addListener(() => {
  autoConnect().catch(() => {});
});

chrome.runtime.onInstalled.addListener(() => {
  autoConnect().catch(() => {});
});

if (chrome.alarms?.onAlarm) {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === RETRY_ALARM_NAME) {
      retryScheduled = false;
      autoConnect().catch(() => {});
    }
  });
}

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
