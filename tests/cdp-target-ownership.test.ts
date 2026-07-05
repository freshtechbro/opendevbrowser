import { EventEmitter } from "events";
import { describe, expect, it, vi } from "vitest";
import {
  CdpTargetOwnershipGraph,
  buildSafeTargetUrlSummary,
  inferTargetPopupKind,
  metadataFromCdpTargetEntry,
  type CdpTargetOwnershipSession
} from "../src/browser/cdp-target-ownership";

type TargetSessionSend = CdpTargetOwnershipSession["send"];

function createTargetSession(
  send: TargetSessionSend = vi.fn(async () => ({}))
): CdpTargetOwnershipSession & EventEmitter {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    send,
    detach: vi.fn(async () => undefined)
  }) as CdpTargetOwnershipSession & EventEmitter;
}

describe("CdpTargetOwnershipGraph", () => {
  it("builds sanitized URL summaries without preserving sensitive path data", () => {
    expect(buildSafeTargetUrlSummary(undefined)).toBeUndefined();
    expect(buildSafeTargetUrlSummary("about:blank")).toEqual({ scheme: "about" });
    expect(buildSafeTargetUrlSummary("data:text/plain,secret")).toEqual({ scheme: "data" });
    expect(buildSafeTargetUrlSummary("https://accounts.example.com/oauth?token=secret")).toEqual({
      scheme: "https",
      host: "accounts.example.com",
      origin: "https://accounts.example.com"
    });
    expect(buildSafeTargetUrlSummary("http://example.com/path")).toEqual({
      scheme: "http",
      host: "example.com",
      origin: "http://example.com"
    });
    expect(buildSafeTargetUrlSummary("not a url")).toEqual({ scheme: "other" });
    expect(buildSafeTargetUrlSummary("file:///Users/alice/Profile")).toEqual({ scheme: "other" });
  });

  it("classifies auth popups from URL or title hints and defaults other targets to popup", () => {
    expect(inferTargetPopupKind({ url: "https://accounts.google.com/o/oauth2/v2/auth" })).toBe("oauth_or_account_chooser");
    expect(inferTargetPopupKind({ title: "Choose an account" })).toBe("oauth_or_account_chooser");
    expect(inferTargetPopupKind({ title: "Sign in" })).toBe("oauth_or_account_chooser");
    expect(inferTargetPopupKind({ title: "Login required" })).toBe("oauth_or_account_chooser");
    expect(inferTargetPopupKind({ url: "https://example.com/docs", title: "Docs" })).toBe("popup");
  });

  it("seeds existing targets when target discovery starts", async () => {
    const send = vi.fn(async (method: string) => {
      if (method === "Target.getTargets") {
        return {
          targetInfos: [
            {
              targetId: "target-root",
              type: "page",
              url: "https://example.com/root",
              title: "Root"
            },
            {
              targetId: "target-popup",
              openerId: "target-root",
              type: "page",
              url: "https://accounts.example.com/oauth",
              title: "Choose an account"
            }
          ]
        };
      }
      return {};
    });
    const session = createTargetSession(send);
    const graph = new CdpTargetOwnershipGraph(session, vi.fn());

    await graph.start();

    expect(session.send).toHaveBeenCalledWith("Target.setDiscoverTargets", { discover: true });
    expect(session.send).toHaveBeenCalledWith("Target.getTargets");
    expect(graph.entries()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        cdpTargetId: "target-root",
        lifecycleState: "open"
      }),
      expect.objectContaining({
        cdpTargetId: "target-popup",
        openerCdpTargetId: "target-root",
        lifecycleState: "open"
      })
    ]));
  });

  it("tracks attached target ownership and removes detached targets from the public graph", async () => {
    const session = createTargetSession();
    const onChange = vi.fn();
    const graph = new CdpTargetOwnershipGraph(session, onChange);

    await graph.start();
    session.emit("Target.attachedToTarget", {
      sessionId: "session-popup",
      targetInfo: {
        targetId: "target-popup",
        openerId: "target-root",
        type: "page",
        url: "https://accounts.google.com/signin",
        title: "Sign in"
      }
    });
    const popup = graph.entries().find((entry) => entry.cdpTargetId === "target-popup");
    expect(session.send).toHaveBeenCalledWith("Target.setDiscoverTargets", { discover: true });
    expect(graph.entries()).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ cdpTargetId: "session-popup" })
    ]));
    expect(popup).toMatchObject({
      cdpTargetId: "target-popup",
      openerCdpTargetId: "target-root",
      type: "page",
      url: "https://accounts.google.com/signin",
      title: "Sign in",
      lifecycleState: "open"
    });
    expect(metadataFromCdpTargetEntry(popup!)).toMatchObject({
      cdpTargetId: "target-popup",
      openerCdpTargetId: "target-root",
      lifecycleState: "open",
      popupKind: "oauth_or_account_chooser",
      ownershipSource: "cdp_target_event",
      safeUrlSummary: {
        scheme: "https",
        host: "accounts.google.com",
        origin: "https://accounts.google.com"
      }
    });
    session.emit("Target.detachedFromTarget", { sessionId: "session-popup" });

    expect(graph.entries()).toEqual([]);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("removes only session mappings for the destroyed target", async () => {
    const session = createTargetSession();
    const onChange = vi.fn();
    const graph = new CdpTargetOwnershipGraph(session, onChange);

    await graph.start();
    session.emit("Target.attachedToTarget", {
      sessionId: "session-root",
      targetInfo: {
        targetId: "target-root",
        type: "page",
        url: "https://example.com/root",
        title: "Root"
      }
    });
    session.emit("Target.attachedToTarget", {
      sessionId: "session-popup",
      targetInfo: {
        targetId: "target-popup",
        openerId: "target-root",
        type: "page",
        url: "https://example.com/popup",
        title: "Popup"
      }
    });

    session.emit("Target.targetDestroyed", { targetId: "target-popup" });
    session.emit("Target.detachedFromTarget", { sessionId: "session-root" });

    expect(graph.entries()).toEqual([]);
    expect(onChange).toHaveBeenCalledTimes(4);
  });

  it("preserves target details across partial updates and removes listeners on close", async () => {
    const session = createTargetSession();
    const offSpy = vi.spyOn(session, "off");
    const onChange = vi.fn();
    const graph = new CdpTargetOwnershipGraph(session, onChange);

    await graph.start();
    session.emit("Target.targetCreated", {
      targetInfo: {
        targetId: "target-popup",
        openerId: "target-root",
        type: "page",
        url: "https://example.com/popup",
        title: "Popup"
      }
    });
    session.emit("Target.targetInfoChanged", {
      targetInfo: {
        targetId: "target-popup",
        title: "Updated Popup"
      }
    });
    session.emit("Target.targetInfoChanged", {
      targetInfo: {
        targetId: "target-popup",
        url: "https://example.com/updated-popup"
      }
    });
    session.emit("Target.targetDestroyed", { targetId: "target-popup" });
    session.emit("Target.targetDestroyed", "malformed-target-destroyed");
    session.emit("Target.targetCreated", {});
    session.emit("Target.targetDestroyed", {});

    expect(graph.entries()).toEqual([]);

    await graph.close();

    expect(offSpy).toHaveBeenCalled();
    expect(session.detach).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledTimes(4);
  });

  it("supports removeListener-only sessions and ignores malformed attached payloads", async () => {
    const emitter = new EventEmitter();
    const removeListener = vi.fn(emitter.removeListener.bind(emitter));
    const session: CdpTargetOwnershipSession = {
      send: vi.fn(async () => ({})),
      detach: vi.fn(async () => undefined),
      on: emitter.on.bind(emitter),
      removeListener
    };
    const onChange = vi.fn();
    const graph = new CdpTargetOwnershipGraph(session, onChange);

    await graph.start();
    emitter.emit("Target.attachedToTarget", { sessionId: 123 });
    emitter.emit("Target.attachedToTarget", { sessionId: "session-without-info" });
    emitter.emit("Target.detachedFromTarget", { sessionId: "missing-session" });

    expect(graph.entries()).toEqual([]);

    await graph.close();

    expect(removeListener).toHaveBeenCalled();
    expect(session.detach).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps minimal entries minimal when target payloads omit optional fields", async () => {
    const session = createTargetSession();
    const onChange = vi.fn();
    const graph = new CdpTargetOwnershipGraph(session, onChange);

    await graph.start();
    session.emit("Target.targetCreated", {
      targetInfo: {
        targetId: "target-minimal"
      }
    });
    session.emit("Target.targetDestroyed", { targetId: "target-minimal" });

    const metadata = metadataFromCdpTargetEntry({
      cdpTargetId: "target-minimal",
      lifecycleState: "open"
    });
    expect(graph.entries()).toEqual([]);
    expect(metadata).toEqual({
      cdpTargetId: "target-minimal",
      lifecycleState: "open",
      ownershipSource: "cdp_target_event"
    });
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("ignores target info with invalid optional field shapes", async () => {
    const session = createTargetSession();
    const onChange = vi.fn();
    const graph = new CdpTargetOwnershipGraph(session, onChange);

    await graph.start();
    session.emit("Target.targetCreated", {
      targetInfo: {
        targetId: "target-invalid-optionals",
        openerId: "",
        type: "",
        url: "",
        title: ""
      }
    });
    session.emit("Target.targetInfoChanged", {
      targetInfo: {
        targetId: "",
        title: "ignored"
      }
    });

    expect(graph.entries()).toEqual([
      {
        cdpTargetId: "target-invalid-optionals",
        lifecycleState: "open"
      }
    ]);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
