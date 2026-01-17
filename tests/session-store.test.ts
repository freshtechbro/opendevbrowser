import { describe, it, expect } from "vitest";
import { SessionStore } from "../src/browser/session-store";

describe("SessionStore", () => {
  it("stores and removes sessions", () => {
    const store = new SessionStore();
    const session = { id: "s1", mode: "managed", browser: {} as never, context: {} as never };

    store.add(session);
    expect(store.has("s1")).toBe(true);
    expect(store.get("s1")).toBe(session);
    expect(store.list().length).toBe(1);

    store.delete("s1");
    expect(store.has("s1")).toBe(false);
  });

  it("throws on unknown session", () => {
    const store = new SessionStore();
    expect(() => store.get("missing")).toThrow("Unknown sessionId");
  });
});
