import { describe, expect, it, vi } from "vitest";
import { RemoteRelay } from "../src/cli/remote-relay";

describe("RemoteRelay", () => {
  it("refreshes status and cdp url from daemon client", async () => {
    const status = {
      running: true,
      extensionConnected: true,
      extensionHandshakeComplete: true,
      cdpConnected: false,
      pairingRequired: true,
      instanceId: "relay-1",
      epoch: 1,
      port: 8787,
      url: "ws://127.0.0.1:8787"
    };
    const client = {
      call: vi.fn()
        .mockResolvedValueOnce(status)
        .mockResolvedValueOnce("ws://127.0.0.1:8787/cdp")
    };

    const relay = new RemoteRelay(client as never);
    await relay.refresh();

    expect(relay.status()).toEqual(status);
    expect(relay.getCdpUrl()).toBe("ws://127.0.0.1:8787/cdp");
  });

  it("clears cached values on refresh failures", async () => {
    const client = {
      call: vi.fn().mockRejectedValue(new Error("boom"))
    };
    const relay = new RemoteRelay(client as never);
    await relay.refresh();
    expect(relay.status().instanceId).toBe("");
    expect(relay.getCdpUrl()).toBeNull();
  });
});
