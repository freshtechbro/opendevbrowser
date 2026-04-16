import { execFile, spawn } from "child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "util";
import type { DesktopConfig } from "../config";
import { writeDesktopAuditRecord, type DesktopAuditEnvelope, type DesktopAuditValue } from "./audit";
import { DesktopRuntimeError, isDesktopRuntimeError } from "./errors";
import type {
  DesktopAccessibilityNode,
  DesktopAccessibilityValue,
  DesktopCapability,
  DesktopCaptureInput,
  DesktopCaptureValue,
  DesktopFailureCode,
  DesktopResult,
  DesktopRuntimeLike,
  DesktopRuntimeStatus,
  DesktopWindowSummary
} from "./types";

type ExecFileResult = {
  stdout: string;
  stderr: string;
};

type ExecFileAsync = (
  file: string,
  args?: readonly string[],
  options?: {
    encoding?: BufferEncoding;
    timeout?: number;
    maxBuffer?: number;
  }
) => Promise<ExecFileResult>;

type DesktopRuntimeDependencies = {
  execFileImpl?: ExecFileAsync;
  captureCommandImpl?: ExecFileAsync;
  statImpl?: typeof stat;
  platform?: NodeJS.Platform;
  writeAuditRecord?: typeof writeDesktopAuditRecord;
};

type DesktopRuntimeArgs = {
  cacheRoot: string;
  config: DesktopConfig;
} & DesktopRuntimeDependencies;

type DesktopProcessInventory = {
  frontmostPid: number;
  frontmostWindowId?: string;
  windows: DesktopWindowSummary[];
};

type DesktopPermissionProbe = {
  screenCaptureGranted: boolean;
  accessibilityGranted: boolean;
};

type DesktopStatusResolution = {
  status: DesktopRuntimeStatus;
  failureMessage?: string;
};

const execFileAsync = promisify(execFile) as ExecFileAsync;
const SCREENSHOT_MIME_TYPE = "image/png" as const;
const MAX_PROCESS_OUTPUT_BYTES = 10 * 1024 * 1024;
const MACOS_SCREENCAPTURE_PATH = "/usr/sbin/screencapture";
const SCREEN_CAPTURE_PERMISSION_MESSAGE = "Desktop screen capture permission is not granted on this host.";
const ACCESSIBILITY_PERMISSION_MESSAGE = "Desktop accessibility permission is not granted on this host.";

type BufferedProcessOutput = {
  chunks: Buffer[];
  bytes: number;
};

const appendProcessOutput = (
  output: BufferedProcessOutput,
  chunk: Buffer,
  maxBuffer: number
): BufferedProcessOutput => {
  const bytes = output.bytes + chunk.length;
  if (bytes > maxBuffer) {
    throw new Error("desktop command maxBuffer exceeded");
  }
  return {
    chunks: [...output.chunks, chunk],
    bytes
  };
};

const decodeProcessOutput = (
  output: BufferedProcessOutput,
  encoding: BufferEncoding
): string => {
  return Buffer.concat(output.chunks).toString(encoding);
};

const buildCommandFailureMessage = (
  file: string,
  args: readonly string[],
  stderr: string,
  signal: NodeJS.Signals | null
): string => {
  const command = [file, ...args].join(" ");
  if (stderr.trim().length > 0) {
    return stderr.trim();
  }
  return signal ? `Command failed: ${command} (${signal})` : `Command failed: ${command}`;
};

const spawnFileAsync: ExecFileAsync = (file, args = [], options = {}) =>
  new Promise((resolve, reject) => {
    const encoding = options.encoding ?? "utf8";
    const maxBuffer = options.maxBuffer ?? MAX_PROCESS_OUTPUT_BYTES;
    const child = spawn(file, [...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout: BufferedProcessOutput = { chunks: [], bytes: 0 };
    let stderr: BufferedProcessOutput = { chunks: [], bytes: 0 };
    let settled = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    const settle = (callback: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      callback();
    };

    const fail = (error: unknown): void => {
      const normalized = error instanceof Error ? error : new Error(String(error));
      settle(() => reject(normalized));
    };

    const bindStream = (
      stream: NodeJS.ReadableStream | null,
      update: (output: BufferedProcessOutput) => void,
      readCurrent: () => BufferedProcessOutput
    ): void => {
      if (!stream) {
        return;
      }
      stream.on("data", (chunk: Buffer | string) => {
        try {
          const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
          update(appendProcessOutput(readCurrent(), value, maxBuffer));
        } catch (error) {
          child.kill("SIGTERM");
          fail(error);
        }
      });
    };

    bindStream(child.stdout, (output) => {
      stdout = output;
    }, () => stdout);
    bindStream(child.stderr, (output) => {
      stderr = output;
    }, () => stderr);
    child.on("error", fail);
    child.on("close", (code, signal) => {
      if (code === 0) {
        settle(() => resolve({
          stdout: decodeProcessOutput(stdout, encoding),
          stderr: decodeProcessOutput(stderr, encoding)
        }));
        return;
      }
      fail(new Error(buildCommandFailureMessage(
        file,
        args,
        decodeProcessOutput(stderr, encoding),
        signal
      )));
    });
    if ((options.timeout ?? 0) > 0) {
      timeoutHandle = setTimeout(() => {
        child.kill("SIGTERM");
        fail(new Error("desktop command timed out"));
      }, options.timeout);
    }
  });

const buildPermissionProbeSwift = (): string => `
import Foundation
import ApplicationServices
import CoreGraphics

let payload: [String: Any] = [
  "screenCaptureGranted": CGPreflightScreenCaptureAccess(),
  "accessibilityGranted": AXIsProcessTrusted()
]
let data = try JSONSerialization.data(withJSONObject: payload, options: [])
FileHandle.standardOutput.write(data)
`;

const buildWindowInventorySwift = (): string => `
import Foundation
import AppKit
import ScreenCaptureKit
import CoreGraphics

@main
struct Main {
  static func main() async {
    _ = NSApplication.shared
    let frontmostPid = Int(NSWorkspace.shared.frontmostApplication?.processIdentifier ?? 0)

    func orderedWindowIds(for ownerPid: Int) -> [String] {
      guard ownerPid > 0 else {
        return []
      }
      guard let entries = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else {
        return []
      }
      return entries.compactMap { entry in
        guard let pid = (entry[kCGWindowOwnerPID as String] as? NSNumber)?.intValue else {
          return nil
        }
        guard pid == ownerPid else {
          return nil
        }
        guard let layer = (entry[kCGWindowLayer as String] as? NSNumber)?.intValue else {
          return nil
        }
        guard layer == 0 else {
          return nil
        }
        guard let windowId = (entry[kCGWindowNumber as String] as? NSNumber)?.intValue else {
          return nil
        }
        return String(windowId)
      }
    }

    func encodeWindow(_ window: SCWindow) -> [String: Any]? {
      let frame = window.frame
      if window.windowLayer != 0 {
        return nil
      }
      if frame.width <= 50 || frame.height <= 50 {
        return nil
      }
      let ownerName = window.owningApplication?.applicationName ?? ""
      if ownerName.isEmpty {
        return nil
      }
      return [
        "id": String(window.windowID),
        "ownerName": ownerName,
        "ownerPid": Int(window.owningApplication?.processID ?? 0),
        "title": window.title ?? "",
        "bounds": [
          "x": frame.origin.x,
          "y": frame.origin.y,
          "width": frame.width,
          "height": frame.height
        ],
        "layer": Int(window.windowLayer),
        "alpha": 1.0,
        "isOnscreen": window.isOnScreen
      ]
    }

    do {
      let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
      let windows = content.windows.compactMap(encodeWindow)
      let orderedFrontmostWindowIds = orderedWindowIds(for: frontmostPid)
      var value: [String: Any] = [
        "frontmostPid": frontmostPid,
        "windows": windows
      ]
      if let frontmostWindowId = orderedFrontmostWindowIds.first(where: { id in
        windows.contains { ($0["id"] as? String) == id }
      }) {
        value["frontmostWindowId"] = frontmostWindowId
      }
      let data = try JSONSerialization.data(withJSONObject: value, options: [])
      FileHandle.standardOutput.write(data)
    } catch {
      fputs(String(describing: error), stderr)
      Foundation.exit(1)
    }
  }
}
`;

const buildAccessibilitySwift = (
  windowPid: number,
  windowTitle: string | undefined,
  maxDepth: number,
  maxChildren: number
): string => {
  const titleLiteral = JSON.stringify(windowTitle ?? "");
  return `
import Foundation
import ApplicationServices

func stringValue(_ element: AXUIElement, _ attribute: String) -> String? {
  var raw: CFTypeRef?
  let error = AXUIElementCopyAttributeValue(element, attribute as CFString, &raw)
  guard error == .success else {
    return nil
  }
  return raw as? String
}

func childrenValue(_ element: AXUIElement) -> [AXUIElement] {
  var raw: CFTypeRef?
  let error = AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &raw)
  guard error == .success else {
    return []
  }
  return raw as? [AXUIElement] ?? []
}

func snapshot(_ element: AXUIElement, depth: Int, maxChildren: Int) -> [String: Any] {
  var node: [String: Any] = [
    "role": stringValue(element, kAXRoleAttribute as String) ?? "AXUnknown"
  ]
  if let title = stringValue(element, kAXTitleAttribute as String), !title.isEmpty {
    node["title"] = title
  }
  if let description = stringValue(element, kAXDescriptionAttribute as String), !description.isEmpty {
    node["description"] = description
  }
  if let value = stringValue(element, kAXValueAttribute as String), !value.isEmpty {
    node["value"] = value
  }
  if depth <= 0 {
    node["children"] = []
    return node
  }
  let children = Array(childrenValue(element).prefix(maxChildren)).map { snapshot($0, depth: depth - 1, maxChildren: maxChildren) }
  node["children"] = children
  return node
}

let pid = pid_t(${windowPid})
let titleHint = ${titleLiteral}
let maxDepth = ${maxDepth}
let maxChildren = ${maxChildren}
let appRef = AXUIElementCreateApplication(pid)
var focusedRaw: CFTypeRef?
let focusedError = AXUIElementCopyAttributeValue(appRef, kAXFocusedWindowAttribute as CFString, &focusedRaw)
var candidateWindow: AXUIElement? = nil
if focusedError == .success, let focusedRaw = focusedRaw {
  candidateWindow = focusedRaw as! AXUIElement
}

if !titleHint.isEmpty {
  var windowsRaw: CFTypeRef?
  let windowsError = AXUIElementCopyAttributeValue(appRef, kAXWindowsAttribute as CFString, &windowsRaw)
  if windowsError == .success, let windows = windowsRaw as? [AXUIElement] {
    if let match = windows.first(where: { stringValue($0, kAXTitleAttribute as String) == titleHint }) {
      candidateWindow = match
    }
  }
}

guard let window = candidateWindow else {
  throw NSError(domain: "OpenDevBrowserDesktop", code: 1, userInfo: [NSLocalizedDescriptionKey: "accessibility_window_unavailable"])
}

let payload: [String: Any] = [
  "tree": snapshot(window, depth: maxDepth, maxChildren: maxChildren)
]
let data = try JSONSerialization.data(withJSONObject: payload, options: [])
FileHandle.standardOutput.write(data)
`;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const toNumber = (value: unknown): number => {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
};

const toStringOrUndefined = (value: unknown): string | undefined => {
  return typeof value === "string" && value.length > 0 ? value : undefined;
};

const parseWindowInventory = (raw: unknown): DesktopProcessInventory => {
  if (!isRecord(raw)) {
    throw new DesktopRuntimeError("desktop_query_failed", "Desktop window inventory returned an invalid payload.");
  }
  const frontmostPid = toNumber(raw.frontmostPid);
  const windows = Array.isArray(raw.windows)
    ? raw.windows.flatMap((entry): DesktopWindowSummary[] => {
        if (!isRecord(entry) || !isRecord(entry.bounds)) {
          return [];
        }
        const id = toStringOrUndefined(entry.id);
        const ownerName = toStringOrUndefined(entry.ownerName);
        if (!id || !ownerName) {
          return [];
        }
        return [{
          id,
          ownerName,
          ownerPid: toNumber(entry.ownerPid),
          ...(toStringOrUndefined(entry.title) ? { title: toStringOrUndefined(entry.title) } : {}),
          bounds: {
            x: toNumber(entry.bounds.x),
            y: toNumber(entry.bounds.y),
            width: toNumber(entry.bounds.width),
            height: toNumber(entry.bounds.height)
          },
          layer: toNumber(entry.layer),
          alpha: toNumber(entry.alpha),
          isOnscreen: entry.isOnscreen !== false
        }];
      })
    : [];
  const frontmostWindowId = toStringOrUndefined(raw.frontmostWindowId);
  const hasFrontmostWindow = frontmostWindowId
    ? windows.some((entry) => entry.id === frontmostWindowId)
    : false;

  return {
    frontmostPid,
    ...(hasFrontmostWindow && frontmostWindowId ? { frontmostWindowId } : {}),
    windows
  };
};

const parseAccessibilityTree = (raw: unknown): DesktopAccessibilityNode => {
  if (!isRecord(raw)) {
    throw new DesktopRuntimeError(
      "desktop_accessibility_unavailable",
      "Desktop accessibility snapshot returned an invalid payload."
    );
  }
  const role = toStringOrUndefined(raw.role) ?? "AXUnknown";
  const children = Array.isArray(raw.children)
    ? raw.children.map((child) => parseAccessibilityTree(child))
    : [];

  return {
    role,
    ...(toStringOrUndefined(raw.title) ? { title: toStringOrUndefined(raw.title) } : {}),
    ...(toStringOrUndefined(raw.description) ? { description: toStringOrUndefined(raw.description) } : {}),
    ...(toStringOrUndefined(raw.value) ? { value: toStringOrUndefined(raw.value) } : {}),
    children
  };
};

const parsePermissionProbe = (raw: unknown): DesktopPermissionProbe => {
  if (
    !isRecord(raw)
    || typeof raw.screenCaptureGranted !== "boolean"
    || typeof raw.accessibilityGranted !== "boolean"
  ) {
    throw new DesktopRuntimeError(
      "desktop_query_failed",
      "Desktop permission probe returned an invalid payload."
    );
  }
  return {
    screenCaptureGranted: raw.screenCaptureGranted,
    accessibilityGranted: raw.accessibilityGranted
  };
};

const normalizeFailure = (error: unknown, fallbackCode: DesktopFailureCode): {
  code: DesktopFailureCode;
  message: string;
} => {
  if (isDesktopRuntimeError(error)) {
    return { code: error.code, message: error.message };
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/ENOENT|not found|No such file/i.test(message)) {
    if (/\bswift\b/i.test(message)) {
      return {
        code: "desktop_unsupported",
        message: "Desktop observation requires the macOS swift command for availability, window, and accessibility probes. Install Xcode or a Swift toolchain and retry."
      };
    }
    return {
      code: "desktop_unsupported",
      message: "Required desktop observation tooling is unavailable on this host."
    };
  }
  if (/timed out/i.test(message)) {
    return {
      code: "desktop_aborted",
      message
    };
  }
  return {
    code: fallbackCode,
    message
  };
};

const resolveAuditArtifactsDir = (cacheRoot: string, configuredPath: string): string => {
  return path.isAbsolute(configuredPath)
    ? configuredPath
    : path.join(cacheRoot, configuredPath);
};

const resolveCapabilities = (probe: DesktopPermissionProbe): DesktopCapability[] => {
  if (!probe.screenCaptureGranted) {
    return [];
  }
  return probe.accessibilityGranted
    ? ["observe.windows", "observe.screen", "observe.window", "observe.accessibility"]
    : ["observe.windows", "observe.screen", "observe.window"];
};

const unavailableStatus = (
  platform: NodeJS.Platform,
  config: DesktopConfig,
  auditArtifactsDir: string,
  reason: DesktopFailureCode
): DesktopRuntimeStatus => ({
  platform,
  permissionLevel: config.permissionLevel,
  available: false,
  reason,
  capabilities: [],
  auditArtifactsDir
});

const resolveStatus = async (
  platform: NodeJS.Platform,
  config: DesktopConfig,
  auditArtifactsDir: string,
  runPermissionProbe: () => Promise<DesktopPermissionProbe>
): Promise<DesktopStatusResolution> => {
  if (platform !== "darwin") {
    return {
      status: unavailableStatus(platform, config, auditArtifactsDir, "desktop_unsupported")
    };
  }
  if (config.permissionLevel === "off") {
    return {
      status: unavailableStatus(platform, config, auditArtifactsDir, "desktop_permission_denied")
    };
  }
  try {
    const capabilities = resolveCapabilities(await runPermissionProbe());
    if (capabilities.length === 0) {
      return {
        status: unavailableStatus(platform, config, auditArtifactsDir, "desktop_permission_denied")
      };
    }
    return {
      status: {
        platform,
        permissionLevel: config.permissionLevel,
        available: true,
        capabilities,
        auditArtifactsDir
      }
    };
  } catch (error) {
    const failure = normalizeFailure(error, "desktop_query_failed");
    return {
      status: unavailableStatus(platform, config, auditArtifactsDir, failure.code),
      failureMessage: failure.message
    };
  }
};

const pickActiveWindow = (inventory: DesktopProcessInventory): DesktopWindowSummary | null => {
  const frontmostWindow = inventory.frontmostWindowId
    ? inventory.windows.find((window) => window.id === inventory.frontmostWindowId)
    : undefined;
  const matchingWindow = inventory.windows.find((window) => window.ownerPid === inventory.frontmostPid);
  return frontmostWindow ?? matchingWindow ?? inventory.windows[0] ?? null;
};

const verifyCaptureArtifact = async (
  statImpl: typeof stat,
  artifactPath: string
): Promise<void> => {
  const stats = await statImpl(artifactPath);
  if (stats.size <= 0) {
    throw new DesktopRuntimeError("desktop_capture_failed", "Desktop capture produced an empty artifact.");
  }
};

export function createDesktopRuntime(args: DesktopRuntimeArgs): DesktopRuntimeLike {
  const execImpl = args.execFileImpl ?? execFileAsync;
  const captureImpl = args.captureCommandImpl ?? spawnFileAsync;
  const statImpl = args.statImpl ?? stat;
  const platform = args.platform ?? process.platform;
  const auditArtifactsDir = resolveAuditArtifactsDir(args.cacheRoot, args.config.auditArtifactsDir);
  const writeAuditRecord = args.writeAuditRecord ?? writeDesktopAuditRecord;

  const runCommand = async (command: string, commandArgs: readonly string[]): Promise<string> => {
    const result = await execImpl(command, commandArgs, {
      encoding: "utf8",
      timeout: args.config.commandTimeoutMs,
      maxBuffer: MAX_PROCESS_OUTPUT_BYTES
    });
    return result.stdout;
  };

  const runCaptureCommand = async (command: string, commandArgs: readonly string[]): Promise<string> => {
    const result = await captureImpl(command, commandArgs, {
      timeout: args.config.commandTimeoutMs
    });
    return result.stdout;
  };

  const runPermissionProbe = async (): Promise<DesktopPermissionProbe> => {
    const stdout = await runCommand("swift", ["-e", buildPermissionProbeSwift()]);
    return parsePermissionProbe(JSON.parse(stdout) as unknown);
  };

  const getStatusResolution = async (): Promise<DesktopStatusResolution> => {
    return resolveStatus(platform, args.config, auditArtifactsDir, runPermissionProbe);
  };

  const status = async (): Promise<DesktopRuntimeStatus> => {
    return (await getStatusResolution()).status;
  };

  const ensureDesktopRuntimeEnabled = (): void => {
    if (platform !== "darwin") {
      throw new DesktopRuntimeError("desktop_unsupported", "Desktop observation is unavailable on this platform.");
    }
    if (args.config.permissionLevel === "off") {
      throw new DesktopRuntimeError("desktop_permission_denied", "Desktop observation is disabled by configuration.");
    }
  };

  const ensureUsable = async (capability: DesktopCapability): Promise<void> => {
    ensureDesktopRuntimeEnabled();
    const { status: runtimeStatus, failureMessage } = await getStatusResolution();
    if (!runtimeStatus.available) {
      const failureCode = runtimeStatus.reason as DesktopFailureCode;
      if (failureCode === "desktop_permission_denied") {
        throw new DesktopRuntimeError(failureCode, SCREEN_CAPTURE_PERMISSION_MESSAGE);
      }
      throw new DesktopRuntimeError(
        failureCode,
        failureMessage!
      );
    }
    if (runtimeStatus.capabilities.includes(capability)) {
      return;
    }
    throw new DesktopRuntimeError(
      "desktop_permission_denied",
      ACCESSIBILITY_PERMISSION_MESSAGE
    );
  };

  const runWindowInventory = async (): Promise<DesktopProcessInventory> => {
    const inventoryRoot = await mkdtemp(path.join(args.cacheRoot, "desktop-window-inventory-"));
    const sourcePath = path.join(inventoryRoot, "main.swift");
    const binaryPath = path.join(inventoryRoot, "main");
    await writeFile(sourcePath, buildWindowInventorySwift(), "utf8");
    try {
      await runCommand("swiftc", ["-parse-as-library", sourcePath, "-o", binaryPath]);
      const stdout = await runCommand(binaryPath, []);
      return parseWindowInventory(JSON.parse(stdout) as unknown);
    } finally {
      await rm(inventoryRoot, { recursive: true, force: true });
    }
  };

  const resolveWindowForCapture = async (
    windowId: string
  ): Promise<DesktopWindowSummary | null> => {
    const inventory = await runWindowInventory();
    return inventory.windows.find((entry) => entry.id === windowId) ?? null;
  };

  const withAudit = async <T>(params: {
    operation: "windows.list" | "window.active" | "capture.desktop" | "capture.window" | "accessibility.snapshot";
    capability: "observe.windows" | "observe.screen" | "observe.window" | "observe.accessibility";
    reason?: string;
    ensureReady?: () => Promise<void>;
    run: (auditId: string) => Promise<{
      value: T;
      artifactPaths?: string[];
      details?: Record<string, DesktopAuditValue>;
    }>;
    failureCode: DesktopFailureCode;
  }): Promise<DesktopResult<T>> => {
    const startedAt = new Date();
    const auditId = randomUUID();
    let envelope: DesktopAuditEnvelope | null = null;
    try {
      await (params.ensureReady?.() ?? ensureUsable(params.capability));
      envelope = await writeAuditRecord({
        auditDir: auditArtifactsDir,
        operation: params.operation,
        capability: params.capability,
        result: "ok",
        details: {
          reason: params.reason ?? params.operation
        },
        now: () => startedAt,
        uuid: () => auditId
      });
      const outcome = await params.run(envelope.auditId);
      envelope = await writeAuditRecord({
        auditDir: auditArtifactsDir,
        operation: params.operation,
        capability: params.capability,
        result: "ok",
        artifactPaths: outcome.artifactPaths,
        details: {
          reason: params.reason ?? params.operation,
          ...(outcome.details ?? {})
        },
        now: () => startedAt,
        uuid: () => auditId
      });
      return {
        ok: true,
        value: outcome.value,
        audit: envelope
      };
    } catch (error) {
      const failure = normalizeFailure(error, params.failureCode);
      envelope = await writeAuditRecord({
        auditDir: auditArtifactsDir,
        operation: params.operation,
        capability: params.capability,
        result: "failed",
        failureCode: failure.code,
        message: failure.message,
        details: {
          reason: params.reason ?? params.operation
        },
        now: () => startedAt,
        uuid: () => auditId
      });
      return {
        ok: false,
        code: failure.code,
        message: failure.message,
        audit: envelope
      };
    }
  };

  const listWindows = async (reason = "desktop_windows"): Promise<DesktopResult<{ windows: DesktopWindowSummary[] }>> => {
    return withAudit({
      operation: "windows.list",
      capability: "observe.windows",
      reason,
      failureCode: "desktop_query_failed",
      run: async () => {
        const inventory = await runWindowInventory();
        return {
          value: { windows: inventory.windows },
          details: {
            windowCount: inventory.windows.length
          }
        };
      }
    });
  };

  const activeWindow = async (reason = "desktop_active_window"): Promise<DesktopResult<DesktopWindowSummary | null>> => {
    return withAudit({
      operation: "window.active",
      capability: "observe.windows",
      reason,
      failureCode: "desktop_query_failed",
      run: async () => {
        const inventory = await runWindowInventory();
        const active = pickActiveWindow(inventory);
        return {
          value: active,
          details: {
            frontmostPid: inventory.frontmostPid
          }
        };
      }
    });
  };

  const captureDesktop = async (input: DesktopCaptureInput): Promise<DesktopResult<DesktopCaptureValue>> => {
    return withAudit({
      operation: "capture.desktop",
      capability: "observe.screen",
      reason: input.reason,
      ensureReady: async () => ensureUsable("observe.screen"),
      failureCode: "desktop_capture_failed",
      run: async (auditId) => {
        const artifactPath = path.join(auditArtifactsDir, `${auditId}.png`);
        await runCaptureCommand(MACOS_SCREENCAPTURE_PATH, ["-x", artifactPath]);
        await verifyCaptureArtifact(statImpl, artifactPath);
        return {
          value: {
            capture: {
              path: artifactPath,
              mimeType: SCREENSHOT_MIME_TYPE
            }
          },
          artifactPaths: [artifactPath]
        };
      }
    });
  };

  const captureWindow = async (
    windowId: string,
    input: DesktopCaptureInput
  ): Promise<DesktopResult<DesktopCaptureValue>> => {
    return withAudit({
      operation: "capture.window",
      capability: "observe.window",
      reason: input.reason,
      ensureReady: async () => ensureUsable("observe.window"),
      failureCode: "desktop_capture_failed",
      run: async (auditId) => {
        const window = await resolveWindowForCapture(windowId);
        if (window === null) {
          throw new DesktopRuntimeError(
            "desktop_window_not_found",
            `Desktop window ${windowId} is not available for capture.`
          );
        }
        const artifactPath = path.join(auditArtifactsDir, `${auditId}.png`);
        await runCaptureCommand(MACOS_SCREENCAPTURE_PATH, ["-x", `-l${window.id}`, artifactPath]);
        await verifyCaptureArtifact(statImpl, artifactPath);
        return {
          value: {
            capture: {
              path: artifactPath,
              mimeType: SCREENSHOT_MIME_TYPE
            },
            window
          },
          artifactPaths: [artifactPath],
          details: {
            windowId,
            ownerName: window.ownerName
          }
        };
      }
    });
  };

  const accessibilitySnapshot = async (
    reason: string,
    windowId?: string
  ): Promise<DesktopResult<DesktopAccessibilityValue>> => {
    return withAudit({
      operation: "accessibility.snapshot",
      capability: "observe.accessibility",
      reason,
      failureCode: "desktop_accessibility_unavailable",
      run: async () => {
        const inventory = await runWindowInventory();
        const targetWindow = windowId
          ? inventory.windows.find((entry) => entry.id === windowId) ?? null
          : pickActiveWindow(inventory);
        if (!targetWindow) {
          throw new DesktopRuntimeError(
            "desktop_window_not_found",
            windowId
              ? `Desktop window ${windowId} is not available for accessibility capture.`
              : "No active desktop window is available for accessibility capture."
          );
        }
        const stdout = await runCommand("swift", [
          "-e",
          buildAccessibilitySwift(
            targetWindow.ownerPid,
            targetWindow.title,
            args.config.accessibilityMaxDepth,
            args.config.accessibilityMaxChildren
          )
        ]);
        const payload = JSON.parse(stdout) as unknown;
        if (!isRecord(payload) || !isRecord(payload.tree)) {
          throw new DesktopRuntimeError(
            "desktop_accessibility_unavailable",
            "Desktop accessibility snapshot returned an invalid payload."
          );
        }
        return {
          value: {
            window: targetWindow,
            tree: parseAccessibilityTree(payload.tree)
          },
          details: {
            windowId: targetWindow.id,
            ownerName: targetWindow.ownerName
          }
        };
      }
    });
  };

  return {
    status,
    listWindows,
    activeWindow,
    captureDesktop,
    captureWindow,
    accessibilitySnapshot
  };
}
