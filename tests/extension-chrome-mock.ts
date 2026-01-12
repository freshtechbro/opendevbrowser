import { vi } from "vitest";

type StorageListener = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => void;
type TabRemovedListener = (tabId: number) => void;
type TabUpdatedListener = (tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => void;
type DebuggerEventListener = (source: chrome.debugger.Debuggee, method: string, params?: object) => void;
type DebuggerDetachListener = (source: chrome.debugger.Debuggee) => void;
type RuntimeListener = () => void;
type MessageListener = (message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void) => void;

export type ChromeMockState = {
  chrome: typeof chrome;
  setActiveTab: (tab: chrome.tabs.Tab | null) => void;
  emitStorageChange: (value: unknown) => void;
  emitTabRemoved: (tabId: number) => void;
  emitTabUpdated: (tabId: number, tab: chrome.tabs.Tab) => void;
  emitDebuggerEvent: (source: chrome.debugger.Debuggee, method: string, params?: object) => void;
  emitDebuggerDetach: (source: chrome.debugger.Debuggee) => void;
  setRuntimeError: (message: string | null) => void;
  emitStartup: () => void;
  emitInstalled: () => void;
};

export const createChromeMock = (initial?: {
  activeTab?: chrome.tabs.Tab | null;
  pairingToken?: string | null;
  pairingEnabled?: boolean | null;
  relayPort?: number | null;
  autoConnect?: boolean | null;
  autoPair?: boolean | null;
}): ChromeMockState => {
  let activeTab = initial?.activeTab ?? {
    id: 1,
    url: "https://example.com",
    title: "Example",
    groupId: 1
  };
  let storageData: Record<string, unknown> = {
    pairingToken: initial?.pairingToken ?? null,
    pairingEnabled: initial?.pairingEnabled ?? true,
    relayPort: initial?.relayPort ?? 8787,
    autoConnect: initial?.autoConnect ?? null,
    autoPair: initial?.autoPair ?? null
  };

  const storageListeners = new Set<StorageListener>();
  const tabRemovedListeners = new Set<TabRemovedListener>();
  const tabUpdatedListeners = new Set<TabUpdatedListener>();
  const debuggerEventListeners = new Set<DebuggerEventListener>();
  const debuggerDetachListeners = new Set<DebuggerDetachListener>();
  const startupListeners = new Set<RuntimeListener>();
  const installedListeners = new Set<RuntimeListener>();
  const messageListeners = new Set<MessageListener>();

  const chromeMock = {
    runtime: {
      lastError: null as { message: string } | null,
      onStartup: {
        addListener: (listener: RuntimeListener) => {
          startupListeners.add(listener);
        }
      },
      onInstalled: {
        addListener: (listener: RuntimeListener) => {
          installedListeners.add(listener);
        }
      },
      onMessage: {
        addListener: (listener: MessageListener) => {
          messageListeners.add(listener);
        }
      }
    },
    action: {
      setBadgeText: vi.fn(),
      setBadgeBackgroundColor: vi.fn()
    },
    storage: {
      local: {
        get: vi.fn((key: unknown, callback: (items: Record<string, unknown>) => void) => {
          void key;
          callback({ ...storageData });
        }),
        set: vi.fn((items: Record<string, unknown>, callback?: () => void) => {
          storageData = { ...storageData, ...items };
          callback?.();
        })
      },
      onChanged: {
        addListener: (listener: StorageListener) => {
          storageListeners.add(listener);
        }
      }
    },
    tabs: {
      query: vi.fn(async () => (activeTab ? [activeTab] : [])),
      get: vi.fn(async (tabId: number) => {
        if (activeTab && activeTab.id === tabId) {
          return activeTab;
        }
        return null;
      }),
      onRemoved: {
        addListener: (listener: TabRemovedListener) => {
          tabRemovedListeners.add(listener);
        }
      },
      onUpdated: {
        addListener: (listener: TabUpdatedListener) => {
          tabUpdatedListeners.add(listener);
        }
      }
    },
    debugger: {
      attach: vi.fn((debuggee: chrome.debugger.Debuggee, _version: string, callback: () => void) => {
        void debuggee;
        callback();
      }),
      detach: vi.fn((debuggee: chrome.debugger.Debuggee, callback: () => void) => {
        void debuggee;
        callback();
      }),
      sendCommand: vi.fn((debuggee: chrome.debugger.Debuggee, _method: string, _params: object, callback: (result?: unknown) => void) => {
        void debuggee;
        callback({ ok: true });
      }),
      onEvent: {
        addListener: (listener: DebuggerEventListener) => {
          debuggerEventListeners.add(listener);
        },
        removeListener: (listener: DebuggerEventListener) => {
          debuggerEventListeners.delete(listener);
        }
      },
      onDetach: {
        addListener: (listener: DebuggerDetachListener) => {
          debuggerDetachListeners.add(listener);
        },
        removeListener: (listener: DebuggerDetachListener) => {
          debuggerDetachListeners.delete(listener);
        }
      }
    }
  } as typeof chrome;

  return {
    chrome: chromeMock,
    setActiveTab: (tab) => {
      activeTab = tab;
    },
    emitStorageChange: (value) => {
      const updates = typeof value === "object" && value !== null
        ? value as Record<string, unknown>
        : { pairingToken: value };
      const changes: { [key: string]: chrome.storage.StorageChange } = {};
      for (const [key, newValue] of Object.entries(updates)) {
        changes[key] = { newValue } as chrome.storage.StorageChange;
      }
      for (const listener of storageListeners) {
        listener(changes, "local");
      }
    },
    emitTabRemoved: (tabId) => {
      for (const listener of tabRemovedListeners) {
        listener(tabId);
      }
    },
    emitTabUpdated: (tabId, tab) => {
      for (const listener of tabUpdatedListeners) {
        listener(tabId, {}, tab);
      }
    },
    emitDebuggerEvent: (source, method, params) => {
      for (const listener of debuggerEventListeners) {
        listener(source, method, params);
      }
    },
    emitDebuggerDetach: (source) => {
      for (const listener of debuggerDetachListeners) {
        listener(source);
      }
    },
    setRuntimeError: (message) => {
      chromeMock.runtime.lastError = message ? { message } : null;
    },
    emitStartup: () => {
      for (const listener of startupListeners) {
        listener();
      }
    },
    emitInstalled: () => {
      for (const listener of installedListeners) {
        listener();
      }
    }
  };
};
