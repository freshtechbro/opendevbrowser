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
    const existing = await this.getTab(tabId);
    if (existing?.status === "complete") {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timeoutId = setTimeout(() => {
        if (settled) return;
        settled = true;
        chrome.tabs.onUpdated.removeListener(listener);
        reject(new Error("Tab load timeout"));
      }, timeoutMs);

      const listener = (updatedId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
        if (updatedId !== tabId) {
          return;
        }
        if (changeInfo.status === "complete") {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutId);
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };

      chrome.tabs.onUpdated.addListener(listener);
    });
  }

  async closeTab(tabId: number): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      chrome.tabs.remove(tabId, () => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          reject(new Error(lastError.message));
          return;
        }
        resolve();
      });
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
}
