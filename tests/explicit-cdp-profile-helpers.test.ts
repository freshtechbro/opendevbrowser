import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionProfileRecord } from "../src/browser/session-profile-registry";
import {
  requireExplicitCdpProfileLaunchToken,
  requireLiveExplicitCdpProfileEndpoint
} from "../src/browser/explicit-cdp-profile-record";
import { writeExplicitCdpLaunchToken } from "../src/browser/explicit-cdp-launch-token";
import {
  getNodeErrnoCode,
  isExplicitCdpProcessOwnedByProfile,
  isNodeErrno,
  isProcessAlive
} from "../src/browser/explicit-cdp-profile-process";

const execFileSync = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({ execFileSync }));

const originalFetch = globalThis.fetch;
const TEST_DATE = "2026-07-04T00:00:00.000Z";

describe("explicit CDP profile helpers", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    execFileSync.mockReset();
  });

  it("requires explicit profile records to prove a live local endpoint", async () => {
    const liveRecord = createExplicitCdpRecord();
    const liveLease = liveRecord.lease;
    if (!liveLease) {
      throw new Error("test fixture must include a lease");
    }
    const killSpy = vi.spyOn(process, "kill").mockImplementation((): true => true);

    await expect(requireLiveExplicitCdpProfileEndpoint({
      ...liveRecord,
      kind: "raw_cdp_unknown"
    }, false)).rejects.toThrow("not an explicit local CDP profile");
    await expect(requireLiveExplicitCdpProfileEndpoint({
      ...liveRecord,
      endpoint: undefined
    }, false)).rejects.toThrow("missing a live OpenDevBrowser lease");
    await expect(requireLiveExplicitCdpProfileEndpoint({
      ...liveRecord,
      lease: {
        ...liveLease,
        port: 9444
      }
    }, false)).rejects.toThrow("lease does not match");

    killSpy.mockImplementationOnce((pid, signal) => {
      if (pid === 1234 && signal === 0) {
        throwNodeError("ESRCH");
      }
      return true;
    });
    await expect(requireLiveExplicitCdpProfileEndpoint(liveRecord, false)).rejects.toThrow("no longer running");

    globalThis.fetch = vi.fn().mockResolvedValueOnce(new Response("{}", { status: 404 }));
    await expect(requireLiveExplicitCdpProfileEndpoint(liveRecord, false)).rejects.toThrow("endpoint is not live");

    globalThis.fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      webSocketDebuggerUrl: "ws://127.0.0.1:9333/devtools/browser/live"
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    }));
    await expect(requireLiveExplicitCdpProfileEndpoint(liveRecord, false)).resolves.toBe(
      "ws://127.0.0.1:9333/devtools/browser/live"
    );
  });

  it("requires launch-token proof to match the live lease", async () => {
    const profileDir = await mkdtemp(join(tmpdir(), "odb-explicit-cdp-token-"));
    const record = createExplicitCdpRecord();

    await expect(requireExplicitCdpProfileLaunchToken(record, profileDir)).rejects.toThrow("launch token does not match");

    await writeExplicitCdpLaunchToken(profileDir, {
      version: 1,
      profileId: record.profileId,
      launchTokenId: "wrong-token",
      port: 9333,
      pid: 1234,
      createdAt: TEST_DATE
    });
    await expect(requireExplicitCdpProfileLaunchToken(record, profileDir)).rejects.toThrow("launch token does not match");

    await writeExplicitCdpLaunchToken(profileDir, {
      version: 1,
      profileId: record.profileId,
      launchTokenId: "launch-token",
      port: 9333,
      pid: 1234,
      createdAt: TEST_DATE
    });
    await expect(requireExplicitCdpProfileLaunchToken(record, profileDir)).resolves.toBeUndefined();
  });

  it("classifies process liveness and owned command lines without exposing profile paths", () => {
    const killSpy = vi.spyOn(process, "kill")
      .mockImplementationOnce((): true => true)
      .mockImplementationOnce(() => throwNodeError("EPERM"))
      .mockImplementationOnce(() => throwNodeError("ESRCH"));

    expect(isProcessAlive(1111)).toBe(true);
    expect(isProcessAlive(2222)).toBe(true);
    expect(isProcessAlive(3333)).toBe(false);
    expect(killSpy).toHaveBeenCalledTimes(3);

    execFileSync.mockReturnValueOnce("--remote-debugging-port=9333 --user-data-dir=\"/tmp/Profile Path\"");
    expect(isExplicitCdpProcessOwnedByProfile(1234, "/tmp/Profile Path", 9333)).toBe(true);

    execFileSync.mockReturnValueOnce("--remote-debugging-port 9333 --user-data-dir=/tmp/Profile Path --no-first-run");
    expect(isExplicitCdpProcessOwnedByProfile(1234, "/tmp/Profile Path", 9333)).toBe(true);

    execFileSync.mockReturnValueOnce("--remote-debugging-port=93330 --user-data-dir=\"/tmp/Profile Path\"");
    expect(isExplicitCdpProcessOwnedByProfile(1234, "/tmp/Profile Path", 9333)).toBe(false);

    execFileSync.mockReturnValueOnce("--remote-debugging-port=9333 --user-data-dir=\"/tmp/Profile Path Evil\"");
    expect(isExplicitCdpProcessOwnedByProfile(1234, "/tmp/Profile Path", 9333)).toBe(false);

    execFileSync.mockReturnValueOnce("--remote-debugging-port=9333 --user-data-dir=/tmp/Profile Path Evil --no-first-run");
    expect(isExplicitCdpProcessOwnedByProfile(1234, "/tmp/Profile Path", 9333)).toBe(false);

    execFileSync.mockReturnValueOnce("--remote-debugging-port=9444 --user-data-dir=/tmp/Profile");
    expect(isExplicitCdpProcessOwnedByProfile(1234, "/tmp/Profile Path", 9333)).toBe(false);

    execFileSync.mockImplementationOnce(() => {
      throw new Error("ps failed");
    });
    expect(isExplicitCdpProcessOwnedByProfile(1234, "/tmp/Profile Path", 9333)).toBe(false);

    const error = new Error("permission denied") as NodeJS.ErrnoException;
    error.code = "EACCES";
    expect(isNodeErrno(error, "EACCES")).toBe(true);
    expect(isNodeErrno(error, "ENOENT")).toBe(false);
    expect(getNodeErrnoCode(error)).toBe("EACCES");
    expect(getNodeErrnoCode(null)).toBe("unknown");
    expect(getNodeErrnoCode({ code: 404 })).toBe("unknown");
  });
});

function createExplicitCdpRecord(): SessionProfileRecord {
  return {
    schemaVersion: 1,
    profileId: "pinterest-design",
    displayName: "pinterest-design",
    kind: "explicit_cdp_profile",
    scope: "explicit_local_cdp",
    browserFamily: "chrome",
    persistent: true,
    headless: false,
    authCapability: "explicit_cdp_profile",
    authProof: "profile_declared",
    createdAt: TEST_DATE,
    updatedAt: TEST_DATE,
    endpoint: {
      host: "127.0.0.1",
      port: 9333
    },
    lease: {
      pid: 1234,
      port: 9333,
      launchTokenId: "launch-token",
      acquiredAt: TEST_DATE,
      lastSeenAt: TEST_DATE
    }
  };
}

function throwNodeError(code: string): never {
  const error = new Error(code) as NodeJS.ErrnoException;
  error.code = code;
  throw error;
}
