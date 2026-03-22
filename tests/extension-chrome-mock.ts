import { vi } from "vitest";

type StorageListener = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => void;
type TabActivatedListener = (activeInfo: chrome.tabs.TabActiveInfo) => void;
type TabRemovedListener = (tabId: number) => void;
type TabUpdatedListener = (tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => void;
type DebuggerEventListener = (source: chrome.debugger.Debuggee, method: string, params?: object) => void;
type DebuggerDetachListener = (source: chrome.debugger.Debuggee, reason?: string) => void;
type RuntimeListener = () => void;
type MessageListener = (message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void) => void;
type AlarmListener = (alarm: chrome.alarms.Alarm) => void;
type ConnectListener = (port: chrome.runtime.Port) => void;

export type ChromeMockState = {
  chrome: typeof chrome;
  setActiveTab: (tab: chrome.tabs.Tab | null) => void;
  emitTabActivated: (tabId: number) => void;
  emitStorageChange: (value: unknown) => void;
  emitTabRemoved: (tabId: number) => void;
  emitTabUpdated: (tabId: number, tab: chrome.tabs.Tab) => void;
  emitDebuggerEvent: (source: chrome.debugger.Debuggee, method: string, params?: object) => void;
  emitDebuggerDetach: (source: chrome.debugger.Debuggee, reason?: string) => void;
  setRuntimeError: (message: string | null) => void;
  setCaptureVisibleTabResult: (dataUrl: string) => void;
  setCaptureVisibleTabError: (message: string | null) => void;
  getLastCaptureArgs: () => { windowId: number | undefined; options?: chrome.tabs.CaptureVisibleTabOptions } | null;
  emitStartup: () => void;
  emitInstalled: () => void;
  emitAlarm: (name: string) => void;
  emitConnect: (options?: { name?: string; sender?: chrome.runtime.MessageSender }) => chrome.runtime.Port;
};

export const createChromeMock = (initial?: {
  activeTab?: chrome.tabs.Tab | null;
  tabs?: chrome.tabs.Tab[];
  pairingToken?: string | null;
  pairingEnabled?: boolean | null;
  relayPort?: number | null;
  relayInstanceId?: string | null;
  relayEpoch?: number | null;
  tokenEpoch?: number | null;
  autoConnect?: boolean | null;
  autoPair?: boolean | null;
}): ChromeMockState => {
  const hasExplicitTabs = Array.isArray(initial?.tabs) && initial.tabs.length > 0;
  let activeTab = initial?.activeTab ?? {
    id: 1,
    url: "https://example.com",
    title: "Example",
    groupId: 1,
    status: "complete"
  };
  const tabsById = new Map<number, chrome.tabs.Tab>();
  for (const tab of initial?.tabs ?? []) {
    if (typeof tab.id === "number") {
      tabsById.set(tab.id, tab);
    }
  }
  if (!activeTab) {
    const seededActive = Array.from(tabsById.values()).find((tab) => tab.active);
    activeTab = seededActive ?? null;
  }
  if (activeTab && typeof activeTab.id === "number") {
    tabsById.set(activeTab.id, { ...tabsById.get(activeTab.id), ...activeTab });
  }
  const highestSeededTabId = Array.from(tabsById.keys()).reduce((max, id) => Math.max(max, id), 0);
  let nextTabId = highestSeededTabId > 0 ? highestSeededTabId + 1 : 1;
  let storageData: Record<string, unknown> = {
    pairingToken: initial?.pairingToken ?? null,
    pairingEnabled: initial?.pairingEnabled ?? true,
    relayPort: initial?.relayPort ?? 8787,
    relayInstanceId: initial?.relayInstanceId ?? null,
    relayEpoch: initial?.relayEpoch ?? null,
    tokenEpoch: initial?.tokenEpoch ?? null,
    autoConnect: initial?.autoConnect ?? null,
    autoPair: initial?.autoPair ?? null,
    annotationLastMeta: null,
    annotationLastPayloadSansScreenshots: null
  };

  const storageListeners = new Set<StorageListener>();
  const tabActivatedListeners = new Set<TabActivatedListener>();
  const tabRemovedListeners = new Set<TabRemovedListener>();
  const tabUpdatedListeners = new Set<TabUpdatedListener>();
  const debuggerEventListeners = new Set<DebuggerEventListener>();
  const debuggerDetachListeners = new Set<DebuggerDetachListener>();
  const startupListeners = new Set<RuntimeListener>();
  const installedListeners = new Set<RuntimeListener>();
  const messageListeners = new Set<MessageListener>();
  const alarmListeners = new Set<AlarmListener>();
  const connectListeners = new Set<ConnectListener>();
  const scheduledAlarms = new Map<string, chrome.alarms.Alarm>();
  let sessionCounter = 1;
  let captureVisibleTabResult = "data:image/png;base64,AAAA";
  let captureVisibleTabError: string | null = null;
  let lastCaptureArgs: { windowId: number | undefined; options?: chrome.tabs.CaptureVisibleTabOptions } | null = null;

  const setActiveTabState = (tab: chrome.tabs.Tab | null) => {
    if (activeTab && typeof activeTab.id === "number") {
      if (!hasExplicitTabs) {
        tabsById.delete(activeTab.id);
      } else {
        const previous = tabsById.get(activeTab.id);
        if (previous) {
          tabsById.set(activeTab.id, { ...previous, active: false });
        }
      }
    }
    activeTab = tab ? { ...tab, active: true } : null;
    if (activeTab && typeof activeTab.id === "number") {
      tabsById.set(activeTab.id, activeTab);
    }
  };

  const listTabs = (): chrome.tabs.Tab[] => {
    const tabs = Array.from(tabsById.values());
    if (!activeTab || typeof activeTab.id !== "number") {
      return tabs;
    }
    return tabs.sort((left, right) => Number(right.id === activeTab.id) - Number(left.id === activeTab.id));
  };

  const createPort = (name = "", sender: chrome.runtime.MessageSender = activeTab ? { tab: activeTab } : {}): chrome.runtime.Port => {
    const messageListeners = new Set<(message: unknown, port: chrome.runtime.Port) => void>();
    const disconnectListeners = new Set<(port: chrome.runtime.Port) => void>();
    const port = {
      name,
      sender,
      disconnect: vi.fn(() => {
        for (const listener of disconnectListeners) {
          listener(port);
        }
      }),
      onDisconnect: {
        addListener: (listener: (port: chrome.runtime.Port) => void) => {
          disconnectListeners.add(listener);
        }
      },
      onMessage: {
        addListener: (listener: (message: unknown, port: chrome.runtime.Port) => void) => {
          messageListeners.add(listener);
        }
      },
      postMessage: vi.fn((message: unknown) => {
        for (const listener of messageListeners) {
          listener(message, port);
        }
      })
    } as unknown as chrome.runtime.Port;
    return port;
  };

  const chromeMock = {
    runtime: {
      lastError: null as { message: string } | null,
      getURL: vi.fn((path: string) => `chrome-extension://test/${path}`),
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
      },
      onConnect: {
        addListener: (listener: ConnectListener) => {
          connectListeners.add(listener);
        }
      },
      connect: vi.fn((connectInfo?: { name?: string }) => {
        const port = createPort(connectInfo?.name ?? "");
        for (const listener of connectListeners) {
          listener(port);
        }
        return port;
      }),
      sendMessage: vi.fn((message: unknown, callback?: (response: unknown) => void) => {
        for (const listener of messageListeners) {
          const sender: chrome.runtime.MessageSender = activeTab ? { tab: activeTab } : {};
          listener(message, sender, (response) => {
            callback?.(response);
          });
        }
      })
    },
    action: {
      setBadgeText: vi.fn(),
      setBadgeBackgroundColor: vi.fn(),
      setBadgeTextColor: vi.fn()
    },
    alarms: {
      create: vi.fn((name: string, alarmInfo: chrome.alarms.AlarmCreateInfo) => {
        const scheduled: chrome.alarms.Alarm = {
          name,
          scheduledTime: alarmInfo.when ?? Date.now()
        };
        scheduledAlarms.set(name, scheduled);
      }),
      clear: vi.fn((name: string, callback?: (wasCleared: boolean) => void) => {
        const removed = scheduledAlarms.delete(name);
        callback?.(removed);
      }),
      get: vi.fn((name: string, callback: (alarm?: chrome.alarms.Alarm) => void) => {
        callback(scheduledAlarms.get(name));
      }),
      onAlarm: {
        addListener: (listener: AlarmListener) => {
          alarmListeners.add(listener);
        }
      }
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
      query: vi.fn(async (queryInfo?: chrome.tabs.QueryInfo) => {
        const tabs = listTabs();
        if (queryInfo?.active) {
          return activeTab ? [activeTab] : [];
        }
        return tabs;
      }),
      get: vi.fn(async (tabId: number) => {
        return tabsById.get(tabId) ?? null;
      }),
      getCurrent: vi.fn((callback: (tab?: chrome.tabs.Tab) => void) => {
        callback(activeTab ?? undefined);
      }),
      sendMessage: vi.fn((tabId: number, _message: unknown, callback?: (response: unknown) => void) => {
        void tabId;
        const type = (_message as { type?: string } | null)?.type;
        if (type === "annotation:start" || type === "annotation:toggle") {
          callback?.({ ok: true, bootId: "mock-boot", active: true });
          return;
        }
        if (type === "annotation:cancel") {
          callback?.({ ok: true, bootId: "mock-boot", active: false });
          return;
        }
        if (type === "annotation:ping") {
          callback?.({ ok: true, bootId: "mock-boot", active: false });
          return;
        }
        callback?.({ ok: true });
      }),
      captureVisibleTab: vi.fn((windowId: number | undefined, options: chrome.tabs.CaptureVisibleTabOptions, callback: (dataUrl?: string) => void) => {
        lastCaptureArgs = { windowId, options };
        if (captureVisibleTabError) {
          chromeMock.runtime.lastError = { message: captureVisibleTabError };
          callback(undefined);
          chromeMock.runtime.lastError = null;
          return;
        }
        callback(captureVisibleTabResult);
      }),
      create: vi.fn((createProperties: chrome.tabs.CreateProperties, callback?: (tab: chrome.tabs.Tab) => void) => {
        const tabId = nextTabId++;
        const tab: chrome.tabs.Tab = {
          id: tabId,
          url: createProperties.url ?? "about:blank",
          title: createProperties.url ?? "New Tab",
          status: "complete",
          active: createProperties.active ?? true
        };
        tabsById.set(tabId, tab);
        if (createProperties.active ?? true) {
          setActiveTabState(tab);
        }
        callback?.(tab);
        return tab;
      }),
      update: vi.fn((tabId: number, updateProperties: chrome.tabs.UpdateProperties, callback?: (tab?: chrome.tabs.Tab) => void) => {
        const existing = tabsById.get(tabId);
        if (!existing) {
          callback?.(undefined);
          return null;
        }
        const updated: chrome.tabs.Tab = {
          ...existing,
          url: updateProperties.url ?? existing.url,
          title: updateProperties.url ? updateProperties.url : existing.title,
          status: "complete",
          active: updateProperties.active ?? existing.active
        };
        tabsById.set(tabId, updated);
        if (updateProperties.active) {
          setActiveTabState(updated);
        }
        callback?.(updated);
        return updated;
      }),
      remove: vi.fn((tabId: number | number[], callback?: () => void) => {
        const ids = Array.isArray(tabId) ? tabId : [tabId];
        for (const id of ids) {
          tabsById.delete(id);
          for (const listener of tabRemovedListeners) {
            listener(id);
          }
        }
        if (activeTab && typeof activeTab.id === "number" && !tabsById.has(activeTab.id)) {
          const [first] = tabsById.values();
          activeTab = first ?? null;
        }
        callback?.();
      }),
      onRemoved: {
        addListener: (listener: TabRemovedListener) => {
          tabRemovedListeners.add(listener);
        }
      },
      onActivated: {
        addListener: (listener: TabActivatedListener) => {
          tabActivatedListeners.add(listener);
        }
      },
      onUpdated: {
        addListener: (listener: TabUpdatedListener) => {
          tabUpdatedListeners.add(listener);
        },
        removeListener: (listener: TabUpdatedListener) => {
          tabUpdatedListeners.delete(listener);
        }
      }
    },
    scripting: {
      insertCSS: vi.fn((_inject: chrome.scripting.CSSInjection, callback?: () => void) => {
        callback?.();
      }),
      executeScript: vi.fn((_inject: chrome.scripting.ScriptInjection, callback?: () => void) => {
        callback?.();
      })
    },
    debugger: {
      getTargets: vi.fn((callback: (result: chrome.debugger.TargetInfo[]) => void) => {
        const targets = listTabs()
          .filter((tab): tab is chrome.tabs.Tab & { id: number } => typeof tab.id === "number")
          .map((tab) => ({
            id: `target-${tab.id}`,
            tabId: tab.id,
            type: "page",
            title: tab.title ?? "",
            url: tab.url ?? "",
            attached: false
          })) as chrome.debugger.TargetInfo[];
        callback(targets);
      }),
      attach: vi.fn((debuggee: chrome.debugger.Debuggee, _version: string, callback: () => void) => {
        void debuggee;
        callback();
      }),
      detach: vi.fn((debuggee: chrome.debugger.Debuggee, callback: () => void) => {
        void debuggee;
        callback();
      }),
      sendCommand: vi.fn((debuggee: chrome.debugger.Debuggee, method: string, _params: object, callback: (result?: unknown) => void) => {
        void debuggee;
        if (method === "Target.attachToTarget") {
          const sessionId = `session-${sessionCounter}`;
          sessionCounter += 1;
          callback({ sessionId });
          return;
        }
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
      setActiveTabState(tab);
    },
    emitTabActivated: (tabId) => {
      const tab = tabsById.get(tabId) ?? null;
      if (tab) {
        setActiveTabState(tab);
      }
      for (const listener of tabActivatedListeners) {
        listener({ tabId, windowId: 1 });
      }
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
      if (tab && typeof tab.id === "number") {
        tabsById.set(tab.id, tab);
      }
      for (const listener of tabUpdatedListeners) {
        listener(tabId, tab.status ? { status: tab.status } : {}, tab);
      }
    },
    emitDebuggerEvent: (source, method, params) => {
      for (const listener of debuggerEventListeners) {
        listener(source, method, params);
      }
    },
    emitDebuggerDetach: (source, reason) => {
      for (const listener of debuggerDetachListeners) {
        listener(source, reason);
      }
    },
    setRuntimeError: (message) => {
      chromeMock.runtime.lastError = message ? { message } : null;
    },
    setCaptureVisibleTabResult: (dataUrl: string) => {
      captureVisibleTabResult = dataUrl;
    },
    setCaptureVisibleTabError: (message: string | null) => {
      captureVisibleTabError = message;
    },
    getLastCaptureArgs: () => lastCaptureArgs,
    emitStartup: () => {
      for (const listener of startupListeners) {
        listener();
      }
    },
    emitInstalled: () => {
      for (const listener of installedListeners) {
        listener();
      }
    },
    emitAlarm: (name: string) => {
      const alarm = scheduledAlarms.get(name) ?? { name, scheduledTime: Date.now() };
      for (const listener of alarmListeners) {
        listener(alarm);
      }
    },
    emitConnect: (options) => {
      const port = createPort(options?.name ?? "", options?.sender ?? (activeTab ? { tab: activeTab } : {}));
      for (const listener of connectListeners) {
        listener(port);
      }
      return port;
    }
  };
};
