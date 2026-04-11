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

const makePermissionProbe = (
  overrides: Partial<{
    screenCaptureGranted: boolean;
    accessibilityGranted: boolean;
  }> = {}
): string => {
  return JSON.stringify({
    screenCaptureGranted: true,
    accessibilityGranted: true,
    ...overrides
  });
};

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
    const execFileImpl = vi.fn(async () => ({
      stdout: makePermissionProbe(),
      stderr: ""
    }));

    const runtime = createDesktopRuntime({
      cacheRoot,
      config: makeDesktopConfig(),
      execFileImpl
    });

    const status = await runtime.status();

    expect(status.platform).toBe(process.platform);
    expect(status.available).toBe(process.platform === "darwin");
    if (process.platform === "darwin") {
      expect(status.capabilities).toEqual([
        "observe.windows",
        "observe.screen",
        "observe.window",
        "observe.accessibility"
      ]);
      expect(execFileImpl).toHaveBeenCalledTimes(1);
      return;
    }
    expect(status.reason).toBe("desktop_unsupported");
    expect(execFileImpl).not.toHaveBeenCalled();
  });

  it("reports unavailable status when screen capture permission is missing", async () => {
    const cacheRoot = await mkdtemp(path.join(os.tmpdir(), "odb-desktop-screen-denied-"));
    cleanupPaths.push(cacheRoot);
    const execFileImpl = vi.fn(async () => ({
      stdout: makePermissionProbe({ screenCaptureGranted: false }),
      stderr: ""
    }));

    const runtime = createDesktopRuntime({
      cacheRoot,
      platform: "darwin",
      config: makeDesktopConfig(),
      execFileImpl
    });

    const status = await runtime.status();

    expect(status).toMatchObject({
      platform: "darwin",
      available: false,
      reason: "desktop_permission_denied",
      capabilities: []
    });
  });

  it("omits accessibility capability when accessibility permission is missing", async () => {
    const cacheRoot = await mkdtemp(path.join(os.tmpdir(), "odb-desktop-accessibility-denied-"));
    cleanupPaths.push(cacheRoot);
    const execFileImpl = vi.fn(async () => ({
      stdout: makePermissionProbe({ accessibilityGranted: false }),
      stderr: ""
    }));

    const runtime = createDesktopRuntime({
      cacheRoot,
      platform: "darwin",
      config: makeDesktopConfig(),
      execFileImpl
    });

    const status = await runtime.status();

    expect(status).toMatchObject({
      platform: "darwin",
      available: true,
      capabilities: ["observe.windows", "observe.screen", "observe.window"]
    });
    expect(status.capabilities).not.toContain("observe.accessibility");
  });

  it("normalizes invalid permission probe payloads into a query-failed status and failure", async () => {
    const cacheRoot = await mkdtemp(path.join(os.tmpdir(), "odb-desktop-invalid-probe-"));
    cleanupPaths.push(cacheRoot);
    const execFileImpl = vi.fn(async () => ({
      stdout: "null",
      stderr: ""
    }));

    const runtime = createDesktopRuntime({
      cacheRoot,
      platform: "darwin",
      config: makeDesktopConfig(),
      execFileImpl
    });

    const status = await runtime.status();
    const windowsResult = await runtime.listWindows("invalid-probe");

    expect(status).toMatchObject({
      available: false,
      reason: "desktop_query_failed"
    });
    expect(windowsResult).toMatchObject({
      ok: false,
      code: "desktop_query_failed",
      message: "Desktop permission probe returned an invalid payload."
    });
  });

  it("normalizes missing desktop tooling into an unsupported status and failure", async () => {
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

    const status = await runtime.status();
    const windowsResult = await runtime.listWindows("enoent-check");

    expect(status).toMatchObject({
      available: false,
      reason: "desktop_unsupported"
    });
    expect(windowsResult).toMatchObject({
      ok: false,
      code: "desktop_unsupported",
      message: "Required desktop observation tooling is unavailable on this host."
    });
  });

  it("normalizes timed out desktop commands into an aborted status and failure", async () => {
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

    const status = await runtime.status();
    const captureResult = await runtime.captureDesktop({ reason: "timeout-check" });

    expect(status).toMatchObject({
      available: false,
      reason: "desktop_aborted"
    });
    expect(captureResult).toMatchObject({
      ok: false,
      code: "desktop_aborted",
      message: "desktop command timed out"
    });
  });

  it("falls back to query_failed when the permission probe throws a non-error value", async () => {
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

    const status = await runtime.status();
    const windowsResult = await runtime.listWindows("generic-failure");

    expect(status).toMatchObject({
      available: false,
      reason: "desktop_query_failed"
    });
    expect(windowsResult).toMatchObject({
      ok: false,
      code: "desktop_query_failed",
      message: "plain failure"
    });
  });
});
