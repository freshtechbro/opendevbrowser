import { describe, it, expect } from "vitest";
import { EventEmitter } from "events";
import { ConsoleTracker } from "../src/devtools/console-tracker";
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
    tracker.detach();
    tracker.detach();
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
      text: () => "trace id abcdef1234567890abcdef1234567890"
    });

    const poll = tracker.poll(0, 10);
    expect(poll.events[0]?.text).toContain("abcdef1234567890abcdef1234567890");
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
});
