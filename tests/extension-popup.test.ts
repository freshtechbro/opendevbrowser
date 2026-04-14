// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChromeMock } from "./extension-chrome-mock";

const RECEIVER_MISSING_MESSAGE = "Could not establish connection. Receiving end does not exist.";

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("extension popup annotation errors", () => {
  const originalChrome = globalThis.chrome;

  beforeEach(() => {
    vi.resetModules();
    document.documentElement.innerHTML = readFileSync("extension/popup.html", "utf8");
  });

  afterEach(() => {
    globalThis.chrome = originalChrome;
    vi.restoreAllMocks();
  });

  it("shows an actionable reload message when the background receiver is missing", async () => {
    const mock = createChromeMock({ autoConnect: false });
    mock.chrome.runtime.sendMessage = vi.fn((message: unknown, callback?: (response: unknown) => void) => {
      const type = (message as { type?: string } | null)?.type;
      if (type === "annotation:start") {
        mock.setRuntimeError(RECEIVER_MISSING_MESSAGE);
        callback?.(undefined);
        mock.setRuntimeError(null);
        return;
      }
      if (type === "status") {
        callback?.({ type: "status", status: "connected", relayHealth: null, nativeEnabled: false, nativeHealth: null });
        return;
      }
      if (type === "annotation:probe") {
        callback?.({ type: "annotation:probeResult", injected: false, detail: "Not injected." });
        return;
      }
      if (type === "annotation:lastMeta") {
        callback?.({ type: "annotation:lastMetaResult", meta: null });
        return;
      }
      if (type === "annotation:getPayload") {
        callback?.({ type: "annotation:payloadResult", payload: null, meta: null, source: "storage" });
        return;
      }
      callback?.({ ok: true });
    });

    globalThis.chrome = mock.chrome;
    await import("../extension/src/popup");
    await flushMicrotasks();

    const annotateButton = document.getElementById("annotationStart") as HTMLButtonElement | null;
    const annotationNote = document.getElementById("annotationNote");
    if (!annotateButton || !annotationNote) {
      throw new Error("Popup DOM missing annotation controls");
    }

    annotateButton.click();
    await flushMicrotasks();

    expect(annotationNote.textContent).toBe("Extension background is unavailable. Reload the extension and retry.");
  });

  it("shows a warning state when relay health is green but this popup client is disconnected", async () => {
    const mock = createChromeMock({ autoConnect: false });
    mock.chrome.runtime.sendMessage = vi.fn((message: unknown, callback?: (response: unknown) => void) => {
      const type = (message as { type?: string } | null)?.type;
      if (type === "status") {
        callback?.({
          type: "status",
          status: "disconnected",
          note: "Another extension client took over the relay connection. This client will stay disconnected until you reconnect it explicitly.",
          relayHealth: {
            ok: true,
            reason: "ok",
            extensionConnected: true,
            extensionHandshakeComplete: true,
            annotationConnected: false,
            cdpConnected: false,
            pairingRequired: false
          },
          nativeEnabled: false,
          nativeHealth: null
        });
        return;
      }
      if (type === "annotation:probe") {
        callback?.({ type: "annotation:probeResult", injected: false, detail: "Not injected." });
        return;
      }
      if (type === "annotation:lastMeta") {
        callback?.({ type: "annotation:lastMetaResult", meta: null });
        return;
      }
      if (type === "annotation:getPayload") {
        callback?.({ type: "annotation:payloadResult", payload: null, meta: null, source: "storage" });
        return;
      }
      callback?.({ ok: true });
    });

    globalThis.chrome = mock.chrome;
    await import("../extension/src/popup");
    await flushMicrotasks();

    const status = document.getElementById("status");
    const statusIndicator = document.getElementById("statusIndicator");
    const statusPill = document.getElementById("statusPill");
    const healthRelay = document.getElementById("healthRelay");
    const healthHandshake = document.getElementById("healthHandshake");
    if (!status || !statusIndicator || !statusPill || !healthRelay || !healthHandshake) {
      throw new Error("Popup DOM missing status controls");
    }

    expect(status.textContent).toBe("Relay active");
    expect(statusIndicator.classList.contains("warning")).toBe(true);
    expect(statusPill.classList.contains("warning")).toBe(true);
    expect(statusIndicator.classList.contains("connected")).toBe(false);
    expect(statusPill.classList.contains("connected")).toBe(false);
    expect(healthRelay.textContent).toBe("Online");
    expect(healthHandshake.textContent).toBe("Complete");
  });

  it("clears a stale annotation injection warning after a successful start", async () => {
    const mock = createChromeMock({ autoConnect: false });
    let probeInjected = false;
    mock.chrome.runtime.sendMessage = vi.fn((message: unknown, callback?: (response: unknown) => void) => {
      const type = (message as { type?: string } | null)?.type;
      if (type === "annotation:start") {
        probeInjected = true;
        callback?.({ type: "annotation:startResult", ok: true, requestId: "req-1" });
        return;
      }
      if (type === "status") {
        callback?.({
          type: "status",
          status: "connected",
          note: "Connected",
          relayHealth: {
            ok: true,
            reason: "ok",
            extensionConnected: true,
            extensionHandshakeComplete: true,
            annotationConnected: false,
            cdpConnected: false,
            pairingRequired: false
          },
          nativeEnabled: false,
          nativeHealth: null
        });
        return;
      }
      if (type === "annotation:probe") {
        callback?.({
          type: "annotation:probeResult",
          injected: probeInjected,
          detail: probeInjected ? undefined : "Not injected."
        });
        return;
      }
      if (type === "annotation:lastMeta") {
        callback?.({ type: "annotation:lastMetaResult", meta: null });
        return;
      }
      if (type === "annotation:getPayload") {
        callback?.({ type: "annotation:payloadResult", payload: null, meta: null, source: "storage" });
        return;
      }
      callback?.({ ok: true });
    });

    globalThis.chrome = mock.chrome;
    await import("../extension/src/popup");
    await flushMicrotasks();

    const annotateButton = document.getElementById("annotationStart") as HTMLButtonElement | null;
    const healthNote = document.getElementById("healthNote");
    if (!annotateButton || !healthNote) {
      throw new Error("Popup DOM missing health controls");
    }

    expect(healthNote.textContent).toBe("Annotation UI: Not injected.");

    annotateButton.click();
    await flushMicrotasks();
    await flushMicrotasks();

    expect(healthNote.textContent).toBe("Relay health OK.");
  });
});
