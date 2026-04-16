import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

const SCREENCAPTURE_PATH = "/usr/sbin/screencapture";

const readSwiftScript = (args: readonly string[] = []): string => {
  const script = args[1];
  if (typeof script !== "string") {
    throw new Error("missing swift script");
  }
  return script;
};

const readCaptureOutputPath = (args: readonly string[] = []): string => {
  const outputPath = args.at(-1);
  if (!outputPath) {
    throw new Error("missing capture output path");
  }
  return outputPath;
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
  const compiledPrograms = new Map<string, string>();
  const mock = vi.fn(async (command: string, args: readonly string[] = []) => {
    if (command === SCREENCAPTURE_PATH) {
      if (!options.capture) {
        throw new Error("unexpected screencapture call");
      }
      await options.capture(args);
      return { stdout: "", stderr: "" };
    }
    if (command === "swiftc") {
      const sourcePath = args[1];
      const outputPath = args[3];
      if (typeof sourcePath !== "string" || typeof outputPath !== "string") {
        throw new Error("unexpected swiftc args");
      }
      compiledPrograms.set(outputPath, await readFile(sourcePath, "utf8"));
      return { stdout: "", stderr: "" };
    }
    if (compiledPrograms.has(command)) {
      return {
        stdout: nextPayload(options.inventory ?? JSON.stringify({ frontmostPid: 0, windows: [] }), inventoryIndex++),
        stderr: ""
      };
    }
    if (command !== "swift") {
      throw new Error(`unexpected command ${command}`);
    }
    const script = readSwiftScript(args);
    if (script.includes("CGPreflightScreenCaptureAccess()")) {
      return { stdout: options.probe ?? makePermissionProbe(), stderr: "" };
    }
    if (script.includes("AXUIElementCreateApplication")) {
      return {
        stdout: nextPayload(options.accessibility ?? JSON.stringify({ tree: { role: "AXWindow", children: [] } }), accessibilityIndex++),
        stderr: ""
      };
    }
    throw new Error(`unexpected swift script ${script}`);
  });
  return Object.assign(mock, { compiledPrograms });
};

type DesktopCaptureRuntimeArgs = {
  cacheRoot: string;
  config?: DesktopConfig;
  execFileImpl: NonNullable<Parameters<typeof createDesktopRuntime>[0]["execFileImpl"]>;
  statImpl?: typeof stat;
};

const createDesktopCaptureRuntime = ({
  cacheRoot,
  config = makeDesktopConfig(),
  execFileImpl,
  statImpl
}: DesktopCaptureRuntimeArgs) => {
  return createDesktopRuntime({
    cacheRoot,
    platform: "darwin",
    config,
    execFileImpl,
    captureCommandImpl: execFileImpl,
    ...(statImpl ? { statImpl } : {})
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
        await writeFile(readCaptureOutputPath(args), "png-bytes");
      }
    });

    const runtime = createDesktopCaptureRuntime({
      cacheRoot,
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

    const runtime = createDesktopCaptureRuntime({
      cacheRoot,
      execFileImpl
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
    const accessibilityCall = execFileImpl.mock.calls.findLast(([command, args]) => (
      command === "swift"
      && typeof args?.[1] === "string"
      && args[1].includes("AXUIElementCreateApplication")
    ));
    const accessibilityScript = accessibilityCall?.[1]?.[1];
    expect(accessibilityScript).toContain("candidateWindow = focusedRaw as! AXUIElement");
    expect(accessibilityScript).not.toContain("as? AXUIElement");
  });

  it("fails window capture when ScreenCaptureKit inventory is unavailable", async () => {
    const cacheRoot = await mkdtemp(path.join(os.tmpdir(), "odb-desktop-window-capture-no-swift-"));
    cleanupPaths.push(cacheRoot);
    const execFileImpl = vi.fn(async () => {
      throw new Error("spawn swift ENOENT");
    });

    const runtime = createDesktopCaptureRuntime({
      cacheRoot,
      execFileImpl
    });

    const result = await runtime.captureWindow("window-1", { reason: "capture-window-no-swift" });

    expect(result).toMatchObject({
      ok: false,
      code: "desktop_unsupported",
      message: "Desktop observation requires the macOS swift command for availability, window, and accessibility probes. Install Xcode or a Swift toolchain and retry."
    });
    expect(execFileImpl).toHaveBeenCalledTimes(1);
    const audit = JSON.parse(await readFile(result.audit.recordPath, "utf8")) as {
      failureCode?: string;
    };
    expect(audit.failureCode).toBe("desktop_unsupported");
  });

  it("fails window capture with a generic unsupported-tooling message when screencapture is unavailable", async () => {
    const cacheRoot = await mkdtemp(path.join(os.tmpdir(), "odb-desktop-window-capture-missing-artifact-"));
    cleanupPaths.push(cacheRoot);
    const inventory = JSON.stringify({
      frontmostPid: 222,
      windows: [
        {
          id: "window-1",
          ownerName: "Google Chrome",
          ownerPid: 222,
          title: "Frontmost Chrome",
          bounds: { x: 0, y: 0, width: 1200, height: 800 },
          layer: 0,
          alpha: 1,
          isOnscreen: true
        }
      ]
    });
    const execFileImpl = vi.fn(async (command: string, args: readonly string[] = []) => {
      if (command === "swift") {
        const script = readSwiftScript(args);
        if (script.includes("CGPreflightScreenCaptureAccess()")) {
          return { stdout: makePermissionProbe(), stderr: "" };
        }
      }
      if (command === "swiftc") {
        return { stdout: "", stderr: "" };
      }
      if (args.length === 0 && command.includes("desktop-window-inventory-")) {
        return { stdout: inventory, stderr: "" };
      }
      if (command === SCREENCAPTURE_PATH) {
        throw new Error("spawn screencapture ENOENT");
      }
      throw new Error(`unexpected command ${command}`);
    });

    const runtime = createDesktopCaptureRuntime({
      cacheRoot,
      execFileImpl
    });

    const result = await runtime.captureWindow("window-1", { reason: "capture-window-missing-artifact" });

    expect(result).toMatchObject({
      ok: false,
      code: "desktop_unsupported",
      message: "Required desktop observation tooling is unavailable on this host."
    });
    expect(execFileImpl.mock.calls.some(([command]) => command === "swiftc")).toBe(true);
  });

  it("normalizes timed out screencapture commands into an aborted failure", async () => {
    const cacheRoot = await mkdtemp(path.join(os.tmpdir(), "odb-desktop-window-capture-timeout-"));
    cleanupPaths.push(cacheRoot);
    const inventory = JSON.stringify({
      frontmostPid: 222,
      windows: [
        {
          id: "window-1",
          ownerName: "Google Chrome",
          ownerPid: 222,
          title: "Frontmost Chrome",
          bounds: { x: 0, y: 0, width: 1200, height: 800 },
          layer: 0,
          alpha: 1,
          isOnscreen: true
        }
      ]
    });
    const execFileImpl = createDesktopExecMock({
      inventory,
      capture: async () => {
        throw new Error("desktop command timed out");
      }
    });

    const runtime = createDesktopCaptureRuntime({
      cacheRoot,
      execFileImpl
    });

    const result = await runtime.captureWindow("window-1", { reason: "capture-window-timeout" });

    expect(result).toMatchObject({
      ok: false,
      code: "desktop_aborted",
      message: "desktop command timed out"
    });
  });

  it("fails window capture when inventory parsing fails after capture readiness succeeds", async () => {
    const cacheRoot = await mkdtemp(path.join(os.tmpdir(), "odb-desktop-window-capture-invalid-inventory-"));
    cleanupPaths.push(cacheRoot);
    const execFileImpl = createDesktopExecMock({
      inventory: "null",
      capture: async () => {
        throw new Error("capture should not run when inventory parsing fails");
      }
    });

    const runtime = createDesktopCaptureRuntime({
      cacheRoot,
      execFileImpl
    });

    const result = await runtime.captureWindow("window-1", { reason: "capture-window-invalid-inventory" });

    expect(result).toMatchObject({
      ok: false,
      code: "desktop_query_failed",
      message: "Desktop window inventory returned an invalid payload."
    });
    expect(execFileImpl.mock.calls.some(([command]) => command === "swiftc")).toBe(true);
  });

  it("fails screen-backed operations before capture when screen permission is missing", async () => {
    const cacheRoot = await mkdtemp(path.join(os.tmpdir(), "odb-desktop-screen-permission-"));
    cleanupPaths.push(cacheRoot);
    const execFileImpl = createDesktopExecMock({
      probe: makePermissionProbe({ screenCaptureGranted: false })
    });

    const runtime = createDesktopCaptureRuntime({
      cacheRoot,
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

    const runtime = createDesktopCaptureRuntime({
      cacheRoot,
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

  it("selects the declared frontmost window, falls back to the first listed window, and returns null when no windows remain", async () => {
    const cacheRoot = await mkdtemp(path.join(os.tmpdir(), "odb-desktop-active-window-"));
    cleanupPaths.push(cacheRoot);
    const inventories = [
      JSON.stringify({
        frontmostPid: 222,
        frontmostWindowId: "frontmost-small",
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
            id: "fallback-first",
            ownerName: "Codex",
            ownerPid: 222,
            title: "Fallback First",
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

    const runtime = createDesktopCaptureRuntime({
      cacheRoot,
      execFileImpl
    });

    const frontmost = await runtime.activeWindow();
    const fallback = await runtime.activeWindow("fallback-window");
    const missing = await runtime.activeWindow("no-window");

    expect(frontmost).toMatchObject({
      ok: true,
      value: expect.objectContaining({ id: "frontmost-small" })
    });
    expect(fallback).toMatchObject({
      ok: true,
      value: expect.objectContaining({ id: "fallback-first" })
    });
    expect(missing).toMatchObject({
      ok: true,
      value: null
    });
  });

  it("builds the ScreenCaptureKit inventory probe with the async task lifecycle and layer-zero filtering", async () => {
    const cacheRoot = await mkdtemp(path.join(os.tmpdir(), "odb-desktop-window-script-"));
    cleanupPaths.push(cacheRoot);
    const execFileImpl = createDesktopExecMock({
      inventory: JSON.stringify({
        frontmostPid: 222,
        windows: []
      })
    });

    const runtime = createDesktopCaptureRuntime({
      cacheRoot,
      execFileImpl
    });

    await runtime.listWindows("inspect-window-script");

    const compileCall = execFileImpl.mock.calls.find(([command]) => command === "swiftc");
    const sourcePath = compileCall?.[1]?.[1];
    if (typeof sourcePath !== "string") {
      throw new Error("expected compiled window inventory source path");
    }
    const outputPath = compileCall?.[1]?.[3];
    if (typeof outputPath !== "string") {
      throw new Error("expected compiled window inventory binary path");
    }
    const windowScript = execFileImpl.compiledPrograms.get(outputPath);
    if (!windowScript) {
      throw new Error("expected compiled window inventory script");
    }
    expect(compileCall?.[1]).toEqual(["-parse-as-library", sourcePath, "-o", outputPath]);
    expect(windowScript).toContain("@main");
    expect(windowScript).toContain("SCShareableContent.excludingDesktopWindows");
    expect(windowScript).toContain("CGWindowListCopyWindowInfo");
    expect(windowScript).toContain("orderedWindowIds(for: frontmostPid)");
    expect(windowScript).toContain("static func main() async");
    expect(windowScript).not.toContain("dispatchMain()");
    expect(windowScript).toContain("window.windowLayer != 0");
    expect(windowScript).not.toContain("SCShareableContent.getExcludingDesktopWindows");
    expect(windowScript).not.toContain("windows.first?[\"id\"]");
    expect(windowScript).not.toContain("CFRunLoopRun()");
  });

  it("falls back to the window owned by the frontmost pid when no frontmost window id is available", async () => {
    const cacheRoot = await mkdtemp(path.join(os.tmpdir(), "odb-desktop-active-window-owner-pid-"));
    cleanupPaths.push(cacheRoot);
    const execFileImpl = createDesktopExecMock({
      inventory: JSON.stringify({
        frontmostPid: 333,
        windows: [
          {
            id: "non-matching-first",
            ownerName: "Repo Prompt",
            ownerPid: 222,
            title: "Repo Prompt",
            bounds: { x: 0, y: 0, width: 600, height: 500 },
            layer: 0,
            alpha: 1,
            isOnscreen: true
          },
          {
            id: "matching-second",
            ownerName: "Google Chrome",
            ownerPid: 333,
            title: "Chrome Frontmost",
            bounds: { x: 20, y: 20, width: 1200, height: 900 },
            layer: 0,
            alpha: 1,
            isOnscreen: true
          }
        ]
      })
    });

    const runtime = createDesktopCaptureRuntime({
      cacheRoot,
      execFileImpl
    });

    const result = await runtime.activeWindow("owner-pid-fallback");

    expect(result).toMatchObject({
      ok: true,
      value: expect.objectContaining({
        id: "matching-second",
        ownerName: "Google Chrome"
      })
    });
    if (!result.ok || result.value === null) {
      throw new Error("expected ownerPid fallback window");
    }
    expect(result.value.id).not.toBe("non-matching-first");
  });

  it("captures the same topmost window that activeWindow resolves", async () => {
    const cacheRoot = await mkdtemp(path.join(os.tmpdir(), "odb-desktop-active-window-capture-"));
    cleanupPaths.push(cacheRoot);
    const inventory = JSON.stringify({
      frontmostPid: 222,
      frontmostWindowId: "frontmost-top",
      windows: [
        {
          id: "frontmost-top",
          ownerName: "Google Chrome",
          ownerPid: 222,
          title: "Topmost Chrome",
          bounds: { x: 20, y: 20, width: 800, height: 600 },
          layer: 0,
          alpha: 1,
          isOnscreen: true
        },
        {
          id: "frontmost-large",
          ownerName: "Google Chrome",
          ownerPid: 222,
          title: "Large Background Chrome",
          bounds: { x: 0, y: 0, width: 1200, height: 900 },
          layer: 0,
          alpha: 1,
          isOnscreen: true
        }
      ]
    });
    const execFileImpl = createDesktopExecMock({
      inventory,
      capture: async (args) => {
        expect(args).toContain("-x");
        expect(args).toContain("-lfrontmost-top");
        await writeFile(readCaptureOutputPath(args), "window-png");
      }
    });

    const runtime = createDesktopCaptureRuntime({
      cacheRoot,
      execFileImpl
    });

    const active = await runtime.activeWindow("active-before-capture");
    expect(active).toMatchObject({
      ok: true,
      value: expect.objectContaining({ id: "frontmost-top" })
    });
    if (!active.ok || active.value === null) {
      throw new Error("expected active window");
    }

    const capture = await runtime.captureWindow(active.value.id, { reason: "capture-active-window" });
    expect(capture).toMatchObject({
      ok: true,
      value: {
        window: expect.objectContaining({ id: "frontmost-top" })
      }
    });
  });

  it("captures the full desktop into an absolute audit directory", async () => {
    const cacheRoot = await mkdtemp(path.join(os.tmpdir(), "odb-desktop-full-capture-"));
    const absoluteAuditDir = await mkdtemp(path.join(os.tmpdir(), "odb-desktop-audit-abs-"));
    cleanupPaths.push(cacheRoot, absoluteAuditDir);
    const execFileImpl = createDesktopExecMock({
      capture: async (args) => {
        await writeFile(readCaptureOutputPath(args), "desktop-png");
      }
    });

    const runtime = createDesktopCaptureRuntime({
      cacheRoot,
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

    const successExecFileImpl = createDesktopExecMock({
      capture: async (args) => {
        await writeFile(readCaptureOutputPath(args), "desktop-png");
      }
    });
    const successRuntime = createDesktopCaptureRuntime({
      cacheRoot: successRoot,
      execFileImpl: successExecFileImpl
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

  it("reports missing window captures without running screencapture", async () => {
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

    const runtime = createDesktopCaptureRuntime({
      cacheRoot,
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
        await writeFile(readCaptureOutputPath(args), "");
      }
    });

    const runtime = createDesktopCaptureRuntime({
      cacheRoot,
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
