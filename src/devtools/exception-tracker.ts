import type { Page } from "playwright-core";

const STACK_LOCATION_PATTERN = /\(?((?:[a-zA-Z]+:)?\/\/[^\s)]+|\/[^\s)]+):(\d+):(\d+)\)?/;
const TRACE_ID_PATTERN = /\btrace(?:_?id)?[:=]\s*([a-zA-Z0-9_-]{8,64})\b/i;

export type ExceptionEvent = {
  seq: number;
  ts: number;
  name: string;
  message: string;
  stack?: string;
  sourceUrl?: string;
  line?: number;
  column?: number;
  category: "pageerror" | "runtime" | "unknown";
  traceId?: string;
};

type StackLocation = {
  sourceUrl?: string;
  line?: number;
  column?: number;
};

function parseStackLocation(stack: string | undefined): StackLocation {
  if (!stack) {
    return {};
  }
  for (const line of stack.split("\n")) {
    const match = STACK_LOCATION_PATTERN.exec(line);
    if (!match) {
      continue;
    }
    const sourceUrl = match[1];
    const lineNo = Number(match[2]);
    const columnNo = Number(match[3]);
    return {
      sourceUrl,
      line: Number.isFinite(lineNo) ? lineNo : undefined,
      column: Number.isFinite(columnNo) ? columnNo : undefined
    };
  }
  return {};
}

function deriveTraceId(error: Error): string | undefined {
  const match = TRACE_ID_PATTERN.exec(`${error.name} ${error.message} ${error.stack ?? ""}`);
  return match?.[1];
}

function normalizeError(error: Error): Omit<ExceptionEvent, "seq"> {
  const location = parseStackLocation(error.stack);
  return {
    ts: Date.now(),
    name: error.name || "Error",
    message: error.message || "Unknown page error",
    stack: error.stack,
    sourceUrl: location.sourceUrl,
    line: location.line,
    column: location.column,
    category: "pageerror",
    traceId: deriveTraceId(error)
  };
}

export class ExceptionTracker {
  private events: ExceptionEvent[] = [];
  private readonly maxEvents: number;
  private seq = 0;
  private page: Page | null = null;
  private pageErrorHandler?: (error: Error) => void;

  constructor(maxEvents = 200) {
    this.maxEvents = maxEvents;
  }

  attach(page: Page): void {
    if (this.page === page) return;
    this.detach();

    this.page = page;
    this.pageErrorHandler = (error: Error) => {
      this.push(normalizeError(error));
    };

    page.on("pageerror", this.pageErrorHandler);
  }

  detach(): void {
    if (this.page && this.pageErrorHandler) {
      this.page.off("pageerror", this.pageErrorHandler);
    }
    this.page = null;
    this.pageErrorHandler = undefined;
  }

  poll(sinceSeq = 0, max = 50): { events: ExceptionEvent[]; nextSeq: number; truncated?: boolean } {
    const pending = this.events.filter((event) => event.seq > sinceSeq);
    const events = pending.slice(0, max);
    const last = events[events.length - 1];
    return {
      events,
      nextSeq: last ? last.seq : sinceSeq,
      truncated: pending.length > events.length
    };
  }

  private push(event: Omit<ExceptionEvent, "seq">): void {
    this.seq += 1;
    this.events.push({
      seq: this.seq,
      ...event
    });
    if (this.events.length > this.maxEvents) {
      this.events.shift();
    }
  }
}

export const __test__ = {
  parseStackLocation,
  deriveTraceId
};
