import type { Page } from "playwright-core";

const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const TOKEN_LIKE_PATTERN = /\b[A-Za-z0-9_-]{16,}\b/g;
const API_KEY_PREFIX_PATTERN = /\b(sk_|pk_|api_|key_|token_|secret_|bearer_)[A-Za-z0-9_-]+\b/gi;
const SENSITIVE_KV_PATTERN = /\b(token|key|secret|password|auth|bearer|credential)[=:]\s*\S+/gi;

function shouldRedactToken(token: string): boolean {
  if (/^(sk_|pk_|api_|key_|token_|secret_|bearer_)/i.test(token)) {
    return true;
  }
  const categories = [
    /[a-z]/.test(token),
    /[A-Z]/.test(token),
    /\d/.test(token),
    /[_-]/.test(token)
  ].filter(Boolean).length;
  return categories >= 2;
}

function redactText(text: string): string {
  let result = text.replace(SENSITIVE_KV_PATTERN, (match) => {
    const sepIndex = match.search(/[=:]/);
    return match.slice(0, sepIndex + 1) + "[REDACTED]";
  });
  result = result.replace(JWT_PATTERN, "[REDACTED]");
  result = result.replace(API_KEY_PREFIX_PATTERN, "[REDACTED]");
  result = result.replace(TOKEN_LIKE_PATTERN, (match) => (
    shouldRedactToken(match) ? "[REDACTED]" : match
  ));
  return result;
}

export type ConsoleEvent = {
  seq: number;
  level: string;
  text: string;
  ts: number;
};

export type ConsoleTrackerOptions = {
  showFullConsole?: boolean;
};

export class ConsoleTracker {
  private events: ConsoleEvent[] = [];
  private maxEvents: number;
  private seq: number = 0;
  private page: Page | null = null;
  private handler?: (msg: { type(): string; text(): string }) => void;
  private showFullConsole: boolean;

  constructor(maxEvents = 200, options: ConsoleTrackerOptions = {}) {
    this.maxEvents = maxEvents;
    this.showFullConsole = options.showFullConsole ?? false;
  }

  setOptions(options: ConsoleTrackerOptions): void {
    if (typeof options.showFullConsole === "boolean") {
      this.showFullConsole = options.showFullConsole;
    }
  }

  attach(page: Page): void {
    if (this.page === page) return;
    this.detach();

    this.page = page;
    this.handler = (msg) => {
      const rawText = msg.text();
      const text = this.showFullConsole ? rawText : redactText(rawText);
      this.seq += 1;
      this.events.push({
        seq: this.seq,
        level: msg.type(),
        text,
        ts: Date.now()
      });
      if (this.events.length > this.maxEvents) {
        this.events.shift();
      }
    };

    page.on("console", this.handler);
  }

  detach(): void {
    if (this.page && this.handler) {
      this.page.off("console", this.handler);
    }
    this.page = null;
    this.handler = undefined;
  }

  poll(sinceSeq = 0, max = 50): { events: ConsoleEvent[]; nextSeq: number } {
    const events = this.events.filter((event) => event.seq > sinceSeq).slice(0, max);
    const last = events[events.length - 1];
    const nextSeq = last ? last.seq : sinceSeq;
    return { events, nextSeq };
  }
}

export const __test__ = {
  redactText,
  shouldRedactToken
};
