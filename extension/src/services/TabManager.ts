import { getRestrictionMessage } from "./url-restrictions.js";

export class TabManager {
  async createTab(url?: string, active: boolean = true): Promise<chrome.tabs.Tab> {
    return await new Promise((resolve, reject) => {
      chrome.tabs.create({ url, active }, (tab) => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          reject(new Error(lastError.message));
          return;
        }
        if (!tab) {
          reject(new Error("Tab creation failed"));
          return;
        }
        resolve(tab);
      });
    });
  }

  async waitForTabComplete(tabId: number, timeoutMs = 10000): Promise<void> {
    const isComplete = async (): Promise<boolean> => {
      const current = await this.getTab(tabId);
      return current?.status === "complete";
    };
    if (await isComplete()) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let pollId: number | null = null;
      const settle = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        if (pollId !== null) {
          clearInterval(pollId);
        }
        chrome.tabs.onUpdated.removeListener(listener);
        if (error) {
          reject(error);
          return;
        }
        resolve();
      };
      const timeoutId = setTimeout(() => {
        settle(new Error("Tab load timeout"));
      }, timeoutMs);

      const listener = (updatedId: number, changeInfo: chrome.tabs.OnUpdatedInfo, tab?: chrome.tabs.Tab) => {
        if (updatedId !== tabId) {
          return;
        }
        if (changeInfo.status === "complete" || tab?.status === "complete") {
          settle();
        }
      };

      chrome.tabs.onUpdated.addListener(listener);
      const poll = () => {
        void isComplete()
          .then((complete) => {
            if (complete) {
              settle();
            }
          })
          .catch(() => {
            // Ignore transient tab lookup failures and let the timeout decide.
          });
      };
      pollId = setInterval(poll, Math.min(250, Math.max(50, Math.floor(timeoutMs / 20))));
      poll();
    });
  }

  async closeTab(tabId: number, timeoutMs = 2000): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let pollId: number | null = null;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        if (pollId !== null) {
          clearInterval(pollId);
        }
        chrome.tabs.onRemoved?.removeListener?.(removedListener);
        if (error) {
          reject(error);
          return;
        }
        resolve();
      };
      const removedListener = (removedTabId: number) => {
        if (removedTabId === tabId) {
          finish();
        }
      };
      const checkClosed = () => {
        void this.getTab(tabId)
          .then((tab) => {
            if (!tab) {
              finish();
            }
          })
          .catch(() => {
            finish();
          });
      };
      const timeoutId = setTimeout(() => {
        void this.getTab(tabId)
          .then((tab) => {
            if (!tab) {
              finish();
              return;
            }
            finish(new Error("Tab close timed out"));
          })
          .catch(() => {
            finish();
          });
      }, timeoutMs);

      chrome.tabs.onRemoved?.addListener?.(removedListener);
      pollId = setInterval(checkClosed, Math.min(250, Math.max(50, Math.floor(timeoutMs / 20))));
      try {
        chrome.tabs.remove(tabId, () => {
          const lastError = chrome.runtime.lastError;
          if (lastError) {
            const message = lastError.message ?? "Tab close failed";
            if (message.includes("No tab with id")) {
              finish();
              return;
            }
            finish(new Error(message));
            return;
          }
          finish();
        });
      } catch (error) {
        finish(error instanceof Error ? error : new Error("Tab close failed"));
        return;
      }
      checkClosed();
    });
  }

  async activateTab(tabId: number): Promise<chrome.tabs.Tab | null> {
    return await new Promise((resolve, reject) => {
      chrome.tabs.update(tabId, { active: true }, (tab) => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          reject(new Error(lastError.message));
          return;
        }
        resolve(tab ?? null);
      });
    });
  }

  async getTab(tabId: number): Promise<chrome.tabs.Tab | null> {
    try {
      return await chrome.tabs.get(tabId);
    } catch {
      return null;
    }
  }

  async getActiveTab(): Promise<chrome.tabs.Tab | null> {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return tabs[0] ?? null;
  }

  async getActiveTabId(): Promise<number | null> {
    const tab = await this.getActiveTab();
    return tab?.id ?? null;
  }

  async getFirstAttachableTab(excludeTabId?: number): Promise<chrome.tabs.Tab | null> {
    const tabs = await chrome.tabs.query({});
    const match = tabs.find((tab) => {
      if (typeof tab.id !== "number") return false;
      if (typeof excludeTabId === "number" && tab.id === excludeTabId) return false;
      const rawUrl = tab.url ?? tab.pendingUrl;
      if (!rawUrl) return false;
      try {
        return !getRestrictionMessage(new URL(rawUrl));
      } catch {
        return false;
      }
    });
    return match ?? null;
  }

  async getFirstHttpTabId(excludeTabId?: number): Promise<number | null> {
    const tab = await this.getFirstAttachableTab(excludeTabId);
    return typeof tab?.id === "number" ? tab.id : null;
  }
}
