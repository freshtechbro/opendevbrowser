import type { Page, Request, Response } from "playwright-core";

function shouldRedactPathSegment(segment: string): boolean {
  if (segment.length < 16) return false;
  if (/^\d+$/.test(segment)) return false;
  if (/^[a-f0-9-]{36}$/i.test(segment)) return false;
  if (/^(sk_|pk_|api_|key_|token_|secret_|bearer_)/i.test(segment)) return true;
  const categories = [/[a-z]/, /[A-Z]/, /\d/, /[_-]/].filter(r => r.test(segment)).length;
  return categories >= 3 && segment.length >= 20;
}

function redactUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    parsed.search = "";
    parsed.hash = "";
    const segments = parsed.pathname.split("/");
    const redactedSegments = segments.map(segment =>
      shouldRedactPathSegment(segment) ? "[REDACTED]" : segment
    );
    parsed.pathname = redactedSegments.join("/");
    return parsed.toString();
  } catch {
    return rawUrl.split(/[?#]/)[0] || rawUrl;
  }
}

export type NetworkEvent = {
  seq: number;
  method: string;
  url: string;
  status?: number;
  resourceType?: string;
  ts: number;
};

export type NetworkTrackerOptions = {
  showFullUrls?: boolean;
};

export class NetworkTracker {
  private events: NetworkEvent[] = [];
  private maxEvents: number;
  private seq: number = 0;
  private page: Page | null = null;
  private requestHandler?: (req: Request) => void;
  private responseHandler?: (res: Response) => void;
  private showFullUrls: boolean;
  private listeners = new Set<(event: NetworkEvent) => void>();

  constructor(maxEvents = 300, options: NetworkTrackerOptions = {}) {
    this.maxEvents = maxEvents;
    this.showFullUrls = options.showFullUrls ?? false;
  }

  setOptions(options: NetworkTrackerOptions): void {
    if (typeof options.showFullUrls === "boolean") {
      this.showFullUrls = options.showFullUrls;
    }
  }

  attach(page: Page): void {
    if (this.page === page) return;
    this.detach();

    this.page = page;
    this.requestHandler = (req) => {
      this.push({
        method: req.method(),
        url: this.showFullUrls ? req.url() : redactUrl(req.url()),
        resourceType: req.resourceType(),
        ts: Date.now()
      });
    };

    this.responseHandler = (res) => {
      const req = res.request();
      this.push({
        method: req.method(),
        url: this.showFullUrls ? res.url() : redactUrl(res.url()),
        status: res.status(),
        resourceType: req.resourceType(),
        ts: Date.now()
      });
    };

    page.on("request", this.requestHandler);
    page.on("response", this.responseHandler);
  }

  detach(): void {
    if (this.page && this.requestHandler) {
      this.page.off("request", this.requestHandler);
    }
    if (this.page && this.responseHandler) {
      this.page.off("response", this.responseHandler);
    }
    this.page = null;
    this.requestHandler = undefined;
    this.responseHandler = undefined;
  }

  poll(sinceSeq = 0, max = 50): { events: NetworkEvent[]; nextSeq: number; truncated?: boolean } {
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

  subscribe(listener: (event: NetworkEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private push(event: Omit<NetworkEvent, "seq">): void {
    this.seq += 1;
    const nextEvent: NetworkEvent = {
      seq: this.seq,
      ...event
    };
    this.events.push(nextEvent);

    if (this.events.length > this.maxEvents) {
      this.events.shift();
    }

    for (const listener of this.listeners) {
      try {
        listener(nextEvent);
      } catch {
        // Listeners must not break network tracking.
      }
    }
  }
}
