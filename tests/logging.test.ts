import { describe, expect, it, vi } from "vitest";
import { __test__, createLogger, redactSensitive } from "../src/core/logging";

describe("logging", () => {
  it("emits structured envelopes", () => {
    const entries: unknown[] = [];
    const logger = createLogger("test", (entry) => entries.push(entry));

    const payload = logger.info("event.name", {
      requestId: "req-1",
      sessionId: "session-1",
      traceId: "trace-1",
      data: { hello: "world" }
    });

    expect(payload).toMatchObject({
      level: "info",
      module: "test",
      event: "event.name",
      requestId: "req-1",
      sessionId: "session-1",
      traceId: "trace-1",
      data: { hello: "world" }
    });
    expect(entries.length).toBe(1);
  });

  it("redacts sensitive keys and token-like values", () => {
    const redacted = redactSensitive({
      apiKey: "sk_live_abcdef123456",
      nested: {
        authorization: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc.def"
      },
      note: "safe"
    });

    expect(redacted).toMatchObject({
      apiKey: "[REDACTED]",
      nested: { authorization: "[REDACTED]" },
      note: "safe"
    });
  });

  it("redacts token strings in helper", () => {
    const value = __test__.redactString("token sk_live_abcdef123456 and eyJabc.def.ghi");
    expect(value).toContain("[REDACTED]");
    expect(value).not.toContain("sk_live_abcdef123456");
  });

  it("redacts arrays and circular references", () => {
    const circular: Record<string, unknown> = {
      token: "sk_live_secret_123456"
    };
    circular.self = circular;

    const redacted = redactSensitive({
      list: ["safe", "Bearer token_abcdef123", circular]
    }) as { list: unknown[] };

    expect(redacted.list[0]).toBe("safe");
    expect(redacted.list[1]).toBe("[REDACTED]");
    expect(redacted.list[2]).toMatchObject({
      token: "[REDACTED]",
      self: "[Circular]"
    });
  });

  it("routes default sink by level", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      __test__.defaultSink({
        ts: "2026-01-01T00:00:00.000Z",
        level: "info",
        module: "test",
        event: "info.event",
        requestId: "req-1"
      });
      __test__.defaultSink({
        ts: "2026-01-01T00:00:01.000Z",
        level: "warn",
        module: "test",
        event: "warn.event",
        requestId: "req-2"
      });
      __test__.defaultSink({
        ts: "2026-01-01T00:00:02.000Z",
        level: "error",
        module: "test",
        event: "error.event",
        requestId: "req-3"
      });

      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledTimes(1);
    } finally {
      logSpy.mockRestore();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it("emits all logger levels and optional fields", () => {
    const entries: Array<{ level: string; data?: unknown; sessionId?: string }> = [];
    const logger = createLogger("audit-test", (entry) => entries.push(entry));

    const debugEntry = logger.debug("debug.event");
    logger.warn("warn.event", { data: { password: "secret123" } });
    logger.error("error.event", { sessionId: "s1", data: { token: "sk_live_abcdef123456" } });
    const auditEntry = logger.audit("audit.event", { traceId: "trace-1", data: ["value", "Bearer token_abc123"] });

    expect(debugEntry.level).toBe("debug");
    expect(debugEntry.sessionId).toBeUndefined();
    expect(entries.find((entry) => entry.level === "warn")).toMatchObject({
      data: { password: "[REDACTED]" }
    });
    expect(entries.find((entry) => entry.level === "error")).toMatchObject({
      sessionId: "s1",
      data: { token: "[REDACTED]" }
    });
    expect(auditEntry.level).toBe("audit");
    expect(auditEntry.traceId).toBe("trace-1");
    expect(auditEntry.data).toEqual(["value", "[REDACTED]"]);
  });
});
