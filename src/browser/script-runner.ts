import type { BrowserManagerLike } from "./manager-types";

export type RunStep = {
  action: string;
  args?: Record<string, unknown>;
};

export type RunResult = {
  i: number;
  ok: boolean;
  data?: unknown;
  error?: { message: string };
};

export class ScriptRunner {
  private manager: BrowserManagerLike;

  constructor(manager: BrowserManagerLike) {
    this.manager = manager;
  }

  async run(sessionId: string, steps: RunStep[], stopOnError = true): Promise<{ results: RunResult[]; timingMs: number }> {
    const startTime = Date.now();
    const results: RunResult[] = [];

    for (let i = 0; i < steps.length; i += 1) {
      const step = steps[i];
      if (!step) {
        continue;
      }
      try {
        const data = await this.executeStep(sessionId, step);
        results.push({ i, ok: true, data });
      } catch (error) {
        results.push({
          i,
          ok: false,
          error: { message: error instanceof Error ? error.message : "Unknown error" }
        });
        if (stopOnError) {
          break;
        }
      }
    }

    return { results, timingMs: Date.now() - startTime };
  }

  private async executeStep(sessionId: string, step: RunStep): Promise<unknown> {
    const args = step.args ?? {};

    switch (step.action) {
      case "goto":
        return this.manager.goto(
          sessionId,
          requireString(args.url, "url"),
          requireWaitUntil(args.waitUntil),
          requireNumber(args.timeoutMs, 30000)
        );
      case "wait":
        if (typeof args.ref === "string") {
          const ref = args.ref;
          const state = requireState(args.state);
          const timeoutMs = requireNumber(args.timeoutMs, 30000);
          return withRetry("wait", () => this.manager.waitForRef(
            sessionId,
            ref,
            state,
            timeoutMs
          ));
        }
        return withRetry("wait", () => this.manager.waitForLoad(
          sessionId,
          requireWaitUntil(args.until),
          requireNumber(args.timeoutMs, 30000)
        ));
      case "snapshot":
        return this.manager.snapshot(
          sessionId,
          requireSnapshotMode(args.format ?? args.mode),
          requireNumber(args.maxChars, 16000),
          typeof args.cursor === "string" ? args.cursor : undefined
        );
      case "click":
        return withRetry("click", () => this.manager.click(sessionId, requireString(args.ref, "ref")));
      case "type":
        return withRetry("type", () => this.manager.type(
          sessionId,
          requireString(args.ref, "ref"),
          requireString(args.text, "text"),
          Boolean(args.clear),
          Boolean(args.submit)
        ));
      case "select":
        return withRetry("select", () => this.manager.select(
          sessionId,
          requireString(args.ref, "ref"),
          requireStringArray(args.values, "values")
        ));
      case "scroll":
        return withRetry("scroll", () => this.manager.scroll(
          sessionId,
          requireNumber(args.dy, 0),
          typeof args.ref === "string" ? args.ref : undefined
        ));
      case "dom_get_html":
        return this.manager.domGetHtml(sessionId, requireString(args.ref, "ref"), requireNumber(args.maxChars, 8000));
      case "dom_get_text":
        return this.manager.domGetText(sessionId, requireString(args.ref, "ref"), requireNumber(args.maxChars, 8000));
      default:
        throw new Error(`Unknown action: ${step.action}`);
    }
  }
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing ${label}`);
  }
  return value;
}

function requireStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`Invalid ${label}`);
  }
  return value as string[];
}

function requireNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return fallback;
}

function requireWaitUntil(value: unknown): "domcontentloaded" | "load" | "networkidle" {
  if (value === "domcontentloaded" || value === "load" || value === "networkidle") {
    return value;
  }
  return "load";
}

function requireSnapshotMode(value: unknown): "outline" | "actionables" {
  if (value === "actionables") return "actionables";
  return "outline";
}

function requireState(value: unknown): "attached" | "visible" | "hidden" {
  if (value === "visible" || value === "hidden") return value;
  return "attached";
}

const RETRY_ACTIONS = new Set(["click", "type", "select", "scroll", "wait"]);
const RETRY_MAX_ATTEMPTS = 2;
const RETRY_BASE_DELAY_MS = 150;
const RETRY_MAX_DELAY_MS = 1000;

async function withRetry<T>(action: string, fn: () => Promise<T>): Promise<T> {
  if (!RETRY_ACTIONS.has(action)) {
    return fn();
  }

  let attempt = 0;
  let delay = RETRY_BASE_DELAY_MS;
  while (true) {
    try {
      return await fn();
    } catch (error) {
      attempt += 1;
      if (attempt >= RETRY_MAX_ATTEMPTS || !shouldRetry(error)) {
        throw error;
      }
      await sleep(delay);
      delay = Math.min(delay * 2, RETRY_MAX_DELAY_MS);
    }
  }
}

function shouldRetry(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  if (!message) return true;
  return !/missing|invalid|unknown ref|no active target/i.test(message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
