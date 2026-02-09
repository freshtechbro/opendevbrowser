import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TargetSessionMap } from "../extension/src/services/TargetSessionMap";

describe("TargetSessionMap.waitForRootSession", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves when root session is registered", async () => {
    const map = new TargetSessionMap();
    const wait = map.waitForRootSession(1, 1000);
    map.registerRootTab(1, { targetId: "tab-1", type: "page" }, "root-1");
    await expect(wait).resolves.toMatchObject({ sessionId: "root-1" });
  });

  it("rejects on timeout", async () => {
    const map = new TargetSessionMap();
    const wait = map.waitForRootSession(2, 500);
    const expectation = expect(wait).rejects.toThrow("Target attach timeout");
    await vi.advanceTimersByTimeAsync(600);
    await expectation;
  });
});
