import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolveConfig } from "../src/config";
import { AnnotationManager } from "../src/browser/annotation-manager";
import { resolveRelayEndpoint } from "../src/relay/relay-endpoints";
import { resolveDirectAnnotateAssets, runDirectAnnotate } from "../src/annotate/direct-annotator";

const socketState = vi.hoisted(() => ({
  lastSocket: null as null | {
    open: () => void;
    emit: (event: string, payload?: unknown) => void;
    sent: string[];
  }
}));

vi.mock("ws", async () => {
  const { EventEmitter } = await import("events");
  class MockWebSocket extends EventEmitter {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    readyState = MockWebSocket.CONNECTING;
    sent: string[] = [];
    url: string;

    constructor(url: string) {
      super();
      this.url = url;
      socketState.lastSocket = this;
    }

    send(data: string | ArrayBuffer | Buffer): void {
      const text = typeof data === "string" ? data : Buffer.from(data).toString("utf-8");
      this.sent.push(text);
    }

    close(): void {
      this.readyState = MockWebSocket.CLOSED;
      this.emit("close");
    }

    open(): void {
      this.readyState = MockWebSocket.OPEN;
      this.emit("open");
    }
  }

  return { WebSocket: MockWebSocket };
});
vi.mock("../src/relay/relay-endpoints", () => ({
  resolveRelayEndpoint: vi.fn()
}));
vi.mock("../src/annotate/direct-annotator", () => ({
  resolveDirectAnnotateAssets: vi.fn(),
  runDirectAnnotate: vi.fn()
}));

const nextTick = () => new Promise<void>((resolve) => queueMicrotask(resolve));

describe("AnnotationManager", () => {
  beforeEach(() => {
    socketState.lastSocket = null;
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns relay_unavailable when no relay endpoint is available", async () => {
    const config = resolveConfig({ relayPort: 0 });
    const manager = new AnnotationManager(undefined, config);
    const result = await manager.requestAnnotation({});
    expect(result.status).toBe("error");
    expect(result.error?.code).toBe("relay_unavailable");
  });

  it("uses relay annotation url when set", async () => {
    vi.mocked(resolveRelayEndpoint).mockResolvedValue({
      connectEndpoint: "ws://127.0.0.1:8787/annotation",
      reportedEndpoint: "ws://127.0.0.1:8787/annotation",
      relayPort: 8787,
      pairingRequired: false
    });

    const relay = {
      getAnnotationUrl: () => "ws://127.0.0.1:8787/annotation"
    };
    const config = resolveConfig({ relayPort: 0 });
    const manager = new AnnotationManager(undefined, config);
    manager.setRelay(relay);

    const requestPromise = manager.requestAnnotation({ screenshotMode: "none" });
    await nextTick();
    const socket = socketState.lastSocket;
    socket?.open();
    await nextTick();

    const sent = socket?.sent[0] ?? "";
    const command = JSON.parse(sent) as { payload?: { requestId?: string } };
    const requestId = command.payload?.requestId ?? "req";

    socket?.emit("message", JSON.stringify({
      type: "annotationResponse",
      payload: {
        version: 1,
        requestId,
        status: "ok",
        payload: {
          url: "https://example.com",
          timestamp: "2026-01-31T00:00:00Z",
          screenshotMode: "none",
          annotations: []
        }
      }
    }));

    const result = await requestPromise;
    expect(result.status).toBe("ok");
    expect(result.payload?.screenshotMode).toBe("none");
  });

  it("returns ok responses from the annotation channel", async () => {
    vi.mocked(resolveRelayEndpoint).mockResolvedValue({
      connectEndpoint: "ws://127.0.0.1:8787/annotation",
      reportedEndpoint: "ws://127.0.0.1:8787/annotation",
      relayPort: 8787,
      pairingRequired: false
    });

    const config = resolveConfig({ relayPort: 8787 });
    const manager = new AnnotationManager(undefined, config);
    const requestPromise = manager.requestAnnotation({ url: "https://example.com", screenshotMode: "none" });

    await nextTick();
    const socket = socketState.lastSocket;
    expect(socket).toBeTruthy();
    socket?.open();
    await nextTick();

    const sent = socket?.sent[0] ?? "";
    const command = JSON.parse(sent) as { payload?: { requestId?: string } };
    const requestId = command.payload?.requestId ?? "req";

    socket?.emit("message", "{bad-json");
    socket?.emit("message", JSON.stringify({
      type: "annotationResponse",
      payload: {
        version: 1,
        requestId: "req-other",
        status: "ok",
        payload: {
          url: "https://other.example.com",
          timestamp: "2026-01-31T00:00:00Z",
          screenshotMode: "none",
          annotations: []
        }
      }
    }));
    socket?.emit("message", Buffer.from(JSON.stringify({
      type: "annotationEvent",
      payload: { version: 1, requestId: "req-mismatch", event: "progress", message: "Ignore" }
    })));
    socket?.emit("message", Buffer.from(JSON.stringify({
      type: "annotationEvent",
      payload: { version: 1, requestId, event: "progress", message: "Working" }
    })));
    socket?.emit("message", JSON.stringify({
      type: "annotationResponse",
      payload: {
        version: 1,
        requestId,
        status: "ok",
        payload: {
          url: "https://example.com",
          timestamp: "2026-01-31T00:00:00Z",
          screenshotMode: "none",
          annotations: []
        }
      }
    }));

    const result = await requestPromise;
    expect(result.status).toBe("ok");
    expect(result.payload?.url).toBe("https://example.com");
  });

  it("sends cancel commands when responses report errors", async () => {
    vi.mocked(resolveRelayEndpoint).mockResolvedValue({
      connectEndpoint: "ws://127.0.0.1:8787/annotation",
      reportedEndpoint: "ws://127.0.0.1:8787/annotation",
      relayPort: 8787,
      pairingRequired: false
    });

    const config = resolveConfig({ relayPort: 8787 });
    const manager = new AnnotationManager(undefined, config);
    const requestPromise = manager.requestAnnotation({ screenshotMode: "visible" });

    await nextTick();
    const socket = socketState.lastSocket;
    expect(socket).toBeTruthy();
    socket?.open();
    await nextTick();

    const sent = socket?.sent[0] ?? "";
    const command = JSON.parse(sent) as { payload?: { requestId?: string } };
    const requestId = command.payload?.requestId ?? "req";

    socket?.emit("message", JSON.stringify({
      type: "annotationResponse",
      payload: {
        version: 1,
        requestId,
        status: "error",
        error: { code: "capture_failed", message: "Capture failed" }
      }
    }));

    const result = await requestPromise;
    expect(result.status).toBe("error");
    const cancelMessage = socket?.sent.find((entry) => entry.includes("\"command\":\"cancel\""));
    expect(cancelMessage).toBeTruthy();
  });

  it("returns timeout errors and cancels the command", async () => {
    vi.mocked(resolveRelayEndpoint).mockResolvedValue({
      connectEndpoint: "ws://127.0.0.1:8787/annotation",
      reportedEndpoint: "ws://127.0.0.1:8787/annotation",
      relayPort: 8787,
      pairingRequired: false
    });

    const config = resolveConfig({ relayPort: 8787 });
    const manager = new AnnotationManager(undefined, config);
    vi.useFakeTimers();

    const requestPromise = manager.requestAnnotation({ timeoutMs: 10 });
    await nextTick();
    const socket = socketState.lastSocket;
    socket?.open();

    await vi.advanceTimersByTimeAsync(11);
    const result = await requestPromise;
    expect(result.status).toBe("error");
    expect(result.error?.code).toBe("timeout");
    const cancelMessage = socket?.sent.find((entry) => entry.includes("\"command\":\"cancel\""));
    expect(cancelMessage).toBeTruthy();
  });

  it("returns relay_unavailable when the socket closes unexpectedly", async () => {
    vi.mocked(resolveRelayEndpoint).mockResolvedValue({
      connectEndpoint: "ws://127.0.0.1:8787/annotation",
      reportedEndpoint: "ws://127.0.0.1:8787/annotation",
      relayPort: 8787,
      pairingRequired: false
    });

    const config = resolveConfig({ relayPort: 8787 });
    const manager = new AnnotationManager(undefined, config);
    const requestPromise = manager.requestAnnotation({});

    await nextTick();
    const socket = socketState.lastSocket;
    socket?.open();
    await nextTick();
    socket?.emit("close");

    const result = await requestPromise;
    expect(result.status).toBe("error");
    expect(result.error?.code).toBe("relay_unavailable");
  });

  it("returns cancelled when the abort signal is already aborted", async () => {
    vi.mocked(resolveRelayEndpoint).mockResolvedValue({
      connectEndpoint: "ws://127.0.0.1:8787/annotation",
      reportedEndpoint: "ws://127.0.0.1:8787/annotation",
      relayPort: 8787,
      pairingRequired: false
    });

    const config = resolveConfig({ relayPort: 8787 });
    const manager = new AnnotationManager(undefined, config);
    const controller = new AbortController();
    controller.abort();

    const requestPromise = manager.requestAnnotation({ signal: controller.signal });
    await nextTick();

    const socket = socketState.lastSocket;
    socket?.open();

    const result = await requestPromise;
    expect(result.status).toBe("cancelled");
    const cancelMessage = socket?.sent.find((entry) => entry.includes("\"command\":\"cancel\""));
    expect(cancelMessage).toBeTruthy();
  });

  it("returns cancelled when the abort signal fires after start", async () => {
    vi.mocked(resolveRelayEndpoint).mockResolvedValue({
      connectEndpoint: "ws://127.0.0.1:8787/annotation",
      reportedEndpoint: "ws://127.0.0.1:8787/annotation",
      relayPort: 8787,
      pairingRequired: false
    });

    const config = resolveConfig({ relayPort: 8787 });
    const manager = new AnnotationManager(undefined, config);
    const controller = new AbortController();

    const requestPromise = manager.requestAnnotation({ signal: controller.signal });
    await nextTick();

    const socket = socketState.lastSocket;
    socket?.open();
    await nextTick();

    controller.abort();

    const result = await requestPromise;
    expect(result.status).toBe("cancelled");
    const cancelMessage = socket?.sent.find((entry) => entry.includes("\"command\":\"cancel\""));
    expect(cancelMessage).toBeTruthy();
  });

  it("skips cancel when the socket is closed before an error response", async () => {
    vi.mocked(resolveRelayEndpoint).mockResolvedValue({
      connectEndpoint: "ws://127.0.0.1:8787/annotation",
      reportedEndpoint: "ws://127.0.0.1:8787/annotation",
      relayPort: 8787,
      pairingRequired: false
    });

    const config = resolveConfig({ relayPort: 8787 });
    const manager = new AnnotationManager(undefined, config);
    const requestPromise = manager.requestAnnotation({});

    await nextTick();
    const socket = socketState.lastSocket;
    socket?.open();
    await nextTick();

    const sent = socket?.sent[0] ?? "";
    const command = JSON.parse(sent) as { payload?: { requestId?: string } };
    const requestId = command.payload?.requestId ?? "req";

    if (socket) {
      socket.readyState = 3;
    }
    socket?.emit("message", JSON.stringify({
      type: "annotationResponse",
      payload: {
        version: 1,
        requestId,
        status: "error",
        error: { code: "capture_failed", message: "Capture failed" }
      }
    }));

    const result = await requestPromise;
    expect(result.status).toBe("error");
    const cancelMessage = socket?.sent.find((entry) => entry.includes("\"command\":\"cancel\""));
    expect(cancelMessage).toBeUndefined();
  });

  it("returns relay_unavailable when the socket errors before opening", async () => {
    vi.mocked(resolveRelayEndpoint).mockResolvedValue({
      connectEndpoint: "ws://127.0.0.1:8787/annotation",
      reportedEndpoint: "ws://127.0.0.1:8787/annotation",
      relayPort: 8787,
      pairingRequired: false
    });

    const config = resolveConfig({ relayPort: 8787 });
    const manager = new AnnotationManager(undefined, config);
    const requestPromise = manager.requestAnnotation({});

    await nextTick();
    const socket = socketState.lastSocket;
    socket?.emit("error", new Error("boom"));

    const result = await requestPromise;
    expect(result.status).toBe("error");
    expect(result.error?.code).toBe("relay_unavailable");
  });

  it("handles non-Error socket open failures", async () => {
    vi.mocked(resolveRelayEndpoint).mockResolvedValue({
      connectEndpoint: "ws://127.0.0.1:8787/annotation",
      reportedEndpoint: "ws://127.0.0.1:8787/annotation",
      relayPort: 8787,
      pairingRequired: false
    });

    const config = resolveConfig({ relayPort: 8787 });
    const manager = new AnnotationManager(undefined, config);
    const requestPromise = manager.requestAnnotation({});

    await nextTick();
    const socket = socketState.lastSocket;
    socket?.emit("error", "boom");

    const result = await requestPromise;
    expect(result.status).toBe("error");
    expect(result.error?.code).toBe("relay_unavailable");
    expect(result.error?.message).toBe("Relay unavailable");
  });

  it("skips closing when the socket is already closed on open error", async () => {
    vi.mocked(resolveRelayEndpoint).mockResolvedValue({
      connectEndpoint: "ws://127.0.0.1:8787/annotation",
      reportedEndpoint: "ws://127.0.0.1:8787/annotation",
      relayPort: 8787,
      pairingRequired: false
    });

    const config = resolveConfig({ relayPort: 8787 });
    const manager = new AnnotationManager(undefined, config);
    const requestPromise = manager.requestAnnotation({});

    await nextTick();
    const socket = socketState.lastSocket;
    if (socket) {
      socket.readyState = 3;
    }
    socket?.emit("error", new Error("boom"));

    const result = await requestPromise;
    expect(result.status).toBe("error");
    expect(result.error?.code).toBe("relay_unavailable");
  });

  it("returns relay_unavailable when the socket errors with a non-Error payload", async () => {
    vi.mocked(resolveRelayEndpoint).mockResolvedValue({
      connectEndpoint: "ws://127.0.0.1:8787/annotation",
      reportedEndpoint: "ws://127.0.0.1:8787/annotation",
      relayPort: 8787,
      pairingRequired: false
    });

    const config = resolveConfig({ relayPort: 8787 });
    const manager = new AnnotationManager(undefined, config);
    const requestPromise = manager.requestAnnotation({});

    await nextTick();
    const socket = socketState.lastSocket;
    socket?.open();
    await nextTick();

    socket?.emit("error", "boom");

    const result = await requestPromise;
    expect(result.status).toBe("error");
    expect(result.error?.code).toBe("relay_unavailable");
    expect(result.error?.message).toBe("Relay unavailable");
  });

  it("ignores annotation events without a request id", async () => {
    vi.mocked(resolveRelayEndpoint).mockResolvedValue({
      connectEndpoint: "ws://127.0.0.1:8787/annotation",
      reportedEndpoint: "ws://127.0.0.1:8787/annotation",
      relayPort: 8787,
      pairingRequired: false
    });

    const config = resolveConfig({ relayPort: 8787 });
    const manager = new AnnotationManager(undefined, config);
    const requestPromise = manager.requestAnnotation({});

    await nextTick();
    const socket = socketState.lastSocket;
    socket?.open();
    await nextTick();

    const sent = socket?.sent[0] ?? "";
    const command = JSON.parse(sent) as { payload?: { requestId?: string } };
    const requestId = command.payload?.requestId ?? "req";

    socket?.emit("message", JSON.stringify({
      type: "annotationEvent",
      payload: { event: "progress", message: "Missing request" }
    }));
    socket?.emit("message", JSON.stringify({
      type: "annotationResponse",
      payload: {
        version: 1,
        requestId,
        status: "ok",
        payload: {
          url: "https://example.com",
          timestamp: "2026-01-31T00:00:00Z",
          screenshotMode: "none",
          annotations: []
        }
      }
    }));

    const result = await requestPromise;
    expect(result.status).toBe("ok");
  });

  it("handles annotation events with matching request ids", async () => {
    vi.mocked(resolveRelayEndpoint).mockResolvedValue({
      connectEndpoint: "ws://127.0.0.1:8787/annotation",
      reportedEndpoint: "ws://127.0.0.1:8787/annotation",
      relayPort: 8787,
      pairingRequired: false
    });

    const config = resolveConfig({ relayPort: 8787 });
    const manager = new AnnotationManager(undefined, config);
    const requestPromise = manager.requestAnnotation({});

    await nextTick();
    const socket = socketState.lastSocket;
    socket?.open();
    await nextTick();

    const sent = socket?.sent[0] ?? "";
    const command = JSON.parse(sent) as { payload?: { requestId?: string } };
    const requestId = command.payload?.requestId ?? "req";

    socket?.emit("message", JSON.stringify({
      type: "annotationEvent",
      payload: { version: 1, requestId, event: "progress", message: "Working" }
    }));
    socket?.emit("message", JSON.stringify({
      type: "annotationResponse",
      payload: {
        version: 1,
        requestId,
        status: "ok",
        payload: {
          url: "https://example.com",
          timestamp: "2026-01-31T00:00:00Z",
          screenshotMode: "none",
          annotations: []
        }
      }
    }));

    const result = await requestPromise;
    expect(result.status).toBe("ok");
  });

  it("returns relay_unavailable when opening the socket times out", async () => {
    vi.mocked(resolveRelayEndpoint).mockResolvedValue({
      connectEndpoint: "ws://127.0.0.1:8787/annotation",
      reportedEndpoint: "ws://127.0.0.1:8787/annotation",
      relayPort: 8787,
      pairingRequired: false
    });

    const config = resolveConfig({ relayPort: 8787 });
    const manager = new AnnotationManager(undefined, config);
    vi.useFakeTimers();
    try {
      const requestPromise = manager.requestAnnotation({});
      await nextTick();
      await vi.advanceTimersByTimeAsync(3001);
      const result = await requestPromise;
      expect(result.status).toBe("error");
      expect(result.error?.code).toBe("relay_unavailable");
      expect(result.error?.message).toContain("Annotation socket open timed out");
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns direct_unavailable when transport=direct and sessionId missing", async () => {
    const config = resolveConfig({ relayPort: 0 });
    const manager = new AnnotationManager(undefined, config);
    const result = await manager.requestAnnotation({ transport: "direct" });
    expect(result.status).toBe("error");
    expect(result.error?.code).toBe("direct_unavailable");
  });

  it("returns direct_unavailable when direct manager is missing", async () => {
    const config = resolveConfig({ relayPort: 0 });
    const manager = new AnnotationManager(undefined, config);
    const result = await manager.requestAnnotation({ sessionId: "s1", transport: "direct" });
    expect(result.status).toBe("error");
    expect(result.error?.code).toBe("direct_unavailable");
  });

  it("uses direct annotate when transport=direct", async () => {
    vi.mocked(resolveDirectAnnotateAssets).mockReturnValue({ assets: { scriptPath: "/tmp/script.js", stylePath: "/tmp/style.css" } });
    vi.mocked(runDirectAnnotate).mockResolvedValue({
      version: 1,
      requestId: "req-direct",
      status: "ok",
      payload: {
        url: "https://example.com",
        timestamp: "2026-01-31T00:00:00Z",
        screenshotMode: "visible",
        annotations: []
      }
    });

    const config = resolveConfig({ relayPort: 0 });
    const manager = new AnnotationManager(undefined, config, { status: vi.fn() } as never);
    const result = await manager.requestAnnotation({ sessionId: "s1", transport: "direct" });

    expect(result.status).toBe("ok");
    expect(runDirectAnnotate).toHaveBeenCalled();
  });

  it("returns direct responses in auto mode without fallback", async () => {
    vi.mocked(resolveDirectAnnotateAssets).mockReturnValue({ assets: { scriptPath: "/tmp/script.js", stylePath: "/tmp/style.css" } });
    vi.mocked(runDirectAnnotate).mockResolvedValue({
      version: 1,
      requestId: "req-direct",
      status: "ok",
      payload: {
        url: "https://example.com",
        timestamp: "2026-01-31T00:00:00Z",
        screenshotMode: "visible",
        annotations: []
      }
    });

    const config = resolveConfig({ relayPort: 0 });
    const manager = new AnnotationManager(undefined, config, { status: vi.fn() } as never);
    const result = await manager.requestAnnotation({ sessionId: "s1" });

    expect(result.status).toBe("ok");
    expect(runDirectAnnotate).toHaveBeenCalled();
    expect(resolveRelayEndpoint).not.toHaveBeenCalled();
  });

  it("returns direct_failed when the direct runner throws", async () => {
    vi.mocked(resolveDirectAnnotateAssets).mockReturnValue({ assets: { scriptPath: "/tmp/script.js", stylePath: "/tmp/style.css" } });
    vi.mocked(runDirectAnnotate).mockRejectedValue(new Error("boom"));

    const config = resolveConfig({ relayPort: 0 });
    const manager = new AnnotationManager(undefined, config, { status: vi.fn() } as never);
    const result = await manager.requestAnnotation({ sessionId: "s1", transport: "direct" });

    expect(result.status).toBe("error");
    expect(result.error?.code).toBe("direct_failed");
    expect(result.error?.message).toBe("boom");
  });

  it("returns direct_failed with default detail when the runner rejects with non-Error", async () => {
    vi.mocked(resolveDirectAnnotateAssets).mockReturnValue({ assets: { scriptPath: "/tmp/script.js", stylePath: "/tmp/style.css" } });
    vi.mocked(runDirectAnnotate).mockRejectedValue("boom");

    const config = resolveConfig({ relayPort: 0 });
    const manager = new AnnotationManager(undefined, config, { status: vi.fn() } as never);
    const result = await manager.requestAnnotation({ sessionId: "s1", transport: "direct" });

    expect(result.status).toBe("error");
    expect(result.error?.code).toBe("direct_failed");
    expect(result.error?.message).toBe("Direct annotate failed.");
  });

  it("returns direct_unavailable in auto mode when no browser manager is set", async () => {
    const config = resolveConfig({ relayPort: 8787 });
    const manager = new AnnotationManager(undefined, config);

    const result = await manager.requestAnnotation({ sessionId: "s1" });
    expect(result.status).toBe("error");
    expect(result.error?.code).toBe("direct_unavailable");
    expect(resolveRelayEndpoint).not.toHaveBeenCalled();
  });

  it("returns direct_unavailable when direct assets are missing", async () => {
    vi.mocked(resolveDirectAnnotateAssets).mockReturnValue({ error: "missing" });

    const config = resolveConfig({ relayPort: 0 });
    const manager = new AnnotationManager(undefined, config, { status: vi.fn() } as never);
    const result = await manager.requestAnnotation({ sessionId: "s1", transport: "direct" });

    expect(result.status).toBe("error");
    expect(result.error?.code).toBe("direct_unavailable");
    expect(runDirectAnnotate).not.toHaveBeenCalled();
  });

  it("returns direct_failed in auto mode when session is not extension", async () => {
    vi.mocked(resolveDirectAnnotateAssets).mockReturnValue({ assets: { scriptPath: "/tmp/script.js", stylePath: "/tmp/style.css" } });
    vi.mocked(runDirectAnnotate).mockResolvedValue({
      version: 1,
      requestId: "req-direct",
      status: "error",
      error: { code: "direct_failed", message: "Direct failed" }
    });

    const relay = { getAnnotationUrl: () => "ws://127.0.0.1:8787/annotation" };
    const config = resolveConfig({ relayPort: 0 });
    const manager = new AnnotationManager(relay, config, { status: vi.fn().mockResolvedValue({ mode: "managed" }) } as never);

    const result = await manager.requestAnnotation({ sessionId: "s1" });
    expect(result.status).toBe("error");
    expect(result.error?.code).toBe("direct_failed");
    expect(resolveRelayEndpoint).not.toHaveBeenCalled();
  });

  it("returns direct_failed in auto mode when session lookup throws", async () => {
    vi.mocked(resolveDirectAnnotateAssets).mockReturnValue({ assets: { scriptPath: "/tmp/script.js", stylePath: "/tmp/style.css" } });
    vi.mocked(runDirectAnnotate).mockResolvedValue({
      version: 1,
      requestId: "req-direct",
      status: "error",
      error: { code: "direct_failed", message: "Direct failed" }
    });

    const relay = { getAnnotationUrl: () => "ws://127.0.0.1:8787/annotation" };
    const config = resolveConfig({ relayPort: 0 });
    const manager = new AnnotationManager(relay, config, { status: vi.fn().mockRejectedValue(new Error("missing")) } as never);

    const result = await manager.requestAnnotation({ sessionId: "s1" });
    expect(result.status).toBe("error");
    expect(result.error?.code).toBe("direct_failed");
    expect(resolveRelayEndpoint).not.toHaveBeenCalled();
  });

  it("returns invalid_request when relay transport is used outside extension", async () => {
    const relay = { getAnnotationUrl: () => "ws://127.0.0.1:8787/annotation" };
    const config = resolveConfig({ relayPort: 0 });
    const manager = new AnnotationManager(relay, config, { status: vi.fn().mockResolvedValue({ mode: "managed" }) } as never);

    const result = await manager.requestAnnotation({ sessionId: "s1", transport: "relay" });
    expect(result.status).toBe("error");
    expect(result.error?.code).toBe("invalid_request");
  });

  it("returns invalid_request when relay status lookup fails", async () => {
    const relay = { getAnnotationUrl: () => "ws://127.0.0.1:8787/annotation" };
    const config = resolveConfig({ relayPort: 0 });
    const manager = new AnnotationManager(relay, config, { status: vi.fn().mockRejectedValue(new Error("missing")) } as never);

    const result = await manager.requestAnnotation({ sessionId: "s1", transport: "relay" });
    expect(result.status).toBe("error");
    expect(result.error?.code).toBe("invalid_request");
  });

  it("returns invalid_request with default detail when relay status throws non-Error", async () => {
    const relay = { getAnnotationUrl: () => "ws://127.0.0.1:8787/annotation" };
    const config = resolveConfig({ relayPort: 0 });
    const manager = new AnnotationManager(relay, config, { status: vi.fn().mockRejectedValue("missing") } as never);

    const result = await manager.requestAnnotation({ sessionId: "s1", transport: "relay" });
    expect(result.status).toBe("error");
    expect(result.error?.code).toBe("invalid_request");
    expect(result.error?.message).toBe("Annotation session unavailable.");
  });

  it("updates relay and browser manager references", async () => {
    const config = resolveConfig({ relayPort: 0 });
    const manager = new AnnotationManager(undefined, config);
    const relay = { getAnnotationUrl: () => "ws://127.0.0.1:8787/annotation" };
    const browser = { status: vi.fn().mockResolvedValue({ mode: "managed" }) };

    manager.setRelay(relay);
    manager.setBrowserManager(browser as never);

    const result = await manager.requestAnnotation({ sessionId: "s1", transport: "relay" });
    expect(result.status).toBe("error");
    expect(result.error?.code).toBe("invalid_request");
  });

  it("falls back to relay in auto mode when direct fails and session is extension", async () => {
    vi.mocked(resolveRelayEndpoint).mockResolvedValue({
      connectEndpoint: "ws://127.0.0.1:8787/annotation",
      reportedEndpoint: "ws://127.0.0.1:8787/annotation",
      relayPort: 8787,
      pairingRequired: false
    });
    vi.mocked(resolveDirectAnnotateAssets).mockReturnValue({ assets: { scriptPath: "/tmp/script.js", stylePath: "/tmp/style.css" } });
    vi.mocked(runDirectAnnotate).mockResolvedValue({
      version: 1,
      requestId: "req-direct",
      status: "error",
      error: { code: "direct_failed", message: "Direct failed" }
    });

    const relay = { getAnnotationUrl: () => "ws://127.0.0.1:8787/annotation" };
    const config = resolveConfig({ relayPort: 0 });
    const manager = new AnnotationManager(relay, config, { status: vi.fn().mockResolvedValue({ mode: "extension" }) } as never);

    const requestPromise = manager.requestAnnotation({ sessionId: "s1" });
    let socket = socketState.lastSocket;
    for (let attempt = 0; attempt < 5 && !socket; attempt += 1) {
      await nextTick();
      socket = socketState.lastSocket;
    }
    expect(socket).toBeTruthy();
    socket?.open();
    await nextTick();

    const sent = socket?.sent[0] ?? "";
    const command = JSON.parse(sent) as { payload?: { requestId?: string } };
    const requestId = command.payload?.requestId ?? "req";

    socket?.emit("message", JSON.stringify({
      type: "annotationResponse",
      payload: {
        version: 1,
        requestId,
        status: "ok",
        payload: {
          url: "https://example.com",
          timestamp: "2026-01-31T00:00:00Z",
          screenshotMode: "visible",
          annotations: []
        }
      }
    }));

    const result = await requestPromise;
    expect(result.status).toBe("ok");
  });
});
