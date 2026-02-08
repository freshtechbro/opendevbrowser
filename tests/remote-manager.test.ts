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
});
