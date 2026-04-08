import { mkdtemp, readFile, rm } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopConfig } from "../src/config";
import { createDesktopRuntime } from "../src/desktop";

const makeDesktopConfig = (overrides: Partial<DesktopConfig> = {}): DesktopConfig => ({
  permissionLevel: "observe",
  commandTimeoutMs: 1000,
  auditArtifactsDir: ".opendevbrowser/desktop-runtime-test",
  accessibilityMaxDepth: 2,
  accessibilityMaxChildren: 25,
  ...overrides
});

const cleanupPaths: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  while (cleanupPaths.length > 0) {
    const target = cleanupPaths.pop();
    if (target) {
      await rm(target, { recursive: true, force: true });
    }
  }
});

describe("desktop runtime permission and availability", () => {
  it("reports disabled status and writes a denied audit record when permission is off", async () => {
    const cacheRoot = await mkdtemp(path.join(os.tmpdir(), "odb-desktop-off-"));
    cleanupPaths.push(cacheRoot);

    const runtime = createDesktopRuntime({
      cacheRoot,
      platform: "darwin",
      config: makeDesktopConfig({ permissionLevel: "off" })
    });

    const status = await runtime.status();
    const windowsResult = await runtime.listWindows("permission-off-check");

    expect(status).toMatchObject({
      platform: "darwin",
      available: false,
      reason: "desktop_permission_denied",
      capabilities: []
    });
    expect(windowsResult).toMatchObject({
      ok: false,
      code: "desktop_permission_denied"
    });
    const audit = JSON.parse(await readFile(windowsResult.audit.recordPath, "utf8")) as {
      result: string;
      failureCode?: string;
      details?: { reason?: string };
    };
    expect(audit).toMatchObject({
      result: "failed",
      failureCode: "desktop_permission_denied",
      details: {
        reason: "permission-off-check"
      }
    });
  });

  it("reports unsupported status on non-darwin hosts without invoking desktop commands", async () => {
    const cacheRoot = await mkdtemp(path.join(os.tmpdir(), "odb-desktop-unsupported-"));
    cleanupPaths.push(cacheRoot);

    const runtime = createDesktopRuntime({
      cacheRoot,
      platform: "linux",
      config: makeDesktopConfig()
    });

    const status = await runtime.status();
    const captureResult = await runtime.captureDesktop({ reason: "unsupported-check" });

    expect(status).toMatchObject({
      platform: "linux",
      available: false,
      reason: "desktop_unsupported"
    });
    expect(captureResult).toMatchObject({
      ok: false,
      code: "desktop_unsupported"
    });
  });

  it("falls back to the host platform when no explicit platform override is supplied", async () => {
    const cacheRoot = await mkdtemp(path.join(os.tmpdir(), "odb-desktop-host-platform-"));
    cleanupPaths.push(cacheRoot);

    const runtime = createDesktopRuntime({
      cacheRoot,
      config: makeDesktopConfig()
    });

    const status = await runtime.status();

    expect(status.platform).toBe(process.platform);
    expect(status.available).toBe(process.platform === "darwin");
  });

  it("normalizes missing desktop tooling into an unsupported failure", async () => {
    const cacheRoot = await mkdtemp(path.join(os.tmpdir(), "odb-desktop-enoent-"));
    cleanupPaths.push(cacheRoot);
    const execFileImpl = vi.fn(async () => {
      throw new Error("spawn swift ENOENT");
    });

    const runtime = createDesktopRuntime({
      cacheRoot,
      platform: "darwin",
      config: makeDesktopConfig(),
      execFileImpl
    });

    const windowsResult = await runtime.listWindows("enoent-check");

    expect(windowsResult).toMatchObject({
      ok: false,
      code: "desktop_unsupported",
      message: "Required desktop observation tooling is unavailable on this host."
    });
  });

  it("normalizes timed out desktop commands into an aborted failure", async () => {
    const cacheRoot = await mkdtemp(path.join(os.tmpdir(), "odb-desktop-timeout-"));
    cleanupPaths.push(cacheRoot);
    const execFileImpl = vi.fn(async () => {
      throw new Error("desktop command timed out");
    });

    const runtime = createDesktopRuntime({
      cacheRoot,
      platform: "darwin",
      config: makeDesktopConfig(),
      execFileImpl
    });

    const captureResult = await runtime.captureDesktop({ reason: "timeout-check" });

    expect(captureResult).toMatchObject({
      ok: false,
      code: "desktop_aborted",
      message: "desktop command timed out"
    });
  });

  it("falls back to the provided failure code when a non-error value is thrown", async () => {
    const cacheRoot = await mkdtemp(path.join(os.tmpdir(), "odb-desktop-generic-failure-"));
    cleanupPaths.push(cacheRoot);
    const execFileImpl = vi.fn(async () => {
      throw "plain failure";
    });

    const runtime = createDesktopRuntime({
      cacheRoot,
      platform: "darwin",
      config: makeDesktopConfig(),
      execFileImpl
    });

    const windowsResult = await runtime.listWindows("generic-failure");

    expect(windowsResult).toMatchObject({
      ok: false,
      code: "desktop_query_failed",
      message: "plain failure"
    });
  });
});
