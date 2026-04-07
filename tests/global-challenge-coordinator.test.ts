import { describe, expect, it } from "vitest";
import { GlobalChallengeCoordinator } from "../src/browser/global-challenge-coordinator";

describe("GlobalChallengeCoordinator", () => {
  it("claims, refreshes, and clones challenge summaries", () => {
    const coordinator = new GlobalChallengeCoordinator();
    const claimed = coordinator.claimOrRefresh({
      sessionId: "session-1",
      blockerType: "auth_required",
      reasonCode: "auth_required",
      ownerSurface: "direct_browser",
      ownerLeaseId: "lease-1",
      resumeMode: "manual",
      suspendedIntent: {
        kind: "login",
        note: "manual resume"
      },
      preservedSessionId: "session-1",
      preservedTargetId: "target-1",
      now: new Date("2026-03-22T00:00:00.000Z")
    });

    expect(claimed).toMatchObject({
      blockerType: "auth_required",
      reasonCode: "auth_required",
      ownerSurface: "direct_browser",
      ownerLeaseId: "lease-1",
      resumeMode: "manual",
      preservedSessionId: "session-1",
      preservedTargetId: "target-1",
      status: "active"
    });
    expect(claimed.timeline?.map((entry) => entry.event)).toEqual(["claimed"]);

    const refreshed = coordinator.claimOrRefresh({
      sessionId: "session-1",
      blockerType: "auth_required",
      ownerSurface: "ops",
      resumeMode: "auto",
      now: new Date("2026-03-22T00:01:00.000Z")
    });

    expect(refreshed.challengeId).toBe(claimed.challengeId);
    expect(refreshed.ownerSurface).toBe("ops");
    expect(refreshed.timeline?.map((entry) => entry.event)).toEqual(["claimed", "refreshed"]);

    const summary = coordinator.getSummary("session-1");
    expect(summary?.timeline).toHaveLength(2);

    summary?.timeline?.push({
      at: "2026-03-22T00:02:00.000Z",
      event: "released",
      status: "resolved"
    });
    expect(coordinator.getSummary("session-1")?.timeline).toHaveLength(2);
  });

  it("tracks resolve, defer, expire, release, and missing-timeline branches", () => {
    const coordinator = new GlobalChallengeCoordinator();
    expect(coordinator.resolve("missing")).toBeUndefined();
    expect(coordinator.release("missing")).toBeUndefined();
    expect(coordinator.getTimeline("missing")).toEqual([]);

    const claimed = coordinator.claimOrRefresh({
      sessionId: "session-2",
      blockerType: "anti_bot_challenge",
      reasonCode: "challenge_detected",
      ownerSurface: "provider_fallback",
      resumeMode: "auto",
      now: new Date("2026-03-22T01:00:00.000Z")
    });

    const resolved = coordinator.resolve("session-2", new Date("2026-03-22T01:01:00.000Z"));
    expect(resolved?.timeline?.at(-1)).toMatchObject({
      event: "resolved",
      status: "resolved"
    });

    coordinator.claimOrRefresh({
      sessionId: "session-2",
      blockerType: "anti_bot_challenge",
      ownerSurface: "provider_fallback",
      resumeMode: "auto",
      now: new Date("2026-03-22T01:02:00.000Z")
    });

    const deferred = coordinator.defer("session-2", new Date("2026-03-22T01:03:00.000Z"));
    expect(deferred?.timeline?.at(-1)).toMatchObject({
      event: "deferred",
      status: "deferred"
    });

    const expired = coordinator.expire("session-2", new Date("2026-03-22T01:04:00.000Z"));
    expect(expired?.timeline?.at(-1)).toMatchObject({
      event: "expired",
      status: "expired"
    });

    const released = coordinator.release("session-2", new Date("2026-03-22T01:05:00.000Z"));
    expect(released?.timeline?.at(-1)).toMatchObject({
      event: "released",
      status: "expired"
    });
    expect(coordinator.getSummary("session-2")).toBeUndefined();
    expect(coordinator.getTimeline(claimed.challengeId).map((entry) => entry.event)).toEqual([
      "claimed",
      "resolved",
      "refreshed",
      "deferred",
      "expired",
      "released"
    ]);
  });

  it("releases active challenges without a prior transition and keeps history by challenge id", () => {
    const coordinator = new GlobalChallengeCoordinator();
    const claimed = coordinator.claimOrRefresh({
      sessionId: "session-3",
      blockerType: "auth_required",
      ownerSurface: "ops",
      resumeMode: "manual",
      now: new Date("2026-03-22T02:00:00.000Z")
    });

    const released = coordinator.release("session-3", new Date("2026-03-22T02:01:00.000Z"));
    expect(released?.timeline?.at(-1)).toMatchObject({
      event: "released",
      status: "active"
    });
    expect(coordinator.getSummary("session-3")).toBeUndefined();
    expect(coordinator.getTimeline(claimed.challengeId).at(-1)).toMatchObject({
      event: "released",
      status: "active"
    });
  });

  it("maps active status through the internal transition helper using the claimed event", () => {
    const coordinator = new GlobalChallengeCoordinator();
    coordinator.claimOrRefresh({
      sessionId: "session-4",
      blockerType: "anti_bot_challenge",
      ownerSurface: "provider_fallback",
      resumeMode: "auto",
      now: new Date("2026-03-22T03:00:00.000Z")
    });

    const transitioned = (coordinator as unknown as {
      transition: (sessionId: string, status: "active", now: Date) => { timeline?: Array<{ event: string; status: string }> } | undefined;
    }).transition("session-4", "active", new Date("2026-03-22T03:01:00.000Z"));

    expect(transitioned?.timeline?.at(-1)).toMatchObject({
      event: "claimed",
      status: "active"
    });
  });
});
