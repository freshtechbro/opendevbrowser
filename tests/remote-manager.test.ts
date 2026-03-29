import { describe, expect, it, vi } from "vitest";
import { RemoteManager } from "../src/cli/remote-manager";

describe("RemoteManager.connectRelay", () => {
  it("passes extensionLegacy for legacy /cdp relay endpoints", async () => {
    const call = vi.fn().mockResolvedValue({
      sessionId: "session-1",
      mode: "extension",
      activeTargetId: "target-1",
      warnings: [],
      wsEndpoint: "ws://127.0.0.1:8787/cdp"
    });

    const manager = new RemoteManager({ call } as never);
    await manager.connectRelay("ws://127.0.0.1:8787/cdp");

    expect(call).toHaveBeenCalledWith("session.connect", {
      wsEndpoint: "ws://127.0.0.1:8787/cdp",
      extensionLegacy: true
    });
  });

  it("forwards startUrl for legacy /cdp relay endpoints", async () => {
    const call = vi.fn().mockResolvedValue({
      sessionId: "session-1b",
      mode: "extension",
      activeTargetId: "target-1b",
      warnings: [],
      wsEndpoint: "ws://127.0.0.1:8787/cdp"
    });

    const manager = new RemoteManager({ call } as never);
    await manager.connectRelay("ws://127.0.0.1:8787/cdp", { startUrl: "http://127.0.0.1:41731/" });

    expect(call).toHaveBeenCalledWith("session.connect", {
      wsEndpoint: "ws://127.0.0.1:8787/cdp",
      extensionLegacy: true,
      startUrl: "http://127.0.0.1:41731/"
    });
  });

  it("does not force extensionLegacy for /ops relay endpoints", async () => {
    const call = vi.fn().mockResolvedValue({
      sessionId: "session-2",
      mode: "extension",
      activeTargetId: "target-2",
      warnings: [],
      wsEndpoint: "ws://127.0.0.1:8787/ops"
    });

    const manager = new RemoteManager({ call } as never);
    await manager.connectRelay("ws://127.0.0.1:8787/ops");

    expect(call).toHaveBeenCalledWith("session.connect", {
      wsEndpoint: "ws://127.0.0.1:8787/ops"
    });
  });

  it("passes local base relay endpoints through without forcing extensionLegacy", async () => {
    const call = vi.fn().mockResolvedValue({
      sessionId: "session-base",
      mode: "extension",
      activeTargetId: "target-base",
      warnings: [],
      wsEndpoint: "ws://127.0.0.1:8787/ops"
    });

    const manager = new RemoteManager({ call } as never);
    await manager.connectRelay("ws://127.0.0.1:8787");

    expect(call).toHaveBeenCalledWith("session.connect", {
      wsEndpoint: "ws://127.0.0.1:8787"
    });
  });

  it("forwards startUrl for /ops relay endpoints", async () => {
    const call = vi.fn().mockResolvedValue({
      sessionId: "session-3",
      mode: "extension",
      activeTargetId: "target-3",
      warnings: [],
      wsEndpoint: "ws://127.0.0.1:8787/ops"
    });

    const manager = new RemoteManager({ call } as never);
    await manager.connectRelay("ws://127.0.0.1:8787/ops", { startUrl: "http://127.0.0.1:41731/" });

    expect(call).toHaveBeenCalledWith("session.connect", {
      wsEndpoint: "ws://127.0.0.1:8787/ops",
      startUrl: "http://127.0.0.1:41731/"
    });
  });

  it("forwards manager-shaped blocker and challenge status envelopes unchanged", async () => {
    const statusEnvelope = {
      mode: "extension",
      activeTargetId: "target-status",
      url: "https://example.com/challenge",
      title: "Challenge",
      meta: {
        blockerState: "active",
        blocker: {
          type: "anti_bot_challenge",
          reasonCode: "challenge_detected"
        },
        challenge: {
          challengeId: "challenge-status",
          blockerType: "anti_bot_challenge",
          ownerSurface: "ops",
          ownerLeaseId: "lease-status",
          resumeMode: "manual",
          preservedSessionId: "session-status",
          preservedTargetId: "target-status",
          status: "active",
          updatedAt: "2026-03-22T12:00:00.000Z"
        }
      }
    };
    const call = vi.fn().mockResolvedValue(statusEnvelope);

    const manager = new RemoteManager({ call } as never);
    await expect(manager.status("session-status")).resolves.toEqual(statusEnvelope);

    expect(call).toHaveBeenCalledWith("session.status", {
      sessionId: "session-status"
    });
  });
});
