import type { Page, Request, Response } from "playwright-core";

const SENSITIVE_PARAM_PATTERNS = /^(token|key|secret|password|auth|api_key|apikey|access_token|refresh_token|session|bearer|credential)$/i;

function redactUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    const redactedParams: string[] = [];
    parsed.searchParams.forEach((_, key) => {
      if (SENSITIVE_PARAM_PATTERNS.test(key)) {
        redactedParams.push(key);
      }
    });
    for (const key of redactedParams) {
      parsed.searchParams.set(key, "[REDACTED]");
    }
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return rawUrl.split("?")[0] ?? rawUrl;
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

export class NetworkTracker {
  private events: NetworkEvent[] = [];
  private maxEvents: number;
  private seq: number = 0;
  private page: Page | null = null;
  private requestHandler?: (req: Request) => void;
  private responseHandler?: (res: Response) => void;

  constructor(maxEvents = 300) {
    this.maxEvents = maxEvents;
  }

  attach(page: Page): void {
    if (this.page === page) return;
    this.detach();

    this.page = page;
    this.requestHandler = (req) => {
      this.push({
        method: req.method(),
        url: redactUrl(req.url()),
        resourceType: req.resourceType(),
        ts: Date.now()
      });
    };

    this.responseHandler = (res) => {
      const req = res.request();
      this.push({
        method: req.method(),
        url: redactUrl(res.url()),
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

  poll(sinceSeq = 0, max = 50): { events: NetworkEvent[]; nextSeq: number } {
    const events = this.events.filter((event) => event.seq > sinceSeq).slice(0, max);
    const last = events[events.length - 1];
    const nextSeq = last ? last.seq : sinceSeq;
    return { events, nextSeq };
  }

  private push(event: Omit<NetworkEvent, "seq">): void {
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
