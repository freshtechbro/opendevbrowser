import { describe, it, expect } from "vitest";
import { EventEmitter } from "events";
import { ConsoleTracker, __test__ as consoleTest } from "../src/devtools/console-tracker";
import { ExceptionTracker, __test__ as exceptionTest } from "../src/devtools/exception-tracker";
import { NetworkTracker } from "../src/devtools/network-tracker";

const createPage = () => {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    on: emitter.on.bind(emitter),
    off: emitter.off.bind(emitter)
  });
};

describe("ConsoleTracker", () => {
  it("collects console events", () => {
    const page = createPage();
    const tracker = new ConsoleTracker(10);

    tracker.attach(page as never);
    page.emit("console", {
      type: () => "log",
      text: () => "hello"
    });

    const poll = tracker.poll(0, 10);
    expect(poll.events.length).toBe(1);
    expect(poll.events[0]?.text).toBe("hello");
    expect(poll.events[0]?.category).toBe("log");
    expect(poll.events[0]?.argsPreview).toBe("hello");
    tracker.detach();
    tracker.detach();
  });

  it("captures structured console metadata when location is available", () => {
    const page = createPage();
    const tracker = new ConsoleTracker(10);

    tracker.attach(page as never);
    page.emit("console", {
      type: () => "warning",
      text: () => "warn message",
      location: () => ({
        url: "https://example.com/app.js",
        lineNumber: 42,
        columnNumber: 13
      })
    });

    const poll = tracker.poll(0, 10);
    expect(poll.events[0]).toMatchObject({
      category: "warning",
      source: "https://example.com/app.js",
      line: 42,
      column: 13
    });
  });

  it("marks console polling as truncated when max is lower than pending events", () => {
    const page = createPage();
    const tracker = new ConsoleTracker(10);

    tracker.attach(page as never);
    page.emit("console", { type: () => "log", text: () => "one" });
    page.emit("console", { type: () => "log", text: () => "two" });

    const poll = tracker.poll(0, 1);
    expect(poll.events).toHaveLength(1);
    expect(poll.truncated).toBe(true);
  });

  it("drops oldest console events when max exceeded", () => {
    const page = createPage();
    const tracker = new ConsoleTracker(1);

    tracker.attach(page as never);
    page.emit("console", {
      type: () => "log",
      text: () => "first"
    });
    page.emit("console", {
      type: () => "log",
      text: () => "second"
    });

    const poll = tracker.poll(0, 10);
    expect(poll.events.length).toBe(1);
    expect(poll.events[0]?.text).toBe("second");
  });

  it("redacts token-like strings in console text", () => {
    const page = createPage();
    const tracker = new ConsoleTracker(10);

    tracker.attach(page as never);
    page.emit("console", {
      type: () => "log",
      text: () => "Got token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
    });

    const poll = tracker.poll(0, 10);
    expect(poll.events[0]?.text).toContain("[REDACTED]");
    expect(poll.events[0]?.text).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9");
  });

  it("redacts sensitive key=value patterns", () => {
    const page = createPage();
    const tracker = new ConsoleTracker(10);

    tracker.attach(page as never);
    page.emit("console", {
      type: () => "log",
      text: () => "password=mysecret123 and token:abc123def456"
    });

    const poll = tracker.poll(0, 10);
    expect(poll.events[0]?.text).toContain("password=[REDACTED]");
    expect(poll.events[0]?.text).toContain("token:[REDACTED]");
    expect(poll.events[0]?.text).not.toContain("mysecret123");
  });

  it("preserves long identifiers without mixed character classes", () => {
    const page = createPage();
    const tracker = new ConsoleTracker(10);

    tracker.attach(page as never);
    page.emit("console", {
      type: () => "log",
      text: () => "trace id 1234567890123456789012345678901234567890"
    });

    const poll = tracker.poll(0, 10);
    expect(poll.events[0]?.text).toContain("1234567890123456789012345678901234567890");
  });

  it("redacts short API keys with common prefixes (16+ chars)", () => {
    const page = createPage();
    const tracker = new ConsoleTracker(10);

    tracker.attach(page as never);
    page.emit("console", {
      type: () => "log",
      text: () => "Using key sk_live_abc123def456"
    });

    const poll = tracker.poll(0, 10);
    expect(poll.events[0]?.text).toContain("[REDACTED]");
    expect(poll.events[0]?.text).not.toContain("sk_live_abc123def456");
  });

  it("redacts prefixed tokens via helper", () => {
    expect(consoleTest.shouldRedactToken("sk_live_1234567890123456")).toBe(true);
  });

  it("redacts token-like strings without prefixes via helper", () => {
    const redacted = consoleTest.redactText("session abcDEF1234567890");
    expect(redacted).toContain("[REDACTED]");
  });

  it("redacts pk_ prefixed tokens", () => {
    const page = createPage();
    const tracker = new ConsoleTracker(10);

    tracker.attach(page as never);
    page.emit("console", {
      type: () => "log",
      text: () => "Public key: pk_test_abcdef123456"
    });

    const poll = tracker.poll(0, 10);
    expect(poll.events[0]?.text).toContain("[REDACTED]");
    expect(poll.events[0]?.text).not.toContain("pk_test_abcdef123456");
  });

  it("redacts api_ prefixed tokens", () => {
    const page = createPage();
    const tracker = new ConsoleTracker(10);

    tracker.attach(page as never);
    page.emit("console", {
      type: () => "log",
      text: () => "API key: api_key_xyz789abc123"
    });

    const poll = tracker.poll(0, 10);
    expect(poll.events[0]?.text).toContain("[REDACTED]");
    expect(poll.events[0]?.text).not.toContain("api_key_xyz789abc123");
  });

  it("redacts high-entropy path segments in network URLs", () => {
    const page = createPage();
    const tracker = new NetworkTracker(10);

    tracker.attach(page as never);
    page.emit("request", {
      url: () => "https://api.example.com/v1/AbCdEf_123-XyZ_456789ab/resource",
      method: () => "GET",
      resourceType: () => "xhr"
    });

    const poll = tracker.poll(0, 10);
    expect(poll.events[0]?.url).toContain("[REDACTED]");
  });

  it("preserves low-entropy path segments", () => {
    const page = createPage();
    const tracker = new NetworkTracker(10);

    tracker.attach(page as never);
    page.emit("request", {
      url: () => "https://api.example.com/v1/users/profile",
      method: () => "GET",
      resourceType: () => "xhr"
    });

    const poll = tracker.poll(0, 10);
    expect(poll.events[0]?.url).toBe("https://api.example.com/v1/users/profile");
  });

  it("keeps full response URLs when configured", () => {
    const page = createPage();
    const tracker = new NetworkTracker(10, { showFullUrls: true });

    tracker.attach(page as never);
    const request = {
      method: () => "GET",
      url: () => "https://example.com/items",
      resourceType: () => "xhr"
    };
    const response = {
      url: () => "https://example.com/items?query=1#hash",
      status: () => 200,
      request: () => request
    };

    page.emit("response", response);

    const poll = tracker.poll(0, 10);
    expect(poll.events[0]?.url).toBe("https://example.com/items?query=1#hash");
  });

  it("falls back to raw URL parsing when URL is invalid", () => {
    const page = createPage();
    const tracker = new NetworkTracker(10);

    tracker.attach(page as never);
    page.emit("request", {
      method: () => "GET",
      url: () => "not a url?token=abc#frag",
      resourceType: () => "xhr"
    });

    const poll = tracker.poll(0, 10);
    expect(poll.events[0]?.url).toBe("not a url");
  });

  it("returns raw URL when invalid URL starts with a query string", () => {
    const page = createPage();
    const tracker = new NetworkTracker(10);

    tracker.attach(page as never);
    page.emit("request", {
      method: () => "GET",
      url: () => "?token=abc123",
      resourceType: () => "xhr"
    });

    const poll = tracker.poll(0, 10);
    expect(poll.events[0]?.url).toBe("?token=abc123");
  });

  it("redacts tokens with only 2 character categories", () => {
    const page = createPage();
    const tracker = new ConsoleTracker(10);

    tracker.attach(page as never);
    page.emit("console", {
      type: () => "log",
      text: () => "Token: abcdefghij1234567890"
    });

    const poll = tracker.poll(0, 10);
    expect(poll.events[0]?.text).toContain("[REDACTED]");
  });

  it("shows full console output when configured", () => {
    const page = createPage();
    const tracker = new ConsoleTracker(10, { showFullConsole: true });

    tracker.attach(page as never);
    page.emit("console", {
      type: () => "log",
      text: () => "token: abc123def456ghi789jkl000"
    });

    const poll = tracker.poll(0, 10);
    expect(poll.events[0]?.text).toContain("token: abc123def456ghi789jkl000");
  });

  it("updates console redaction when options change", () => {
    const page = createPage();
    const tracker = new ConsoleTracker(10);

    tracker.attach(page as never);
    tracker.setOptions({});
    page.emit("console", {
      type: () => "log",
      text: () => "token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
    });

    tracker.setOptions({ showFullConsole: true });
    page.emit("console", {
      type: () => "log",
      text: () => "token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
    });

    const poll = tracker.poll(0, 10);
    expect(poll.events[0]?.text).toContain("[REDACTED]");
    expect(poll.events[1]?.text).toContain("token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9");
  });

  it("classifies unknown console levels as other", () => {
    expect(consoleTest.classifyConsoleCategory("table")).toBe("other");
  });

  it("classifies debug, trace, and assert console levels", () => {
    expect(consoleTest.classifyConsoleCategory("debug")).toBe("debug");
    expect(consoleTest.classifyConsoleCategory("trace")).toBe("trace");
    expect(consoleTest.classifyConsoleCategory("assert")).toBe("assert");
  });

  it("truncates long args previews", () => {
    const long = "x".repeat(300);
    const preview = consoleTest.buildArgsPreview(long);
    expect(preview.length).toBe(240);
    expect(preview.endsWith("...")).toBe(true);
  });
});

describe("NetworkTracker", () => {
  it("collects network events", () => {
    const page = createPage();
    const tracker = new NetworkTracker(10);

    tracker.attach(page as never);
    const request = {
      method: () => "GET",
      url: () => "https://example.com",
      resourceType: () => "document"
    };
    const response = {
      url: () => "https://example.com",
      status: () => 200,
      request: () => request
    };

    page.emit("request", request);
    page.emit("response", response);

    const poll = tracker.poll(0, 10);
    expect(poll.events.length).toBe(2);
    expect(poll.events[1]?.status).toBe(200);
    tracker.detach();
    const empty = tracker.poll(poll.nextSeq, 10);
    expect(empty.events.length).toBe(0);
  });

  it("streams events to subscribers and supports unsubscribe", () => {
    const page = createPage();
    const tracker = new NetworkTracker(10);
    const received: number[] = [];

    const unsubscribe = tracker.subscribe((event) => {
      received.push(event.seq);
    });
    tracker.attach(page as never);

    page.emit("request", {
      method: () => "GET",
      url: () => "https://example.com/one",
      resourceType: () => "xhr"
    });
    expect(received).toEqual([1]);

    unsubscribe();
    page.emit("request", {
      method: () => "GET",
      url: () => "https://example.com/two",
      resourceType: () => "xhr"
    });
    expect(received).toEqual([1]);
  });

  it("isolates subscriber failures from network tracking", () => {
    const page = createPage();
    const tracker = new NetworkTracker(10);
    const received: number[] = [];

    tracker.subscribe(() => {
      throw new Error("listener failed");
    });
    tracker.subscribe((event) => {
      received.push(event.seq);
    });
    tracker.attach(page as never);

    page.emit("request", {
      method: () => "GET",
      url: () => "https://example.com/failure-safe",
      resourceType: () => "xhr"
    });

    expect(received).toEqual([1]);
    const poll = tracker.poll(0, 10);
    expect(poll.events).toHaveLength(1);
  });

  it("marks network polling as truncated when max is lower than pending events", () => {
    const page = createPage();
    const tracker = new NetworkTracker(10);

    tracker.attach(page as never);
    page.emit("request", {
      method: () => "GET",
      url: () => "https://example.com/one",
      resourceType: () => "xhr"
    });
    page.emit("request", {
      method: () => "GET",
      url: () => "https://example.com/two",
      resourceType: () => "xhr"
    });

    const poll = tracker.poll(0, 1);
    expect(poll.events).toHaveLength(1);
    expect(poll.truncated).toBe(true);
  });

  it("drops oldest network events when max exceeded", () => {
    const page = createPage();
    const tracker = new NetworkTracker(1);

    tracker.attach(page as never);
    const request = {
      method: () => "GET",
      url: () => "https://example.com",
      resourceType: () => "document"
    };
    const response = {
      url: () => "https://example.com",
      status: () => 200,
      request: () => request
    };

    page.emit("request", request);
    page.emit("response", response);

    const poll = tracker.poll(0, 10);
    expect(poll.events.length).toBe(1);
    expect(poll.events[0]?.status).toBe(200);
  });

  it("strips query params from URLs by default", () => {
    const page = createPage();
    const tracker = new NetworkTracker(10);

    tracker.attach(page as never);
    const request = {
      method: () => "GET",
      url: () => "https://api.example.com/data?token=secret123&user=bob&apikey=xyz789",
      resourceType: () => "xhr"
    };

    page.emit("request", request);

    const poll = tracker.poll(0, 10);
    expect(poll.events[0]?.url).toBe("https://api.example.com/data");
  });

  it("strips hash fragments from URLs", () => {
    const page = createPage();
    const tracker = new NetworkTracker(10);

    tracker.attach(page as never);
    const request = {
      method: () => "GET",
      url: () => "https://example.com/page#access_token=secret",
      resourceType: () => "document"
    };

    page.emit("request", request);

    const poll = tracker.poll(0, 10);
    expect(poll.events[0]?.url).not.toContain("#");
    expect(poll.events[0]?.url).not.toContain("access_token");
  });

  it("preserves full URLs when configured", () => {
    const page = createPage();
    const tracker = new NetworkTracker(10, { showFullUrls: true });

    tracker.attach(page as never);
    const request = {
      method: () => "GET",
      url: () => "https://api.example.com/data?token=secret123&user=bob",
      resourceType: () => "xhr"
    };

    page.emit("request", request);

    const poll = tracker.poll(0, 10);
    expect(poll.events[0]?.url).toContain("token=secret123");
    expect(poll.events[0]?.url).toContain("user=bob");
  });

  it("updates URL redaction when options change", () => {
    const page = createPage();
    const tracker = new NetworkTracker(10);

    tracker.attach(page as never);
    tracker.setOptions({});
    const request = {
      method: () => "GET",
      url: () => "https://api.example.com/data?token=secret123",
      resourceType: () => "xhr"
    };

    page.emit("request", request);
    tracker.setOptions({ showFullUrls: true });
    page.emit("request", request);

    const poll = tracker.poll(0, 10);
    expect(poll.events[0]?.url).toBe("https://api.example.com/data");
    expect(poll.events[1]?.url).toContain("token=secret123");
  });

  it("handles invalid URLs gracefully", () => {
    const page = createPage();
    const tracker = new NetworkTracker(10);

    tracker.attach(page as never);
    const request = {
      method: () => "GET",
      url: () => "not a url?token=secret123",
      resourceType: () => "xhr"
    };

    page.emit("request", request);

    const poll = tracker.poll(0, 10);
    expect(poll.events[0]?.url).toBe("not a url");
  });

  it("redacts token-like path segments", () => {
    const page = createPage();
    const tracker = new NetworkTracker(10);

    tracker.attach(page as never);
    const request = {
      method: () => "GET",
      url: () => "https://api.example.com/v1/sk_live_abc123def456xyz/resource",
      resourceType: () => "xhr"
    };

    page.emit("request", request);

    const poll = tracker.poll(0, 10);
    expect(poll.events[0]?.url).toContain("[REDACTED]");
    expect(poll.events[0]?.url).not.toContain("sk_live_abc123def456xyz");
  });

  it("preserves UUIDs in path segments", () => {
    const page = createPage();
    const tracker = new NetworkTracker(10);

    tracker.attach(page as never);
    const request = {
      method: () => "GET",
      url: () => "https://api.example.com/users/550e8400-e29b-41d4-a716-446655440000/profile",
      resourceType: () => "xhr"
    };

    page.emit("request", request);

    const poll = tracker.poll(0, 10);
    expect(poll.events[0]?.url).toContain("550e8400-e29b-41d4-a716-446655440000");
  });

  it("preserves numeric IDs in path segments", () => {
    const page = createPage();
    const tracker = new NetworkTracker(10);

    tracker.attach(page as never);
    const request = {
      method: () => "GET",
      url: () => "https://api.example.com/users/12345678901234567890/profile",
      resourceType: () => "xhr"
    };

    page.emit("request", request);

    const poll = tracker.poll(0, 10);
    expect(poll.events[0]?.url).toContain("12345678901234567890");
  });
});

describe("ExceptionTracker", () => {
  it("collects page exceptions with parsed stack location", () => {
    const page = createPage();
    const tracker = new ExceptionTracker(10);

    tracker.attach(page as never);
    const error = new Error("Boom traceId=trace_abc12345");
    error.name = "ReferenceError";
    error.stack = "ReferenceError: Boom\\n    at run (https://example.com/app.js:42:13)";

    page.emit("pageerror", error);
    const poll = tracker.poll(0, 10);

    expect(poll.events.length).toBe(1);
    expect(poll.events[0]).toMatchObject({
      name: "ReferenceError",
      message: "Boom traceId=trace_abc12345",
      sourceUrl: "https://example.com/app.js",
      line: 42,
      column: 13,
      traceId: "trace_abc12345",
      category: "pageerror"
    });
  });

  it("drops oldest exception events when max exceeded", () => {
    const page = createPage();
    const tracker = new ExceptionTracker(1);

    tracker.attach(page as never);
    page.emit("pageerror", new Error("first"));
    page.emit("pageerror", new Error("second"));

    const poll = tracker.poll(0, 10);
    expect(poll.events.length).toBe(1);
    expect(poll.events[0]?.message).toBe("second");
  });

  it("marks exception polling as truncated when max is lower than pending events", () => {
    const page = createPage();
    const tracker = new ExceptionTracker(10);

    tracker.attach(page as never);
    page.emit("pageerror", new Error("first"));
    page.emit("pageerror", new Error("second"));

    const poll = tracker.poll(0, 1);
    expect(poll.events).toHaveLength(1);
    expect(poll.truncated).toBe(true);
  });

  it("normalizes empty exception name and message", () => {
    const page = createPage();
    const tracker = new ExceptionTracker(10);

    tracker.attach(page as never);
    const error = new Error("placeholder");
    error.name = "";
    error.message = "";
    error.stack = undefined;

    page.emit("pageerror", error);
    const poll = tracker.poll(0, 10);

    expect(poll.events[0]).toMatchObject({
      name: "Error",
      message: "Unknown page error"
    });
  });

  it("exposes stack parsing helper behavior", () => {
    const parsed = exceptionTest.parseStackLocation("Error\\n    at test (/tmp/file.ts:10:3)");
    expect(parsed).toEqual({
      sourceUrl: "/tmp/file.ts",
      line: 10,
      column: 3
    });

    expect(exceptionTest.parseStackLocation(undefined)).toEqual({});

    const hugeNumber = "9".repeat(400);
    const nonFiniteLocation = exceptionTest.parseStackLocation(
      `Error\\n    at huge (/tmp/file.ts:${hugeNumber}:${hugeNumber})`
    );
    expect(nonFiniteLocation).toEqual({
      sourceUrl: "/tmp/file.ts",
      line: undefined,
      column: undefined
    });

    const traceError = new Error("trace_id=abc123456");
    traceError.stack = undefined;
    const traceId = exceptionTest.deriveTraceId(traceError);
    expect(traceId).toBe("abc123456");
  });
});
