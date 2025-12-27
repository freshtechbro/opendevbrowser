import type { Page } from "playwright-core";

const TOKEN_LIKE_PATTERN = /\b[A-Za-z0-9_\-]{24,}\b/g;
const SENSITIVE_KV_PATTERN = /\b(token|key|secret|password|auth|bearer|credential)[=:]\s*\S+/gi;

function redactText(text: string): string {
  let result = text.replace(SENSITIVE_KV_PATTERN, (match) => {
    const sepIndex = match.search(/[=:]/);
    if (sepIndex === -1) return match;
    return match.slice(0, sepIndex + 1) + "[REDACTED]";
  });
  result = result.replace(TOKEN_LIKE_PATTERN, "[REDACTED]");
  return result;
}

export type ConsoleEvent = {
  seq: number;
  level: string;
  text: string;
  ts: number;
};

export class ConsoleTracker {
  private events: ConsoleEvent[] = [];
  private maxEvents: number;
  private seq: number = 0;
  private page: Page | null = null;
  private handler?: (msg: { type(): string; text(): string }) => void;

  constructor(maxEvents = 200) {
    this.maxEvents = maxEvents;
  }

  attach(page: Page): void {
    if (this.page === page) return;
    this.detach();

    this.page = page;
    this.handler = (msg) => {
      this.seq += 1;
      this.events.push({
        seq: this.seq,
        level: msg.type(),
        text: redactText(msg.text()),
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
