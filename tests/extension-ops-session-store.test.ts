import { describe, expect, it } from "vitest";
import { OpsSessionStore } from "../extension/src/ops/ops-session-store";

describe("OpsSessionStore", () => {
  it("removes non-root targets by tab id without destroying session", () => {
    const store = new OpsSessionStore();
    const session = store.createSession("client-1", 101, "lease-1", { url: "https://root.example" });
    store.addTarget(session.id, 202, { url: "https://child.example" });
    store.setActiveTarget(session.id, "tab-202");

    const removed = store.removeTargetByTabId(session.id, 202);

    expect(removed?.targetId).toBe("tab-202");
    expect(store.get(session.id)).not.toBeNull();
    expect(store.getByTabId(202)).toBeNull();
    const updated = store.get(session.id);
    expect(updated?.targets.has("tab-101")).toBe(true);
    expect(updated?.targets.has("tab-202")).toBe(false);
    expect(updated?.activeTargetId).toBe("tab-101");
  });

  it("removes root target by tab id while preserving remaining targets", () => {
    const store = new OpsSessionStore();
    const session = store.createSession("client-1", 101, "lease-1", { url: "https://root.example" });
    store.addTarget(session.id, 202, { url: "https://child.example" });

    const removed = store.removeTargetByTabId(session.id, 101);

    expect(removed?.targetId).toBe("tab-101");
    const updated = store.get(session.id);
    expect(updated).not.toBeNull();
    expect(updated?.targets.has("tab-101")).toBe(false);
    expect(updated?.targets.has("tab-202")).toBe(true);
    expect(updated?.activeTargetId).toBe("tab-202");
  });

  it("returns null when removing unknown tab id", () => {
    const store = new OpsSessionStore();
    const session = store.createSession("client-1", 101, "lease-1");

    const removed = store.removeTargetByTabId(session.id, 999);

    expect(removed).toBeNull();
    expect(store.get(session.id)).not.toBeNull();
  });
});
