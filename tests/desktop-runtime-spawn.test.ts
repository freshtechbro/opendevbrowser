import type { Stats } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopConfig } from "../src/config";

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return {
    ...actual,
    spawn: spawnMock
  };
});

import { createDesktopRuntime } from "../src/desktop";

type MockSpawnProcess = EventEmitter & {
  stdout: PassThrough | null;
  stderr: PassThrough | null;
  kill: (signal?: NodeJS.Signals) => boolean;
};

const defaultInventory = JSON.stringify({
  frontmostPid: 222,
  frontmostWindowId: "window-1",
  windows: [
    {
      id: "window-1",
      ownerName: "Google Chrome",
      ownerPid: 222,
      title: "Chrome",
      bounds: { x: 0, y: 0, width: 1200, height: 800 },
      layer: 0,
      alpha: 1,
      isOnscreen: true
    }
  ]
});

const cleanupPaths: string[] = [];

const makeDesktopConfig = (overrides: Partial<DesktopConfig> = {}): DesktopConfig => ({
  permissionLevel: "observe",
  commandTimeoutMs: 25,
  auditArtifactsDir: ".opendevbrowser/desktop-runtime-spawn",
  accessibilityMaxDepth: 2,
  accessibilityMaxChildren: 25,
  ...overrides
});

const createSwiftExecFileImpl = (inventory = defaultInventory) => {
  const compiledPrograms = new Set<string>();
  return vi.fn(async (file: string, args: readonly string[] = []) => {
    if (file === "swiftc") {
      const sourcePath = args[1];
      const outputPath = args[3];
      if (typeof sourcePath !== "string" || typeof outputPath !== "string") {
        throw new Error("unexpected swiftc args");
      }
      const script = await readFile(sourcePath, "utf8");
      if (!script.includes("SCShareableContent.excludingDesktopWindows")) {
        throw new Error(`unexpected compiled swift script ${script}`);
      }
      compiledPrograms.add(outputPath);
      return { stdout: "", stderr: "" };
    }
    if (compiledPrograms.has(file)) {
      return { stdout: inventory, stderr: "" };
    }
    if (file !== "swift") {
      throw new Error(`unexpected command ${file}`);
    }
    const script = typeof args?.[1] === "string" ? args[1] : "";
    if (script.includes("CGPreflightScreenCaptureAccess()")) {
      return {
        stdout: JSON.stringify({
        screenCaptureGranted: true,
        accessibilityGranted: true
        }),
        stderr: ""
      };
    }
    throw new Error(`unexpected swift script ${script}`);
  });
};

const createSpawnProcess = (options: {
  stdout?: PassThrough | null;
  stderr?: PassThrough | null;
} = {}): MockSpawnProcess => {
  const child = new EventEmitter() as MockSpawnProcess;
  child.stdout = options.stdout === undefined ? new PassThrough() : options.stdout;
  child.stderr = options.stderr === undefined ? new PassThrough() : options.stderr;
  child.kill = vi.fn(() => true);
  return child;
};

afterEach(async () => {
  vi.restoreAllMocks();
  while (cleanupPaths.length > 0) {
    const target = cleanupPaths.pop();
    if (target) {
      await rm(target, { recursive: true, force: true });
    }
  }
});

beforeEach(() => {
  spawnMock.mockReset();
});

describe("desktop runtime default spawn-backed capture path", () => {
  it("captures a window through the default spawn-backed screencapture runner", async () => {
    const cacheRoot = await mkdtemp(path.join(os.tmpdir(), "odb-desktop-spawn-success-"));
    cleanupPaths.push(cacheRoot);
    const execFileImpl = createSwiftExecFileImpl();
    spawnMock.mockImplementation((file: string, args?: readonly string[]) => {
      const child = createSpawnProcess();
      queueMicrotask(async () => {
        child.stdout?.emit("data", "spawn-ok");
        await writeFile(String(args?.at(-1)), "window-png");
        child.emit("close", 0, null);
      });
      return child;
    });

    const runtime = createDesktopRuntime({
      cacheRoot,
      platform: "darwin",
      config: makeDesktopConfig(),
      execFileImpl,
      statImpl: vi.fn(async () => ({ size: 10 } as Stats))
    });

    const result = await runtime.captureWindow("window-1", { reason: "spawn-success" });

    expect(result).toMatchObject({
      ok: true,
      value: {
        window: expect.objectContaining({ id: "window-1" })
      }
    });
    expect(spawnMock).toHaveBeenCalledWith(
      "/usr/sbin/screencapture",
      expect.arrayContaining(["-x", "-lwindow-1"]),
      { stdio: ["ignore", "pipe", "pipe"] }
    );
  });

  it("surfaces stderr text when the default spawn-backed capture runner fails", async () => {
    const cacheRoot = await mkdtemp(path.join(os.tmpdir(), "odb-desktop-spawn-stderr-"));
    cleanupPaths.push(cacheRoot);
    const execFileImpl = createSwiftExecFileImpl();
    spawnMock.mockImplementation(() => {
      const child = createSpawnProcess();
      queueMicrotask(() => {
        child.stderr?.emit("data", "capture failed");
        child.emit("close", 1, null);
      });
      return child;
    });

    const runtime = createDesktopRuntime({
      cacheRoot,
      platform: "darwin",
      config: makeDesktopConfig(),
      execFileImpl
    });

    const result = await runtime.captureDesktop({ reason: "spawn-stderr" });

    expect(result).toMatchObject({
      ok: false,
      code: "desktop_capture_failed",
      message: "capture failed"
    });
  });

  it("includes the exit signal when spawned screencapture fails without stderr output", async () => {
    const cacheRoot = await mkdtemp(path.join(os.tmpdir(), "odb-desktop-spawn-signal-"));
    cleanupPaths.push(cacheRoot);
    const execFileImpl = createSwiftExecFileImpl();
    spawnMock.mockImplementation(() => {
      const child = createSpawnProcess({ stdout: null, stderr: null });
      queueMicrotask(() => {
        child.emit("close", 1, "SIGTERM");
      });
      return child;
    });

    const runtime = createDesktopRuntime({
      cacheRoot,
      platform: "darwin",
      config: makeDesktopConfig(),
      execFileImpl
    });

    const result = await runtime.captureDesktop({ reason: "spawn-signal" });

    expect(result).toMatchObject({
      ok: false,
      code: "desktop_capture_failed"
    });
    expect(result.message).toContain("Command failed: /usr/sbin/screencapture -x");
    expect(result.message).toContain("(SIGTERM)");
  });

  it("falls back to the plain command failure message when spawned screencapture exits without stderr or signal", async () => {
    const cacheRoot = await mkdtemp(path.join(os.tmpdir(), "odb-desktop-spawn-plain-failure-"));
    cleanupPaths.push(cacheRoot);
    const execFileImpl = createSwiftExecFileImpl();
    spawnMock.mockImplementation(() => {
      const child = createSpawnProcess({ stdout: null, stderr: null });
      queueMicrotask(() => {
        child.emit("close", 1, null);
      });
      return child;
    });

    const runtime = createDesktopRuntime({
      cacheRoot,
      platform: "darwin",
      config: makeDesktopConfig({ commandTimeoutMs: 0 }),
      execFileImpl
    });

    const result = await runtime.captureDesktop({ reason: "spawn-plain-failure" });

    expect(result).toMatchObject({
      ok: false,
      code: "desktop_capture_failed"
    });
    expect(result.message).toContain("Command failed: /usr/sbin/screencapture -x");
    expect(result.message).not.toContain("(SIGTERM)");
  });

  it("normalizes non-Error spawned process failures into capture failures", async () => {
    const cacheRoot = await mkdtemp(path.join(os.tmpdir(), "odb-desktop-spawn-non-error-"));
    cleanupPaths.push(cacheRoot);
    const execFileImpl = createSwiftExecFileImpl();
    spawnMock.mockImplementation(() => {
      const child = createSpawnProcess();
      queueMicrotask(() => {
        child.emit("error", "spawn failed");
      });
      return child;
    });

    const runtime = createDesktopRuntime({
      cacheRoot,
      platform: "darwin",
      config: makeDesktopConfig({ commandTimeoutMs: 0 }),
      execFileImpl
    });

    const result = await runtime.captureDesktop({ reason: "spawn-non-error" });

    expect(result).toMatchObject({
      ok: false,
      code: "desktop_capture_failed",
      message: "spawn failed"
    });
  });

  it("fails when spawned screencapture output exceeds the max buffer", async () => {
    const cacheRoot = await mkdtemp(path.join(os.tmpdir(), "odb-desktop-spawn-max-buffer-"));
    cleanupPaths.push(cacheRoot);
    const execFileImpl = createSwiftExecFileImpl();
    const child = createSpawnProcess();
    spawnMock.mockImplementation(() => {
      queueMicrotask(() => {
        child.stdout?.emit("data", Buffer.alloc((10 * 1024 * 1024) + 1));
        child.emit("close", 1, null);
      });
      return child;
    });

    const runtime = createDesktopRuntime({
      cacheRoot,
      platform: "darwin",
      config: makeDesktopConfig({ commandTimeoutMs: 0 }),
      execFileImpl
    });

    const result = await runtime.captureDesktop({ reason: "spawn-max-buffer" });

    expect(result).toMatchObject({
      ok: false,
      code: "desktop_capture_failed",
      message: "desktop command maxBuffer exceeded"
    });
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("normalizes default spawn-backed capture timeouts into aborted failures", async () => {
    const cacheRoot = await mkdtemp(path.join(os.tmpdir(), "odb-desktop-spawn-timeout-"));
    cleanupPaths.push(cacheRoot);
    const execFileImpl = createSwiftExecFileImpl();
    const child = createSpawnProcess();
    spawnMock.mockImplementation(() => child);

    const runtime = createDesktopRuntime({
      cacheRoot,
      platform: "darwin",
      config: makeDesktopConfig({ commandTimeoutMs: 5 }),
      execFileImpl
    });

    const result = await runtime.captureDesktop({ reason: "spawn-timeout" });

    expect(result).toMatchObject({
      ok: false,
      code: "desktop_aborted",
      message: "desktop command timed out"
    });
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });
});
