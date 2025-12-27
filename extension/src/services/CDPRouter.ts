import type { RelayCommand, RelayEvent, RelayResponse } from "../types";

type RelayCallbacks = {
  onEvent: (event: RelayEvent) => void;
  onResponse: (response: RelayResponse) => void;
  onDetach: () => void;
};

export class CDPRouter {
  private debuggee: chrome.debugger.Debuggee | null = null;
  private callbacks: RelayCallbacks | null = null;
  private handleEventBound = (source: chrome.debugger.Debuggee, method: string, params?: object) => {
    this.handleEvent(source, method, params);
  };
  private handleDetachBound = (source: chrome.debugger.Debuggee) => {
    this.handleDetach(source);
  };

  setCallbacks(callbacks: RelayCallbacks): void {
    this.callbacks = callbacks;
  }

  async attach(tabId: number): Promise<void> {
    if (this.debuggee?.tabId === tabId) {
      return;
    }
    if (this.debuggee) {
      await this.detach();
    }
    this.debuggee = { tabId };
    try {
      await this.runDebuggerAction((done) => {
        chrome.debugger.attach(this.debuggee as chrome.debugger.Debuggee, "1.3", done);
      });
      chrome.debugger.onEvent.addListener(this.handleEventBound);
      chrome.debugger.onDetach.addListener(this.handleDetachBound);
    } catch (error) {
      this.debuggee = null;
      throw error;
    }
  }

  async detach(): Promise<void> {
    if (!this.debuggee) return;
    const current = this.debuggee;
    this.debuggee = null;
    chrome.debugger.onEvent.removeListener(this.handleEventBound);
    chrome.debugger.onDetach.removeListener(this.handleDetachBound);
    await this.runDebuggerAction((done) => {
      chrome.debugger.detach(current, done);
    });
  }

  getAttachedTabId(): number | null {
    return this.debuggee?.tabId ?? null;
  }

  async handleCommand(command: RelayCommand): Promise<void> {
    if (!this.debuggee || !this.callbacks) {
      this.callbacks?.onResponse({ id: command.id, error: { message: "No tab attached" } });
      return;
    }

    const { method, params, sessionId } = command.params;
    if (sessionId && method !== "Target.sendMessageToTarget") {
      const message = JSON.stringify({ id: command.id, method, params });
      try {
        await this.sendCommand("Target.sendMessageToTarget", { sessionId, message });
      } catch (error) {
        this.callbacks.onResponse({ id: command.id, error: { message: getErrorMessage(error) } });
      }
      return;
    }

    try {
      const result = await this.sendCommand(method, params ?? {});
      this.callbacks.onResponse({ id: command.id, result });
    } catch (error) {
      this.callbacks.onResponse({ id: command.id, error: { message: getErrorMessage(error) } });
    }
  }

  private async sendCommand(method: string, params: object): Promise<unknown> {
    if (!this.debuggee) {
      throw new Error("No tab attached");
    }
    return new Promise((resolve, reject) => {
      chrome.debugger.sendCommand(this.debuggee as chrome.debugger.Debuggee, method, params, (result) => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          reject(new Error(lastError.message));
          return;
        }
        resolve(result);
      });
    });
  }

  private async runDebuggerAction(action: (done: () => void) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      action(() => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          reject(new Error(lastError.message));
          return;
        }
        resolve();
      });
    });
  }

  private handleEvent(source: chrome.debugger.Debuggee, method: string, params?: object): void {
    if (!this.matchesDebuggee(source) || !this.callbacks) {
      return;
    }

    if (method === "Target.receivedMessageFromTarget" && params && isRecord(params)) {
      const nested = parseNestedMessage(params.message);
      const sessionId = typeof params.sessionId === "string" ? params.sessionId : undefined;
      if (nested && (typeof nested.id === "string" || typeof nested.id === "number")) {
        const error = normalizeError(nested.error);
        this.callbacks.onResponse({
          id: nested.id,
          result: nested.result,
          error,
          sessionId
        });
        return;
      }
      if (nested && typeof nested.method === "string") {
        this.callbacks.onEvent({
          method: "forwardCDPEvent",
          params: {
            method: nested.method,
            params: nested.params,
            sessionId
          }
        });
        return;
      }
    }

    this.callbacks.onEvent({
      method: "forwardCDPEvent",
      params: {
        method,
        params
      }
    });
  }

  private handleDetach(source: chrome.debugger.Debuggee): void {
    if (!this.matchesDebuggee(source) || !this.callbacks) {
      return;
    }
    this.callbacks.onDetach();
  }

  private matchesDebuggee(source: chrome.debugger.Debuggee): boolean {
    if (!this.debuggee) return false;
    return source.tabId === this.debuggee.tabId;
  }
}

const parseNestedMessage = (value: unknown): Record<string, unknown> | null => {
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return parsed;
  } catch {
    return null;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown error";
};

const normalizeError = (value: unknown): { message: string } | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const message = value.message;
  if (typeof message !== "string") {
    return undefined;
  }
  return { message };
};
