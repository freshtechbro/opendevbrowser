import { afterEach, describe, expect, it, vi } from "vitest";
import { TabManager } from "../extension/src/services/TabManager";

type TabUpdatedListener = (tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => void;

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
