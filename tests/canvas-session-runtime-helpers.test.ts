import { afterEach, describe, expect, it, vi } from "vitest";
import { Window } from "happy-dom";
import { CanvasSessionSyncManager } from "../src/browser/canvas-session-sync-manager";
import { applyRuntimePreviewBridge } from "../src/browser/canvas-runtime-preview-bridge";

type PageLike = {
  evaluate: <TArg, TResult>(pageFunction: (arg: TArg) => TResult | Promise<TResult>, arg: TArg) => Promise<TResult>;
};

function createRuntimePage(runtimeWindow: Window): PageLike {
  return {
    async evaluate(pageFunction, arg) {
      const previousWindow = globalThis.window;
      const previousDocument = globalThis.document;
      const previousHTMLElement = globalThis.HTMLElement;
      vi.stubGlobal("window", runtimeWindow);
      vi.stubGlobal("document", runtimeWindow.document);
      vi.stubGlobal("HTMLElement", runtimeWindow.HTMLElement);
      try {
        return await pageFunction(arg);
      } finally {
        if (previousWindow === undefined) {
          delete (globalThis as { window?: Window }).window;
        } else {
          vi.stubGlobal("window", previousWindow);
        }
        if (previousDocument === undefined) {
          delete (globalThis as { document?: Document }).document;
        } else {
          vi.stubGlobal("document", previousDocument);
        }
        if (previousHTMLElement === undefined) {
          delete (globalThis as { HTMLElement?: typeof HTMLElement }).HTMLElement;
        } else {
          vi.stubGlobal("HTMLElement", previousHTMLElement);
        }
      }
    }
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("canvas session sync manager", () => {
  it("initializes sessions, normalizes generated ids, and supports observer attachment", () => {
    const manager = new CanvasSessionSyncManager();

    const initialized = manager.initializeSession("session-canvas", "lease-1", "  ");
    expect(initialized).toMatchObject({
      leaseId: "lease-1",
      role: "lease_holder",
      attachMode: "lease_reclaim"
    });
    expect(initialized.clientId).toMatch(/^canvas_owner_/);
    expect(manager.getLeaseHolderClientId("session-canvas")).toBe(initialized.clientId);

    const observer = manager.attach("session-canvas", "lease-1", "client-observer");
    expect(observer).toMatchObject({
      clientId: "client-observer",
      leaseId: "lease-1",
      leaseHolderClientId: initialized.clientId,
      role: "observer",
      attachMode: "observer"
    });
    expect(manager.listAttachedClients("session-canvas")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ clientId: initialized.clientId, role: "lease_holder" }),
        expect.objectContaining({ clientId: "client-observer", role: "observer" })
      ])
    );
    expect(manager.listAttachedClients("session-missing")).toEqual([]);
    expect(manager.getLeaseHolderClientId("session-missing")).toBeNull();
  });

  it("supports lease reclaim, touch/update no-ops, and removal", () => {
    const manager = new CanvasSessionSyncManager();
    const initialized = manager.initializeSession("session-canvas", "lease-1", "client-owner");
    manager.attach("session-canvas", "lease-1", "client-observer");

    manager.touch("session-missing", "client-owner");
    manager.touch("session-canvas", "   ");
    manager.touch("session-canvas", "client-unknown");
    manager.updateLease("session-missing", "lease-ignored");

    const beforeTouch = manager.listAttachedClients("session-canvas")
      .find((client) => client.clientId === "client-observer");
    manager.touch("session-canvas", "client-observer");
    const afterTouch = manager.listAttachedClients("session-canvas")
      .find((client) => client.clientId === "client-observer");
    expect(Date.parse(afterTouch?.lastSeenAt ?? "")).toBeGreaterThanOrEqual(Date.parse(beforeTouch?.lastSeenAt ?? ""));

    const reclaimed = manager.attach("session-canvas", "lease-2", "client-reclaimer", "lease_reclaim");
    expect(reclaimed).toMatchObject({
      clientId: "client-reclaimer",
      leaseId: "lease-2",
      leaseHolderClientId: "client-reclaimer",
      role: "lease_holder",
      attachMode: "lease_reclaim"
    });
    expect(manager.listAttachedClients("session-canvas")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ clientId: initialized.clientId, role: "observer" }),
        expect.objectContaining({ clientId: "client-observer", role: "observer" }),
        expect.objectContaining({ clientId: "client-reclaimer", role: "lease_holder" })
      ])
    );

    manager.updateLease("session-canvas", "lease-3");
    expect(manager.attach("session-canvas", "lease-3", "client-reclaimer")).toMatchObject({
      leaseId: "lease-3",
      leaseHolderClientId: "client-reclaimer"
    });

    manager.removeSession("session-canvas");
    expect(manager.listAttachedClients("session-canvas")).toEqual([]);
    expect(manager.getLeaseHolderClientId("session-canvas")).toBeNull();
    expect(() => manager.attach("session-missing", "lease-x", "client-x")).toThrow("Unknown canvas session");
  });

  it("generates observer ids for blank clients and skips lease-holder refresh when the holder record is missing", () => {
    const manager = new CanvasSessionSyncManager();
    manager.initializeSession("session-generated", "lease-1", "client-owner");

    const generatedObserver = manager.attach("session-generated", "lease-1", "   ");
    expect(generatedObserver).toMatchObject({
      leaseId: "lease-1",
      role: "observer",
      attachMode: "observer"
    });
    expect(generatedObserver.clientId).toMatch(/^canvas_client_/);

    const sessions = (manager as unknown as {
      sessions: Map<string, {
        leaseId: string;
        leaseHolderClientId: string;
        attachedClients: Map<string, { role: string }>;
      }>;
    }).sessions;
    const state = sessions.get("session-generated");
    if (!state) {
      throw new Error("Expected session state");
    }

    state.leaseHolderClientId = "client-missing-holder";
    manager.updateLease("session-generated", "lease-2");

    expect(manager.getLeaseHolderClientId("session-generated")).toBe("client-missing-holder");
    expect(manager.listAttachedClients("session-generated")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ clientId: "client-owner", role: "lease_holder" }),
        expect.objectContaining({ clientId: generatedObserver.clientId, role: "observer" })
      ])
    );
  });
});

describe("canvas runtime preview bridge", () => {
  it("returns explicit fallbacks when the root is missing or not instrumented", async () => {
    const runtimeWindow = new Window();
    const page = createRuntimePage(runtimeWindow);

    await expect(applyRuntimePreviewBridge(page, {
      bindingId: "binding-runtime",
      rootSelector: "#missing-root",
      html: "<div />"
    })).resolves.toEqual({
      ok: false,
      fallbackReason: "runtime_projection_unsupported",
      message: "Runtime root not found for selector #missing-root."
    });

    const root = runtimeWindow.document.createElement("section");
    root.id = "runtime-root";
    runtimeWindow.document.body.appendChild(root);

    await expect(applyRuntimePreviewBridge(page, {
      bindingId: "binding-runtime",
      rootSelector: "#runtime-root",
      html: "<div />"
    })).resolves.toEqual({
      ok: false,
      fallbackReason: "runtime_instrumentation_missing",
      message: "Runtime root is missing the expected data-binding-id instrumentation."
    });
  });

  it("applies runtime HTML and captures a bound-app parity artifact", async () => {
    const runtimeWindow = new Window();
    const root = runtimeWindow.document.createElement("section");
    root.id = "runtime-root";
    root.setAttribute("data-binding-id", "binding-runtime");
    runtimeWindow.document.body.appendChild(root);

    const page = createRuntimePage(runtimeWindow);
    const result = await applyRuntimePreviewBridge(page, {
      bindingId: "binding-runtime",
      rootSelector: "#runtime-root",
      html: [
        "<article data-node-id=\"node-root\" data-binding-id=\"binding-runtime\">",
        "  <span data-node-id=\"node-copy\">Hello runtime</span>",
        "</article>"
      ].join("")
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected runtime preview bridge success");
    }

    expect(root.innerHTML).toContain("data-node-id=\"node-root\"");
    expect(result.artifact).toMatchObject({
      projection: "bound_app_runtime",
      rootBindingId: "binding-runtime"
    });
    expect(result.artifact.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nodeId: "node-root",
          bindingId: "binding-runtime",
          attributes: expect.objectContaining({
            "data-node-id": "node-root",
            "data-binding-id": "binding-runtime"
          })
        }),
        expect.objectContaining({
          nodeId: "node-copy",
          text: "Hello runtime"
        })
      ])
    );
    expect(result.artifact.hierarchyHash).toContain("node-root:node-copy");
  });

  it("falls back to tag names and empty attribute strings for instrumented runtime nodes", async () => {
    const runtimeWindow = new Window();
    const root = runtimeWindow.document.createElement("section");
    root.id = "runtime-root";
    root.setAttribute("data-binding-id", "binding-runtime");
    root.setAttribute("data-node-id", "node-runtime-root");
    runtimeWindow.document.body.appendChild(root);

    const originalGetAttribute = runtimeWindow.HTMLElement.prototype.getAttribute;
    runtimeWindow.HTMLElement.prototype.getAttribute = function (qualifiedName: string): string | null {
      if (qualifiedName === "data-node-id" && originalGetAttribute.call(this, "data-force-null-node-id") === "true") {
        return null;
      }
      if (qualifiedName === "data-binding-id" && originalGetAttribute.call(this, "data-force-null-binding-id") === "true") {
        return null;
      }
      return originalGetAttribute.call(this, qualifiedName);
    };

    try {
      const page = createRuntimePage(runtimeWindow);
      const result = await applyRuntimePreviewBridge(page, {
        bindingId: "binding-runtime",
        rootSelector: "#runtime-root",
        html: [
          "<div></div>",
          "<svg></svg>",
          "<section",
          " data-node-id=\"node-fallback\"",
          " data-binding-id=\"binding-runtime\"",
          " data-force-null-node-id=\"true\"",
          " data-force-null-binding-id=\"true\"",
          ">Fallback node</section>"
        ].join("")
      });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error("Expected runtime preview bridge success");
      }

      expect(result.artifact.nodes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            nodeId: "node-runtime-root",
            childOrderHash: "div||section"
          }),
          expect.objectContaining({
            nodeId: "",
            bindingId: "binding-runtime",
            attributes: {
              "data-node-id": "",
              "data-binding-id": ""
            }
          })
        ])
      );
    } finally {
      runtimeWindow.HTMLElement.prototype.getAttribute = originalGetAttribute;
    }
  });
});
