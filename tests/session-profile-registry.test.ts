import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createSessionProfileRegistry,
  sanitizeSessionProfileId
} from "../src/browser/session-profile-registry";

describe("session profile registry", () => {
  it("stores managed profile records without leaking raw paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "odb-profile-registry-"));
    const registry = createSessionProfileRegistry(join(root, "registry"));

    const record = registry.upsert({
      profileId: "pinterest-design",
      displayName: "pinterest-design",
      kind: "managed_persistent",
      scope: "opendevbrowser_owned",
      browserFamily: "chromium",
      persistent: true,
      headless: false,
      pathForHash: "/Users/alice@example.com/Library/Application Support/Google/Chrome/Profile 7 alice@example.com",
      authCapability: "profile_continuity",
      authProof: "profile_declared",
      lease: {
        pid: 12345,
        port: 9222,
        launchTokenId: "launch-token",
        acquiredAt: "2026-07-04T00:00:00.000Z",
        lastSeenAt: "2026-07-04T00:00:00.000Z"
      }
    });

    const raw = await readFile(join(root, "registry", "pinterest-design.json"), "utf8");

    expect(record.pathHash).toMatch(/^[a-f0-9]{16}$/);
    expect(record).not.toHaveProperty("pathForHash");
    expect(raw).not.toContain("/Users/");
    expect(raw).not.toContain("alice@example.com");
    expect(raw).not.toContain("Profile 7");
    expect(registry.summarize(record)).toEqual({
      profileId: "pinterest-design",
      displayName: "pinterest-design",
      kind: "managed_persistent",
      scope: "opendevbrowser_owned",
      browserFamily: "chromium",
      persistent: true,
      headless: false,
      authCapability: "profile_continuity",
      authProof: "profile_declared",
      pathHash: record.pathHash,
      lease: {
        active: true,
        pid: 12345,
        port: 9222,
        acquiredAt: "2026-07-04T00:00:00.000Z",
        lastSeenAt: "2026-07-04T00:00:00.000Z"
      }
    });
    expect(JSON.stringify(registry.summarize(record))).not.toContain("launch-token");
    expect(JSON.stringify(registry.summarize(record))).not.toContain("launchTokenId");
  });

  it("fills safe display defaults and releases missing leases without records", async () => {
    const root = await mkdtemp(join(tmpdir(), "odb-profile-registry-"));
    const registry = createSessionProfileRegistry(join(root, "registry"));

    const record = registry.upsert({
      profileId: "Pinterest Design",
      displayName: "",
      kind: "managed_persistent",
      scope: "opendevbrowser_owned",
      browserFamily: "chromium",
      persistent: true,
      headless: false,
      authCapability: "profile_continuity",
      authProof: "profile_declared"
    });

    expect(record.displayName).toBe("pinterest-design");
    expect(registry.releaseLease("missing-profile")).toBeNull();
  });

  it("redacts unsafe display names and Linux profile paths from summaries", async () => {
    const root = await mkdtemp(join(tmpdir(), "odb-profile-registry-"));
    const registry = createSessionProfileRegistry(join(root, "registry"));

    const record = registry.upsert({
      profileId: "Pinterest Design",
      displayName: "/home/alice/.config/google-chrome/Default alice@example.com",
      kind: "managed_persistent",
      scope: "opendevbrowser_owned",
      browserFamily: "chromium",
      persistent: true,
      headless: false,
      authCapability: "profile_continuity",
      authProof: "profile_declared",
      warnings: [
        "Linux path /home/alice/.config/google-chrome/Default",
        "Root path /root/.config/chrome/Profile 1",
        "Contact alice@example.com"
      ]
    });
    const emailDisplayRecord = registry.upsert({
      profileId: "Email Display",
      displayName: "alice@example.com",
      kind: "managed_persistent",
      scope: "opendevbrowser_owned",
      browserFamily: "chromium",
      persistent: true,
      headless: false,
      authCapability: "profile_continuity",
      authProof: "profile_declared"
    });
    const urlDisplayRecord = registry.upsert({
      profileId: "URL Display",
      displayName: "https://example.com/profile/alice",
      kind: "managed_persistent",
      scope: "opendevbrowser_owned",
      browserFamily: "chromium",
      persistent: true,
      headless: false,
      authCapability: "profile_continuity",
      authProof: "profile_declared"
    });

    const summary = registry.summarize(record);
    const serialized = JSON.stringify(summary);

    expect(summary.displayName).toBe("pinterest-design");
    expect(emailDisplayRecord.displayName).toBe("email-display");
    expect(registry.summarize(emailDisplayRecord).displayName).toBe("email-display");
    expect(urlDisplayRecord.displayName).toBe("url-display");
    expect(registry.summarize(urlDisplayRecord).displayName).toBe("url-display");
    expect(summary.warnings).toEqual([
      "Linux path [redacted-path]",
      "Root path [redacted-path]",
      "Contact [redacted-email]"
    ]);
    expect(serialized).not.toContain("/home/alice");
    expect(serialized).not.toContain("/root/");
    expect(serialized).not.toContain("alice@example.com");
  });

  it("sanitizes profile ids into stable file-safe names", () => {
    expect(sanitizeSessionProfileId("Pinterest Design")).toBe("pinterest-design");
    expect(sanitizeSessionProfileId("../Default")).toBe("default");
    expect(sanitizeSessionProfileId("")).toMatch(/^profile-[a-f0-9]{12}$/);
  });

  it("ignores malformed or unsupported records without exposing raw data", async () => {
    const root = await mkdtemp(join(tmpdir(), "odb-profile-registry-"));
    const registryRoot = join(root, "registry");
    const registry = createSessionProfileRegistry(registryRoot);
    await mkdir(registryRoot, { recursive: true });
    await writeFile(join(registryRoot, "bad-json.json"), "{not-json", "utf8");
    await writeFile(join(registryRoot, "bad-kind.json"), JSON.stringify({
      schemaVersion: 1,
      profileId: "bad-kind",
      displayName: "bad-kind",
      kind: "surprise_kind",
      scope: "opendevbrowser_owned",
      browserFamily: "chromium",
      persistent: true,
      headless: false,
      authCapability: "profile_continuity",
      authProof: "profile_declared",
      createdAt: "2026-07-04T00:00:00.000Z",
      updatedAt: "2026-07-04T00:00:00.000Z",
      pathHash: "/Users/alice@example.com/Chrome/Default"
    }), "utf8");
    await writeFile(join(registryRoot, "not-record.json"), JSON.stringify(["not", "a", "record"]), "utf8");

    expect(registry.read("bad-json")).toBeNull();
    expect(registry.read("bad-kind")).toBeNull();
    expect(registry.read("not-record")).toBeNull();
  });

  it("rejects records with unsafe endpoints, invalid leases, and malformed optional fields", async () => {
    const root = await mkdtemp(join(tmpdir(), "odb-profile-registry-"));
    const registryRoot = join(root, "registry");
    const registry = createSessionProfileRegistry(registryRoot);
    await mkdir(registryRoot, { recursive: true });
    const baseRecord = {
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
      createdAt: "2026-07-04T00:00:00.000Z",
      updatedAt: "2026-07-04T00:00:00.000Z"
    };

    await writeFile(join(registryRoot, "unsafe-endpoint.json"), JSON.stringify({
      ...baseRecord,
      profileId: "unsafe-endpoint",
      endpoint: {
        host: "192.168.1.10",
        port: 9222,
        wsEndpoint: "ws://192.168.1.10:9222/devtools/browser/private"
      }
    }), "utf8");
    await writeFile(join(registryRoot, "bad-port.json"), JSON.stringify({
      ...baseRecord,
      profileId: "bad-port",
      endpoint: {
        host: "127.0.0.1",
        port: 70_000
      }
    }), "utf8");
    await writeFile(join(registryRoot, "bad-lease.json"), JSON.stringify({
      ...baseRecord,
      profileId: "bad-lease",
      lease: {
        pid: -1,
        port: 9333,
        launchTokenId: "token",
        acquiredAt: "2026-07-04T00:00:00.000Z",
        lastSeenAt: "2026-07-04T00:00:00.000Z"
      }
    }), "utf8");
    await writeFile(join(registryRoot, "bad-path-hash.json"), JSON.stringify({
      ...baseRecord,
      profileId: "bad-path-hash",
      pathHash: 123
    }), "utf8");
    await writeFile(join(registryRoot, "malformed-path-hash.json"), JSON.stringify({
      ...baseRecord,
      profileId: "malformed-path-hash",
      pathHash: "/Users/alice@example.com/Chrome/Default"
    }), "utf8");
    await writeFile(join(registryRoot, "bad-endpoint-shape.json"), JSON.stringify({
      ...baseRecord,
      profileId: "bad-endpoint-shape",
      endpoint: "ws://127.0.0.1:9333/private"
    }), "utf8");
    await writeFile(join(registryRoot, "legacy-ws-endpoint.json"), JSON.stringify({
      ...baseRecord,
      profileId: "legacy-ws-endpoint",
      endpoint: {
        host: "127.0.0.1",
        port: 9333,
        wsEndpoint: "ws://127.0.0.1:9333/devtools/browser/private-id"
      }
    }), "utf8");
    await writeFile(join(registryRoot, "bad-lease-shape.json"), JSON.stringify({
      ...baseRecord,
      profileId: "bad-lease-shape",
      lease: "pid:123"
    }), "utf8");

    expect(registry.read("unsafe-endpoint")).toBeNull();
    expect(registry.read("bad-port")).toBeNull();
    expect(registry.read("bad-lease")).toBeNull();
    expect(registry.read("bad-path-hash")).toBeNull();
    expect(registry.read("malformed-path-hash")).toBeNull();
    expect(registry.read("bad-endpoint-shape")).toBeNull();
    expect(registry.read("legacy-ws-endpoint")).toBeNull();
    expect(registry.read("bad-lease-shape")).toBeNull();
  });

  it("summarizes endpoints and warnings while stripping raw ws endpoints", async () => {
    const root = await mkdtemp(join(tmpdir(), "odb-profile-registry-"));
    const registry = createSessionProfileRegistry(join(root, "registry"));

    const record = registry.upsert({
      profileId: "CDP Profile",
      displayName: "CDP Profile",
      kind: "explicit_cdp_profile",
      scope: "explicit_local_cdp",
      browserFamily: "chrome",
      persistent: true,
      headless: false,
      authCapability: "explicit_cdp_profile",
      authProof: "profile_declared",
      endpoint: {
        host: "localhost",
        port: 9333
      },
      warnings: [
        "warning-one",
        "Profile path /Users/alice@example.com/Library/Application Support/Google/Chrome/Default",
        "Endpoint ws://127.0.0.1:9333/devtools/browser/private-id"
      ]
    });

    const summary = registry.summarize(record);

    expect(summary).toEqual({
      profileId: "cdp-profile",
      displayName: "CDP Profile",
      kind: "explicit_cdp_profile",
      scope: "explicit_local_cdp",
      browserFamily: "chrome",
      persistent: true,
      headless: false,
      authCapability: "explicit_cdp_profile",
      authProof: "profile_declared",
      endpoint: {
        host: "localhost",
        port: 9333
      },
      warnings: [
        "warning-one",
        "Profile path [redacted-path]",
        "Endpoint [redacted-url]"
      ]
    });
    expect(JSON.stringify(record)).not.toContain("devtools/browser");
    expect(JSON.stringify(summary)).not.toContain("devtools/browser");
    expect(JSON.stringify(summary)).not.toContain("alice@example.com");
    expect(JSON.stringify(summary)).not.toContain("private-id");
  });

  it("sanitizes legacy warning strings read from disk before summarizing", async () => {
    const root = await mkdtemp(join(tmpdir(), "odb-profile-registry-"));
    const registryRoot = join(root, "registry");
    const registry = createSessionProfileRegistry(registryRoot);
    await mkdir(registryRoot, { recursive: true });
    await writeFile(join(registryRoot, "legacy-warnings.json"), JSON.stringify({
      schemaVersion: 1,
      profileId: "legacy-warnings",
      displayName: "Legacy Warnings",
      kind: "explicit_cdp_profile",
      scope: "explicit_local_cdp",
      browserFamily: "chrome",
      persistent: true,
      headless: false,
      authCapability: "explicit_cdp_profile",
      authProof: "profile_declared",
      createdAt: "2026-07-04T00:00:00.000Z",
      updatedAt: "2026-07-04T00:00:00.000Z",
      pathHash: "0123456789abcdef",
      warnings: [
        "Path /Users/alice@example.com/Library/Application Support/Google/Chrome/Profile 7",
        "Debugger ws://127.0.0.1:9333/devtools/browser/private-id",
        "Contact alice@example.com"
      ]
    }), "utf8");

    const record = registry.read("legacy-warnings");
    expect(record).not.toBeNull();
    if (!record) return;
    const summary = registry.summarize(record);
    const serialized = JSON.stringify(summary);

    expect(summary.warnings).toEqual([
      "Path [redacted-path]",
      "Debugger [redacted-url]",
      "Contact [redacted-email]"
    ]);
    expect(serialized).not.toContain("/Users/");
    expect(serialized).not.toContain("alice@example.com");
    expect(serialized).not.toContain("private-id");
  });

  it("enforces exclusive leases and refuses wrong-token release", async () => {
    const root = await mkdtemp(join(tmpdir(), "odb-profile-registry-"));
    const registry = createSessionProfileRegistry(join(root, "registry"));
    const lease = {
      pid: 12345,
      port: 9333,
      launchTokenId: "launch-token-a",
      acquiredAt: "2026-07-04T00:00:00.000Z",
      lastSeenAt: "2026-07-04T00:00:00.000Z"
    };

    registry.acquireLease("Pinterest Design", lease);
    registry.upsert({
      profileId: "Pinterest Design",
      displayName: "Pinterest Design",
      kind: "managed_persistent",
      scope: "opendevbrowser_owned",
      browserFamily: "chromium",
      persistent: true,
      headless: false,
      authCapability: "profile_continuity",
      authProof: "profile_declared",
      lease
    });

    expect(() => registry.acquireLease("pinterest-design", {
      ...lease,
      launchTokenId: "launch-token-b"
    })).toThrow("already running");
    expect(() => registry.releaseLease("pinterest-design", "wrong-token")).toThrow("launch token does not match");
    expect(registry.readLease("pinterest-design")).toEqual(lease);
    expect(registry.read("pinterest-design")?.lease).toEqual(lease);

    const released = registry.releaseLease("pinterest-design", "launch-token-a");

    expect(released?.lease).toBeUndefined();
    expect(registry.readLease("pinterest-design")).toBeNull();
    expect(registry.read("pinterest-design")?.lease).toBeUndefined();
  });

  it("summarizes token-only leases without inventing pid or port metadata", async () => {
    const root = await mkdtemp(join(tmpdir(), "odb-profile-registry-"));
    const registry = createSessionProfileRegistry(join(root, "registry"));
    const lease = {
      launchTokenId: "launch-token-a",
      acquiredAt: "2026-07-04T00:00:00.000Z",
      lastSeenAt: "2026-07-04T00:00:00.000Z"
    };

    const record = registry.upsert({
      profileId: "Token Only",
      displayName: "Token Only",
      kind: "managed_persistent",
      scope: "opendevbrowser_owned",
      browserFamily: "chromium",
      persistent: true,
      headless: false,
      authCapability: "profile_continuity",
      authProof: "profile_declared",
      lease
    });

    expect(registry.summarize(record).lease).toEqual({
      acquiredAt: "2026-07-04T00:00:00.000Z",
      lastSeenAt: "2026-07-04T00:00:00.000Z",
      active: true
    });
  });

  it("rejects invalid lease writes and mismatched record-only release tokens", async () => {
    const root = await mkdtemp(join(tmpdir(), "odb-profile-registry-"));
    const registry = createSessionProfileRegistry(join(root, "registry"));
    const lease = {
      pid: 12345,
      port: 9333,
      launchTokenId: "launch-token-a",
      acquiredAt: "2026-07-04T00:00:00.000Z",
      lastSeenAt: "2026-07-04T00:00:00.000Z"
    };

    registry.upsert({
      profileId: "Pinterest Design",
      displayName: "Pinterest Design",
      kind: "managed_persistent",
      scope: "opendevbrowser_owned",
      browserFamily: "chromium",
      persistent: true,
      headless: false,
      authCapability: "profile_continuity",
      authProof: "profile_declared",
      lease
    });

    expect(() => registry.acquireLease("bad-lease", {
      ...lease,
      pid: 0
    })).toThrow("Invalid profile lease.");
    expect(() => registry.releaseLease("pinterest-design", "launch-token-b")).toThrow("launch token does not match");
  });

  it("treats malformed lease files as absent and preserves unexpected unlink errors", async () => {
    const root = await mkdtemp(join(tmpdir(), "odb-profile-registry-"));
    const registryRoot = join(root, "registry");
    const registry = createSessionProfileRegistry(registryRoot);
    await mkdir(registryRoot, { recursive: true });
    await writeFile(join(registryRoot, "malformed.lock"), JSON.stringify({
      pid: "not-a-pid",
      launchTokenId: "token",
      acquiredAt: "2026-07-04T00:00:00.000Z",
      lastSeenAt: "2026-07-04T00:00:00.000Z"
    }), "utf8");
    await mkdir(join(registryRoot, "blocked.lock"));

    expect(registry.readLease("malformed")).toBeNull();
    expect(() => registry.releaseLease("blocked")).toThrow();
  });

  it("surfaces non-existing-file lease acquisition errors that are not profile locks", async () => {
    const root = await mkdtemp(join(tmpdir(), "odb-profile-registry-"));
    const registryRoot = join(root, "registry");
    const registry = createSessionProfileRegistry(registryRoot);
    await mkdir(registryRoot, { recursive: true });
    await mkdir(join(registryRoot, "blocked.lock"));

    expect(() => registry.acquireLease("blocked", {
      pid: 12345,
      port: 9333,
      launchTokenId: "launch-token",
      acquiredAt: "2026-07-04T00:00:00.000Z",
      lastSeenAt: "2026-07-04T00:00:00.000Z"
    })).toThrow();
  });

  it("propagates unexpected lease file creation errors without rewriting them as profile locks", async () => {
    vi.resetModules();
    const actualFs = await vi.importActual<typeof import("node:fs")>("node:fs");
    const openError = Object.assign(new Error("disk full"), { code: "ENOSPC" });
    vi.doMock("node:fs", () => ({
      ...actualFs,
      openSync: vi.fn(() => {
        throw openError;
      })
    }));
    const { createSessionProfileRegistry: createMockedRegistry } = await import("../src/browser/session-profile-registry");
    const root = await mkdtemp(join(tmpdir(), "odb-profile-registry-"));
    const registry = createMockedRegistry(join(root, "registry"));

    expect(() => registry.acquireLease("blocked", {
      pid: 12345,
      port: 9333,
      launchTokenId: "launch-token",
      acquiredAt: "2026-07-04T00:00:00.000Z",
      lastSeenAt: "2026-07-04T00:00:00.000Z"
    })).toThrow(openError);

    vi.doUnmock("node:fs");
    vi.resetModules();
  });
});
