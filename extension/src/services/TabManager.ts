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

  async closeTab(tabId: number): Promise<void> {
    await new Promise<void>((resolve) => {
      chrome.tabs.remove(tabId, () => resolve());
    });
  }

  async activateTab(tabId: number): Promise<chrome.tabs.Tab | null> {
    return await new Promise((resolve) => {
      chrome.tabs.update(tabId, { active: true }, (tab) => {
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
