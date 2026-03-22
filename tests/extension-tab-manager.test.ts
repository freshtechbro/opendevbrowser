import { afterEach, describe, expect, it, vi } from "vitest";
import { TabManager } from "../extension/src/services/TabManager";

type TabUpdatedListener = (tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => void;
type TabRemovedListener = (tabId: number) => void;

describe("TabManager.waitForTabComplete", () => {
  const originalChrome = globalThis.chrome;

  afterEach(() => {
    globalThis.chrome = originalChrome;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("resolves when the tab becomes complete without an onUpdated complete event", async () => {
    vi.useFakeTimers();

    let tab: chrome.tabs.Tab | null = {
      id: 7,
      url: "data:text/html;charset=utf-8,%3Ch1%3ECanvas%3C%2Fh1%3E",
      status: "loading",
      title: "Canvas"
    };
    const updatedListeners = new Set<TabUpdatedListener>();

    globalThis.chrome = {
      tabs: {
        get: vi.fn(async (tabId: number) => tabId === 7 ? tab : null),
        onUpdated: {
          addListener: vi.fn((listener: TabUpdatedListener) => {
            updatedListeners.add(listener);
          }),
          removeListener: vi.fn((listener: TabUpdatedListener) => {
            updatedListeners.delete(listener);
          })
        }
      }
    } as unknown as typeof chrome;

    const manager = new TabManager();
    const waitPromise = manager.waitForTabComplete(7, 1000);

    await vi.advanceTimersByTimeAsync(120);
    tab = { ...tab, status: "complete" };
    await vi.advanceTimersByTimeAsync(120);

    await expect(waitPromise).resolves.toBeUndefined();
    expect(updatedListeners.size).toBe(0);
  });
});

describe("TabManager.closeTab", () => {
  const originalChrome = globalThis.chrome;

  afterEach(() => {
    globalThis.chrome = originalChrome;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("resolves when the tab disappears even if chrome.tabs.remove never fires its callback", async () => {
    vi.useFakeTimers();

    let tab: chrome.tabs.Tab | null = {
      id: 7,
      url: "chrome-extension://test/canvas.html",
      status: "complete",
      title: "Canvas"
    };
    const removedListeners = new Set<TabRemovedListener>();

    globalThis.chrome = {
      runtime: {
        lastError: null
      },
      tabs: {
        get: vi.fn(async (tabId: number) => tabId === 7 ? tab : null),
        remove: vi.fn((tabId: number, _callback?: () => void) => {
          setTimeout(() => {
            if (tabId !== 7) {
              return;
            }
            tab = null;
            for (const listener of removedListeners) {
              listener(tabId);
            }
          }, 50);
        }),
        onRemoved: {
          addListener: vi.fn((listener: TabRemovedListener) => {
            removedListeners.add(listener);
          }),
          removeListener: vi.fn((listener: TabRemovedListener) => {
            removedListeners.delete(listener);
          })
        }
      }
    } as unknown as typeof chrome;

    const manager = new TabManager();
    const closePromise = manager.closeTab(7, 1000);

    await vi.advanceTimersByTimeAsync(80);

    await expect(closePromise).resolves.toBeUndefined();
    expect(removedListeners.size).toBe(0);
  });
});

describe("TabManager.getFirstAttachableTab", () => {
  const originalChrome = globalThis.chrome;

  afterEach(() => {
    globalThis.chrome = originalChrome;
    vi.restoreAllMocks();
  });

  it("skips restricted tabs and supports excluding the current tab", async () => {
    globalThis.chrome = {
      tabs: {
        query: vi.fn(async () => ([
          { id: 1, url: "chrome://newtab/", title: "New Tab" },
          { id: 2, url: "https://example.com/", title: "Example" },
          { id: 3, url: "https://github.com/", title: "GitHub" }
        ]))
      }
    } as unknown as typeof chrome;

    const manager = new TabManager();

    await expect(manager.getFirstAttachableTab()).resolves.toMatchObject({
      id: 2,
      url: "https://example.com/"
    });
    await expect(manager.getFirstAttachableTab(2)).resolves.toMatchObject({
      id: 3,
      url: "https://github.com/"
    });
    await expect(manager.getFirstHttpTabId(3)).resolves.toBe(2);
  });
});
