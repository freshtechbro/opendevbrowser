import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import type { Stats } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopConfig } from "../src/config";
import { createDesktopRuntime, writeDesktopAuditRecord } from "../src/desktop";

const makeDesktopConfig = (overrides: Partial<DesktopConfig> = {}): DesktopConfig => ({
  permissionLevel: "observe",
  commandTimeoutMs: 1000,
  auditArtifactsDir: ".opendevbrowser/desktop-runtime-audit",
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

const readSwiftScript = (args: readonly string[] = []): string => {
  const script = args[1];
  if (typeof script !== "string") {
    throw new Error("missing swift script");
  }
  return script;
};

const nextPayload = (value: string | readonly string[], index: number): string => {
  return Array.isArray(value) ? value[Math.min(index, value.length - 1)]! : value;
};

type DesktopExecMockOptions = {
  probe?: string;
  inventory?: string | readonly string[];
  accessibility?: string | readonly string[];
  capture?: (args: readonly string[]) => Promise<void>;
};

const createDesktopExecMock = (options: DesktopExecMockOptions = {}) => {
  let inventoryIndex = 0;
  let accessibilityIndex = 0;
  return vi.fn(async (command: string, args: readonly string[] = []) => {
    if (command === "swift") {
      const script = readSwiftScript(args);
      if (script.includes("CGPreflightScreenCaptureAccess()")) {
        return { stdout: options.probe ?? makePermissionProbe(), stderr: "" };
      }
      if (script.includes("CGWindowListCopyWindowInfo")) {
        return {
          stdout: nextPayload(options.inventory ?? JSON.stringify({ frontmostPid: 0, windows: [] }), inventoryIndex++),
          stderr: ""
        };
      }
      if (script.includes("AXUIElementCreateApplication")) {
        return {
          stdout: nextPayload(options.accessibility ?? JSON.stringify({ tree: { role: "AXWindow", children: [] } }), accessibilityIndex++),
          stderr: ""
        };
      }
    }
    if (command === "screencapture" && options.capture) {
      await options.capture(args);
      return { stdout: "", stderr: "" };
    }
    throw new Error(`unexpected command ${command}`);
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

describe("desktop runtime audit and observation", () => {
  it("writes audit records with generated defaults and omits optional fields when not provided", async () => {
    const auditDir = await mkdtemp(path.join(os.tmpdir(), "odb-desktop-audit-defaults-"));
    cleanupPaths.push(auditDir);

    const envelope = await writeDesktopAuditRecord({
      auditDir,
      operation: "windows.list",
      capability: "observe.windows",
      result: "ok"
    });

    const audit = JSON.parse(await readFile(envelope.recordPath, "utf8")) as {
      auditId: string;
      at: string;
      artifactPaths: string[];
      details?: unknown;
      failureCode?: unknown;
      message?: unknown;
    };

    expect(audit.auditId).toBe(envelope.auditId);
    expect(audit.at).toBe(envelope.at);
    expect(audit.artifactPaths).toEqual([]);
    expect(audit).not.toHaveProperty("details");
    expect(audit).not.toHaveProperty("failureCode");
    expect(audit).not.toHaveProperty("message");
  });

  it("lists windows and captures a specific window with matching audit artifacts", async () => {
    const cacheRoot = await mkdtemp(path.join(os.tmpdir(), "odb-desktop-audit-"));
    cleanupPaths.push(cacheRoot);
    const auditDir = path.join(cacheRoot, ".opendevbrowser/desktop-runtime-audit");
    const inventory = JSON.stringify({
      frontmostPid: 222,
      windows: [
        {
          id: "window-1",
          ownerName: "Codex",
          ownerPid: 222,
          title: "Codex",
          bounds: { x: 0, y: 0, width: 1200, height: 800 },
          layer: 0,
          alpha: 1,
          isOnscreen: true
        }
      ]
    });

    const execFileImpl = createDesktopExecMock({
      inventory,
      capture: async (args) => {
        const outputPath = args.at(-1);
        if (!outputPath) {
          throw new Error("missing capture path");
        }
        await writeFile(outputPath, "png-bytes");
      }
    });

    const runtime = createDesktopRuntime({
      cacheRoot,
      platform: "darwin",
      config: makeDesktopConfig(),
      execFileImpl,
      statImpl: vi.fn(async () => ({ size: 1 } as Stats))
    });

    const windowsResult = await runtime.listWindows("list-for-capture");
    const captureResult = await runtime.captureWindow("window-1", { reason: "capture-window" });

    expect(windowsResult).toMatchObject({
      ok: true,
      value: {
        windows: [
          expect.objectContaining({
            id: "window-1",
            ownerName: "Codex"
          })
        ]
      }
    });
    expect(captureResult).toMatchObject({
      ok: true,
      value: {
        capture: {
          mimeType: "image/png"
        },
        window: expect.objectContaining({
          id: "window-1"
        })
      }
    });
    if (!captureResult.ok) {
      throw new Error("expected window capture success");
    }
    const audit = JSON.parse(await readFile(captureResult.audit.recordPath, "utf8")) as {
      operation: string;
      result: string;
      artifactPaths: string[];
      details?: { windowId?: string };
    };
    expect(audit).toMatchObject({
      operation: "capture.window",
      result: "ok",
      artifactPaths: [captureResult.value.capture.path],
      details: {
        windowId: "window-1"
      }
    });
    expect(auditDir).toContain(path.dirname(captureResult.audit.recordPath));
  });

  it("captures accessibility tree payloads for the selected window", async () => {
    const cacheRoot = await mkdtemp(path.join(os.tmpdir(), "odb-desktop-accessibility-"));
    cleanupPaths.push(cacheRoot);
    const inventory = JSON.stringify({
      frontmostPid: 111,
      windows: [
        {
          id: "window-2",
          ownerName: "Google Chrome",
          ownerPid: 111,
          title: "ChatGPT",
          bounds: { x: 10, y: 10, width: 1280, height: 900 },
          layer: 0,
          alpha: 1,
          isOnscreen: true
        }
      ]
    });
    const accessibility = JSON.stringify({
      tree: {
        role: "AXWindow",
        title: "ChatGPT",
        children: [
          {
            role: "AXGroup",
            description: "Main content",
            children: []
          }
        ]
      }
    });
    const execFileImpl = createDesktopExecMock({
      inventory,
      accessibility
    });

    const runtime = createDesktopRuntime({
      cacheRoot,
      platform: "darwin",
      config: makeDesktopConfig(),
      execFileImpl,
      statImpl: vi.fn(async (target: string) => (
        target === "/usr/sbin/screencapture"
          ? ({ size: 1 } as Stats)
          : stat(target)
      ))
    });

    const result = await runtime.accessibilitySnapshot("capture-accessibility", "window-2");

    expect(result).toMatchObject({
      ok: true,
      value: {
        window: expect.objectContaining({
          id: "window-2",
          title: "ChatGPT"
        }),
        tree: {
          role: "AXWindow",
          children: [
            {
              role: "AXGroup",
              description: "Main content",
              children: []
            }
          ]
        }
      }
    });
    const accessibilityScript = execFileImpl.mock.calls[2]?.[1]?.[1];
    expect(accessibilityScript).toContain("candidateWindow = focusedRaw as! AXUIElement");
    expect(accessibilityScript).not.toContain("as? AXUIElement");
  });

  it("captures a desktop window with screencapture when swift inventory is unavailable", async () => {
    const cacheRoot = await mkdtemp(path.join(os.tmpdir(), "odb-desktop-window-capture-no-swift-"));
    cleanupPaths.push(cacheRoot);
    const execFileImpl = vi.fn(async (command: string, args: readonly string[] = []) => {
      if (command === "swift") {
        throw new Error("spawn swift ENOENT");
      }
      if (command !== "screencapture") {
        throw new Error(`unexpected command ${command}`);
      }
      const outputPath = args.at(-1);
      if (!outputPath) {
        throw new Error("missing capture path");
      }
      await writeFile(outputPath, "png-bytes");
      return { stdout: "", stderr: "" };
    });

    const runtime = createDesktopRuntime({
      cacheRoot,
      platform: "darwin",
      config: makeDesktopConfig(),
      execFileImpl,
      statImpl: vi.fn(async (target: string) => (
        target === "/usr/sbin/screencapture"
          ? ({ size: 1 } as Stats)
          : stat(target)
      ))
    });

    const result = await runtime.captureWindow("window-1", { reason: "capture-window-no-swift" });

    expect(result).toMatchObject({
      ok: true,
      value: {
        capture: {
          mimeType: "image/png"
        }
      }
    });
    if (!result.ok) {
      throw new Error("expected window capture success");
    }
    expect(result.value).not.toHaveProperty("window");
    const audit = JSON.parse(await readFile(result.audit.recordPath, "utf8")) as {
      details?: { windowId?: string; ownerName?: string };
    };
    expect(audit.details).toMatchObject({
      windowId: "window-1"
    });
    expect(audit.details).not.toHaveProperty("ownerName");
  });

  it("fails window capture when inventory parsing fails after capture readiness succeeds", async () => {
    const cacheRoot = await mkdtemp(path.join(os.tmpdir(), "odb-desktop-window-capture-invalid-inventory-"));
    cleanupPaths.push(cacheRoot);
    const execFileImpl = createDesktopExecMock({
      inventory: "null",
      capture: async () => {
        throw new Error("screencapture should not run when inventory parsing fails");
      }
    });

    const runtime = createDesktopRuntime({
      cacheRoot,
      platform: "darwin",
      config: makeDesktopConfig(),
      execFileImpl
    });

    const result = await runtime.captureWindow("window-1", { reason: "capture-window-invalid-inventory" });

    expect(result).toMatchObject({
      ok: false,
      code: "desktop_query_failed",
      message: "Desktop window inventory returned an invalid payload."
    });
    expect(execFileImpl.mock.calls.at(-1)?.[0]).toBe("swift");
  });

  it("fails screen-backed operations before capture when screen permission is missing", async () => {
    const cacheRoot = await mkdtemp(path.join(os.tmpdir(), "odb-desktop-screen-permission-"));
    cleanupPaths.push(cacheRoot);
    const execFileImpl = createDesktopExecMock({
      probe: makePermissionProbe({ screenCaptureGranted: false })
    });

    const runtime = createDesktopRuntime({
      cacheRoot,
      platform: "darwin",
      config: makeDesktopConfig(),
      execFileImpl
    });

    const result = await runtime.captureDesktop({ reason: "screen-permission" });

    expect(result).toMatchObject({
      ok: false,
      code: "desktop_permission_denied",
      message: "Desktop screen capture permission is not granted on this host."
    });
    expect(execFileImpl).toHaveBeenCalledTimes(1);
  });

  it("fails accessibility captures early when accessibility permission is missing", async () => {
    const cacheRoot = await mkdtemp(path.join(os.tmpdir(), "odb-desktop-accessibility-permission-"));
    cleanupPaths.push(cacheRoot);
    const execFileImpl = createDesktopExecMock({
      probe: makePermissionProbe({ accessibilityGranted: false })
    });

    const runtime = createDesktopRuntime({
      cacheRoot,
      platform: "darwin",
      config: makeDesktopConfig(),
      execFileImpl
    });

    const result = await runtime.accessibilitySnapshot("accessibility-permission", "window-2");

    expect(result).toMatchObject({
      ok: false,
      code: "desktop_permission_denied",
      message: "Desktop accessibility permission is not granted on this host."
    });
    expect(execFileImpl).toHaveBeenCalledTimes(1);
  });

  it("selects the frontmost matching window, falls back to the largest window, and returns null when no windows remain", async () => {
    const cacheRoot = await mkdtemp(path.join(os.tmpdir(), "odb-desktop-active-window-"));
    cleanupPaths.push(cacheRoot);
    const inventories = [
      JSON.stringify({
        frontmostPid: 222,
        windows: [
          {
            id: "frontmost-small",
            ownerName: "Codex",
            ownerPid: 222,
            title: "Codex Small",
            bounds: { x: 0, y: 0, width: 400, height: 300 },
            layer: 0,
            alpha: 1,
            isOnscreen: true
          },
          {
            id: "frontmost-large",
            ownerName: "Codex",
            ownerPid: 222,
            title: "Codex Large",
            bounds: { x: 10, y: 10, width: 1200, height: 900 },
            layer: 0,
            alpha: 1,
            isOnscreen: true
          },
          {
            id: "other-window",
            ownerName: "Google Chrome",
            ownerPid: 333,
            title: "Other",
            bounds: { x: 50, y: 50, width: 1400, height: 900 },
            layer: 0,
            alpha: 1,
            isOnscreen: true
          }
        ]
      }),
      JSON.stringify({
        frontmostPid: 999,
        windows: [
          {
            id: "fallback-small",
            ownerName: "Codex",
            ownerPid: 222,
            title: "Fallback Small",
            bounds: { x: 0, y: 0, width: 500, height: 400 },
            layer: 0,
            alpha: 1,
            isOnscreen: true
          },
          {
            id: "fallback-large",
            ownerName: "Google Chrome",
            ownerPid: 333,
            title: "Fallback Large",
            bounds: { x: 20, y: 20, width: 1500, height: 1000 },
            layer: 0,
            alpha: 1,
            isOnscreen: true
          }
        ]
      }),
      JSON.stringify({
        frontmostPid: 999,
        windows: []
      })
    ];
    const execFileImpl = createDesktopExecMock({
      inventory: inventories
    });

    const runtime = createDesktopRuntime({
      cacheRoot,
      platform: "darwin",
      config: makeDesktopConfig(),
      execFileImpl
    });

    const frontmost = await runtime.activeWindow();
    const fallback = await runtime.activeWindow("fallback-window");
    const missing = await runtime.activeWindow("no-window");

    expect(frontmost).toMatchObject({
      ok: true,
      value: expect.objectContaining({ id: "frontmost-large" })
    });
    expect(fallback).toMatchObject({
      ok: true,
      value: expect.objectContaining({ id: "fallback-large" })
    });
    expect(missing).toMatchObject({
      ok: true,
      value: null
    });
  });

  it("captures the full desktop into an absolute audit directory", async () => {
    const cacheRoot = await mkdtemp(path.join(os.tmpdir(), "odb-desktop-full-capture-"));
    const absoluteAuditDir = await mkdtemp(path.join(os.tmpdir(), "odb-desktop-audit-abs-"));
    cleanupPaths.push(cacheRoot, absoluteAuditDir);
    const execFileImpl = createDesktopExecMock({
      capture: async (args) => {
        const outputPath = args.at(-1);
        if (!outputPath) {
          throw new Error("missing capture path");
        }
        await writeFile(outputPath, "desktop-png");
      }
    });

    const runtime = createDesktopRuntime({
      cacheRoot,
      platform: "darwin",
      config: makeDesktopConfig({ auditArtifactsDir: absoluteAuditDir }),
      execFileImpl
    });

    const status = await runtime.status();
    const captureResult = await runtime.captureDesktop({ reason: "capture-desktop" });

    expect(status.auditArtifactsDir).toBe(absoluteAuditDir);
    expect(captureResult).toMatchObject({
      ok: true,
      value: {
        capture: {
          mimeType: "image/png"
        }
      }
    });
    if (!captureResult.ok) {
      throw new Error("expected full desktop capture success");
    }
    expect(path.dirname(captureResult.value.capture.path)).toBe(absoluteAuditDir);
  });

  it("falls back to operation names in success and failure audit records when the caller passes a null reason", async () => {
    const successRoot = await mkdtemp(path.join(os.tmpdir(), "odb-desktop-null-reason-success-"));
    const failureRoot = await mkdtemp(path.join(os.tmpdir(), "odb-desktop-null-reason-failure-"));
    cleanupPaths.push(successRoot, failureRoot);

    const successRuntime = createDesktopRuntime({
      cacheRoot: successRoot,
      platform: "darwin",
      config: makeDesktopConfig(),
      execFileImpl: createDesktopExecMock({
        capture: async (args) => {
          const outputPath = args.at(-1);
          if (!outputPath) {
            throw new Error("missing capture path");
          }
          await writeFile(outputPath, "desktop-png");
        }
      })
    });

    const successResult = await successRuntime.captureDesktop({ reason: null as never });
    expect(successResult).toMatchObject({ ok: true });
    if (!successResult.ok) {
      throw new Error("expected null-reason desktop capture success");
    }

    const successAudit = JSON.parse(await readFile(successResult.audit.recordPath, "utf8")) as {
      details?: { reason?: string };
    };
    expect(successAudit.details?.reason).toBe("capture.desktop");

    const failureRuntime = createDesktopRuntime({
      cacheRoot: failureRoot,
      platform: "darwin",
      config: makeDesktopConfig({ permissionLevel: "off" })
    });

    const failureResult = await failureRuntime.captureDesktop({ reason: null as never });
    expect(failureResult).toMatchObject({
      ok: false,
      code: "desktop_permission_denied"
    });

    const failureAudit = JSON.parse(await readFile(failureResult.audit.recordPath, "utf8")) as {
      details?: { reason?: string };
    };
    expect(failureAudit.details?.reason).toBe("capture.desktop");
  });

  it("reports missing window captures without calling screencapture", async () => {
    const cacheRoot = await mkdtemp(path.join(os.tmpdir(), "odb-desktop-window-missing-"));
    cleanupPaths.push(cacheRoot);
    const inventory = JSON.stringify({
      frontmostPid: 222,
      windows: [
        {
          id: "window-present",
          ownerName: "Codex",
          ownerPid: 222,
          title: "Codex",
          bounds: { x: 0, y: 0, width: 1200, height: 800 },
          layer: 0,
          alpha: 1,
          isOnscreen: true
        }
      ]
    });
    const execFileImpl = createDesktopExecMock({ inventory });

    const runtime = createDesktopRuntime({
      cacheRoot,
      platform: "darwin",
      config: makeDesktopConfig(),
      execFileImpl
    });

    const result = await runtime.captureWindow("window-missing", { reason: "capture-missing-window" });

    expect(result).toMatchObject({
      ok: false,
      code: "desktop_window_not_found"
    });
  });

  it("fails desktop captures that produce empty artifacts", async () => {
    const cacheRoot = await mkdtemp(path.join(os.tmpdir(), "odb-desktop-empty-capture-"));
    cleanupPaths.push(cacheRoot);
    const execFileImpl = createDesktopExecMock({
      capture: async (args) => {
        const outputPath = args.at(-1);
        if (!outputPath) {
          throw new Error("missing capture path");
        }
        await writeFile(outputPath, "");
      }
    });

    const runtime = createDesktopRuntime({
      cacheRoot,
      platform: "darwin",
      config: makeDesktopConfig(),
      execFileImpl
    });

    const captureResult = await runtime.captureDesktop({ reason: "empty-capture" });

    expect(captureResult).toMatchObject({
      ok: false,
      code: "desktop_capture_failed"
    });
  });

  it("fails invalid window inventory payloads with a typed query error", async () => {
    const cacheRoot = await mkdtemp(path.join(os.tmpdir(), "odb-desktop-invalid-inventory-"));
    cleanupPaths.push(cacheRoot);
    const execFileImpl = createDesktopExecMock({ inventory: "null" });

    const runtime = createDesktopRuntime({
      cacheRoot,
      platform: "darwin",
      config: makeDesktopConfig(),
      execFileImpl
    });

    const result = await runtime.listWindows("invalid-inventory");

    expect(result).toMatchObject({
      ok: false,
      code: "desktop_query_failed"
    });
  });

  it("treats missing window arrays as an empty desktop inventory", async () => {
    const cacheRoot = await mkdtemp(path.join(os.tmpdir(), "odb-desktop-empty-inventory-array-"));
    cleanupPaths.push(cacheRoot);
    const execFileImpl = createDesktopExecMock({
      inventory: JSON.stringify({
        frontmostPid: 111,
        windows: null
      })
    });

    const runtime = createDesktopRuntime({
      cacheRoot,
      platform: "darwin",
      config: makeDesktopConfig(),
      execFileImpl
    });

    const result = await runtime.listWindows("non-array-windows");

    expect(result).toMatchObject({
      ok: true,
      value: {
        windows: []
      }
    });
  });

  it("filters malformed window entries and coerces invalid numeric fields", async () => {
    const cacheRoot = await mkdtemp(path.join(os.tmpdir(), "odb-desktop-malformed-windows-"));
    cleanupPaths.push(cacheRoot);
    const execFileImpl = createDesktopExecMock({
      inventory: JSON.stringify({
        frontmostPid: "not-a-number",
        windows: [
          null,
          {
            ownerName: "Missing Id",
            bounds: {}
          },
          {
            id: "window-4",
            ownerName: "Codex",
            ownerPid: "not-a-number",
            bounds: {
              x: "left",
              y: "top",
              width: "wide",
              height: "tall"
            },
            layer: "foreground",
            alpha: "opaque",
            isOnscreen: false
          },
          {
            id: "window-5",
            ownerName: "Google Chrome",
            ownerPid: 444,
            title: "ChatGPT",
            bounds: { x: 10, y: 20, width: 1200, height: 800 },
            layer: 0,
            alpha: 1,
            isOnscreen: true
          }
        ]
      })
    });

    const runtime = createDesktopRuntime({
      cacheRoot,
      platform: "darwin",
      config: makeDesktopConfig(),
      execFileImpl
    });

    const result = await runtime.listWindows("malformed-window-list");

    expect(result).toMatchObject({
      ok: true,
      value: {
        windows: [
          {
            id: "window-4",
            ownerName: "Codex",
            ownerPid: 0,
            bounds: { x: 0, y: 0, width: 0, height: 0 },
            isOnscreen: false
          },
          {
            id: "window-5",
            ownerName: "Google Chrome",
            ownerPid: 444
          }
        ]
      }
    });
  });

  it("fails accessibility capture when no active window is available", async () => {
    const cacheRoot = await mkdtemp(path.join(os.tmpdir(), "odb-desktop-no-active-window-"));
    cleanupPaths.push(cacheRoot);
    const execFileImpl = createDesktopExecMock({
      inventory: JSON.stringify({ frontmostPid: 999, windows: [] })
    });

    const runtime = createDesktopRuntime({
      cacheRoot,
      platform: "darwin",
      config: makeDesktopConfig(),
      execFileImpl
    });

    const result = await runtime.accessibilitySnapshot("no-active-window");

    expect(result).toMatchObject({
      ok: false,
      code: "desktop_window_not_found",
      message: "No active desktop window is available for accessibility capture."
    });
  });

  it("fails invalid accessibility payloads with a typed accessibility error", async () => {
    const cacheRoot = await mkdtemp(path.join(os.tmpdir(), "odb-desktop-invalid-accessibility-"));
    cleanupPaths.push(cacheRoot);
    const inventory = JSON.stringify({
      frontmostPid: 111,
      windows: [
        {
          id: "window-3",
          ownerName: "Google Chrome",
          ownerPid: 111,
          bounds: { x: 10, y: 10, width: 1280, height: 900 },
          layer: 0,
          alpha: 1,
          isOnscreen: true
        }
      ]
    });
    const invalidAccessibilityPayload = JSON.stringify({
      tree: null
    });
    const execFileImpl = createDesktopExecMock({
      inventory,
      accessibility: invalidAccessibilityPayload
    });

    const runtime = createDesktopRuntime({
      cacheRoot,
      platform: "darwin",
      config: makeDesktopConfig(),
      execFileImpl
    });

    const result = await runtime.accessibilitySnapshot("invalid-accessibility", "window-3");

    expect(result).toMatchObject({
      ok: false,
      code: "desktop_accessibility_unavailable"
    });
  });

  it("defaults missing accessibility fields while preserving string values", async () => {
    const cacheRoot = await mkdtemp(path.join(os.tmpdir(), "odb-desktop-accessibility-defaults-"));
    cleanupPaths.push(cacheRoot);
    const inventory = JSON.stringify({
      frontmostPid: 111,
      windows: [
        {
          id: "window-6",
          ownerName: "Codex",
          ownerPid: 111,
          bounds: { x: 10, y: 10, width: 1280, height: 900 },
          layer: 0,
          alpha: 1,
          isOnscreen: true
        }
      ]
    });
    const accessibility = JSON.stringify({
      tree: {
        title: "Untitled",
        value: "42"
      }
    });
    const execFileImpl = createDesktopExecMock({
      inventory,
      accessibility
    });

    const runtime = createDesktopRuntime({
      cacheRoot,
      platform: "darwin",
      config: makeDesktopConfig(),
      execFileImpl
    });

    const result = await runtime.accessibilitySnapshot("accessibility-defaults", "window-6");

    expect(result).toMatchObject({
      ok: true,
      value: {
        tree: {
          role: "AXUnknown",
          title: "Untitled",
          value: "42",
          children: []
        }
      }
    });
  });

  it("fails accessibility parsing when a child node is invalid", async () => {
    const cacheRoot = await mkdtemp(path.join(os.tmpdir(), "odb-desktop-accessibility-child-invalid-"));
    cleanupPaths.push(cacheRoot);
    const inventory = JSON.stringify({
      frontmostPid: 111,
      windows: [
        {
          id: "window-7",
          ownerName: "Google Chrome",
          ownerPid: 111,
          title: "ChatGPT",
          bounds: { x: 10, y: 10, width: 1280, height: 900 },
          layer: 0,
          alpha: 1,
          isOnscreen: true
        }
      ]
    });
    const invalidChildPayload = JSON.stringify({
      tree: {
        role: "AXWindow",
        children: [null]
      }
    });
    const execFileImpl = createDesktopExecMock({
      inventory,
      accessibility: invalidChildPayload
    });

    const runtime = createDesktopRuntime({
      cacheRoot,
      platform: "darwin",
      config: makeDesktopConfig(),
      execFileImpl
    });

    const result = await runtime.accessibilitySnapshot("invalid-accessibility-child", "window-7");

    expect(result).toMatchObject({
      ok: false,
      code: "desktop_accessibility_unavailable"
    });
  });

  it("reports missing requested accessibility windows with a window-not-found error", async () => {
    const cacheRoot = await mkdtemp(path.join(os.tmpdir(), "odb-desktop-accessibility-missing-window-"));
    cleanupPaths.push(cacheRoot);
    const execFileImpl = createDesktopExecMock({
      inventory: JSON.stringify({
        frontmostPid: 111,
        windows: [
          {
            id: "window-8",
            ownerName: "Codex",
            ownerPid: 111,
            title: "Codex",
            bounds: { x: 0, y: 0, width: 1280, height: 900 },
            layer: 0,
            alpha: 1,
            isOnscreen: true
          }
        ]
      })
    });

    const runtime = createDesktopRuntime({
      cacheRoot,
      platform: "darwin",
      config: makeDesktopConfig(),
      execFileImpl
    });

    const result = await runtime.accessibilitySnapshot("missing-requested-window", "window-missing");

    expect(result).toMatchObject({
      ok: false,
      code: "desktop_window_not_found",
      message: "Desktop window window-missing is not available for accessibility capture."
    });
  });
});
