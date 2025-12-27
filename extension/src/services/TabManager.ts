export class TabManager {
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
