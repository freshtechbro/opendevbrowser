import { describe, it, expect } from "vitest";
import { RefStore } from "../src/snapshot/refs";

describe("RefStore", () => {
  it("stores and resolves refs", () => {
    const store = new RefStore();
    const snapshot = store.setSnapshot("t1", [
      { ref: "r1", selector: "#one", backendNodeId: 1 },
      { ref: "r2", selector: "#two", backendNodeId: 2 }
    ]);

    expect(snapshot.count).toBe(2);
    expect(store.getSnapshotId("t1")).toBe(snapshot.snapshotId);
    expect(store.getRefCount("t1")).toBe(2);
    expect(store.resolve("t1", "r2")?.selector).toBe("#two");
  });

  it("returns null for unknown targets and refs", () => {
    const store = new RefStore();
    store.setSnapshot("t1", [{ ref: "r1", selector: "#one", backendNodeId: 1 }]);

    expect(store.resolve("missing", "r1")).toBeNull();
    expect(store.resolve("t1", "missing")).toBeNull();
    expect(store.getSnapshotId("missing")).toBeNull();
    expect(store.getRefCount("missing")).toBe(0);
  });

  it("clears a target snapshot", () => {
    const store = new RefStore();
    store.setSnapshot("t1", [{ ref: "r1", selector: "#one", backendNodeId: 1 }]);

    store.clearTarget("t1");
    expect(store.getSnapshotId("t1")).toBeNull();
    expect(store.getRefCount("t1")).toBe(0);
  });
});
