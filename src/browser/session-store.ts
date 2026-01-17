import type { Browser, BrowserContext } from "playwright-core";

export type BrowserMode = "managed" | "cdpConnect" | "extension";

export type BrowserSession = {
  id: string;
  mode: BrowserMode;
  browser: Browser;
  context: BrowserContext;
};

export class SessionStore {
  private sessions = new Map<string, BrowserSession>();

  add(session: BrowserSession): void {
    this.sessions.set(session.id, session);
  }

  get(sessionId: string): BrowserSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Unknown sessionId: ${sessionId}`);
    }
    return session;
  }

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  delete(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  list(): BrowserSession[] {
    return Array.from(this.sessions.values());
  }
}
