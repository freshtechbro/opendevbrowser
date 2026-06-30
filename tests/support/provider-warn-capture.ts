import { afterEach, beforeEach, expect, vi } from "vitest";

const EXPECTED_PROVIDER_WARN_EVENTS = new Set([
  "provider.realism.violation",
  "provider.signal.transition",
  "provider.tier.transition"
]);

type ConsoleWarnArgs = Parameters<typeof console.warn>;

type CapturedProviderWarn = {
  event: string;
  entry: string;
};

const parseProviderWarnEvent = (args: ConsoleWarnArgs): string | null => {
  const entry = args.length === 1 && typeof args[0] === "string" ? args[0] : "";
  if (!entry.includes('"level":"warn"')) return null;
  try {
    const payload = JSON.parse(entry) as { event?: unknown };
    return typeof payload.event === "string" ? payload.event : null;
  } catch {
    return null;
  }
};

export const installExpectedProviderWarnCapture = (): { captured: CapturedProviderWarn[] } => {
  const state: { captured: CapturedProviderWarn[] } = { captured: [] };
  let originalWarn: typeof console.warn;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    state.captured = [];
    originalWarn = console.warn;
    warnSpy = vi.spyOn(console, "warn").mockImplementation((...args: ConsoleWarnArgs) => {
      const event = parseProviderWarnEvent(args);
      if (event && EXPECTED_PROVIDER_WARN_EVENTS.has(event)) {
        state.captured.push({ event, entry: String(args[0]) });
        return;
      }
      originalWarn(...args);
    });
  });

  afterEach(() => {
    expect(state.captured.every((entry) => EXPECTED_PROVIDER_WARN_EVENTS.has(entry.event))).toBe(true);
    warnSpy.mockRestore();
  });

  return state;
};
