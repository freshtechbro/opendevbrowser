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
  category: "log" | "warning" | "error" | "debug" | "trace" | "assert" | "other";
  text: string;
  argsPreview: string;
  source?: string;
  line?: number;
  column?: number;
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
  private handler?: (msg: {
    type(): string;
    text(): string;
    location?(): {
      url?: string;
      lineNumber?: number;
      columnNumber?: number;
    };
  }) => void;
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
      const location = typeof msg.location === "function" ? msg.location() : undefined;
      const line = Number.isFinite(location?.lineNumber) ? Number(location?.lineNumber) : undefined;
      const column = Number.isFinite(location?.columnNumber) ? Number(location?.columnNumber) : undefined;
      const source = typeof location?.url === "string" && location.url.length > 0
        ? location.url
        : undefined;

      this.seq += 1;
      this.events.push({
        seq: this.seq,
        level: msg.type(),
        category: classifyConsoleCategory(msg.type()),
        text,
        argsPreview: buildArgsPreview(text),
        ...(source ? { source } : {}),
        ...(typeof line === "number" ? { line } : {}),
        ...(typeof column === "number" ? { column } : {}),
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

  poll(sinceSeq = 0, max = 50): { events: ConsoleEvent[]; nextSeq: number; truncated?: boolean } {
    const pending = this.events.filter((event) => event.seq > sinceSeq);
    const events = pending.slice(0, max);
    const last = events[events.length - 1];
    const nextSeq = last ? last.seq : sinceSeq;
    return {
      events,
      nextSeq,
      truncated: pending.length > events.length
    };
  }
}

function classifyConsoleCategory(level: string): ConsoleEvent["category"] {
  const normalized = level.toLowerCase();
  if (normalized === "warning" || normalized === "warn") return "warning";
  if (normalized === "error") return "error";
  if (normalized === "debug") return "debug";
  if (normalized === "trace") return "trace";
  if (normalized === "assert") return "assert";
  if (normalized === "log" || normalized === "info") return "log";
  return "other";
}

function buildArgsPreview(text: string): string {
  if (text.length <= 240) return text;
  return `${text.slice(0, 237)}...`;
}

export const __test__ = {
  redactText,
  shouldRedactToken,
  classifyConsoleCategory,
  buildArgsPreview
};
