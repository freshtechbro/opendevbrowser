import { execFile } from "child_process";
import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
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
import CoreGraphics

func intValue(_ value: Any?) -> Int {
  return (value as? NSNumber)?.intValue ?? 0
}

func doubleValue(_ value: Any?) -> Double {
  return (value as? NSNumber)?.doubleValue ?? 0
}

let frontmostPid = Int(NSWorkspace.shared.frontmostApplication?.processIdentifier ?? 0)
let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
let rawWindows = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] ?? []
let windows = rawWindows.compactMap { entry -> [String: Any]? in
  let layer = intValue(entry[kCGWindowLayer as String])
  if layer != 0 {
    return nil
  }
  let bounds = entry[kCGWindowBounds as String] as? [String: Any] ?? [:]
  let width = doubleValue(bounds["Width"])
  let height = doubleValue(bounds["Height"])
  if width <= 50 || height <= 50 {
    return nil
  }
  let ownerName = entry[kCGWindowOwnerName as String] as? String ?? ""
  if ownerName.isEmpty {
    return nil
  }
  let title = entry[kCGWindowName as String] as? String ?? ""
  return [
    "id": String(intValue(entry[kCGWindowNumber as String])),
    "ownerName": ownerName,
    "ownerPid": intValue(entry[kCGWindowOwnerPID as String]),
    "title": title,
    "bounds": [
      "x": doubleValue(bounds["X"]),
      "y": doubleValue(bounds["Y"]),
      "width": width,
      "height": height
    ],
    "layer": layer,
    "alpha": doubleValue(entry[kCGWindowAlpha as String]),
    "isOnscreen": intValue(entry[kCGWindowIsOnscreen as String]) != 0
  ]
}
let payload: [String: Any] = [
  "frontmostPid": frontmostPid,
  "windows": windows
]
let data = try JSONSerialization.data(withJSONObject: payload, options: [])
FileHandle.standardOutput.write(data)
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

  return { frontmostPid, windows };
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

const resolveUnavailableMessage = (
  config: DesktopConfig,
  failureCode: DesktopFailureCode,
  failureMessage?: string
): string => {
  if (failureCode === "desktop_permission_denied") {
    return config.permissionLevel === "off"
      ? "Desktop observation is disabled by configuration."
      : "Desktop screen capture permission is not granted on this host.";
  }
  if (failureCode === "desktop_unsupported") {
    return failureMessage ?? "Desktop observation is unavailable on this platform.";
  }
  return failureMessage ?? "Desktop observation availability could not be confirmed.";
};

const resolveCapabilityMessage = (capability: DesktopCapability): string => {
  return capability === "observe.accessibility"
    ? "Desktop accessibility permission is not granted on this host."
    : "Desktop observation permission is not granted on this host.";
};

const byDescendingArea = (left: DesktopWindowSummary, right: DesktopWindowSummary): number => {
  const leftArea = left.bounds.width * left.bounds.height;
  const rightArea = right.bounds.width * right.bounds.height;
  return rightArea - leftArea;
};

const pickActiveWindow = (inventory: DesktopProcessInventory): DesktopWindowSummary | null => {
  const matchingWindows = inventory.windows
    .filter((window) => window.ownerPid === inventory.frontmostPid)
    .sort(byDescendingArea);
  if (matchingWindows.length > 0) {
    return matchingWindows[0]!;
  }
  const allWindows = [...inventory.windows].sort(byDescendingArea);
  return allWindows[0] ?? null;
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

  const ensureUsable = async (capability: DesktopCapability): Promise<void> => {
    const { status: runtimeStatus, failureMessage } = await getStatusResolution();
    if (!runtimeStatus.available) {
      const failureCode = runtimeStatus.reason ?? "desktop_query_failed";
      throw new DesktopRuntimeError(
        failureCode,
        resolveUnavailableMessage(args.config, failureCode, failureMessage)
      );
    }
    if (runtimeStatus.capabilities.includes(capability)) {
      return;
    }
    throw new DesktopRuntimeError(
      "desktop_permission_denied",
      resolveCapabilityMessage(capability)
    );
  };

  const runWindowInventory = async (): Promise<DesktopProcessInventory> => {
    const stdout = await runCommand("swift", ["-e", buildWindowInventorySwift()]);
    return parseWindowInventory(JSON.parse(stdout) as unknown);
  };

  const withAudit = async <T>(params: {
    operation: "windows.list" | "window.active" | "capture.desktop" | "capture.window" | "accessibility.snapshot";
    capability: "observe.windows" | "observe.screen" | "observe.window" | "observe.accessibility";
    reason?: string;
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
      await ensureUsable(params.capability);
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
      failureCode: "desktop_capture_failed",
      run: async (auditId) => {
        const artifactPath = path.join(auditArtifactsDir, `${auditId}.png`);
        await runCommand("screencapture", ["-x", artifactPath]);
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
      failureCode: "desktop_capture_failed",
      run: async (auditId) => {
        const inventory = await runWindowInventory();
        const window = inventory.windows.find((entry) => entry.id === windowId);
        if (!window) {
          throw new DesktopRuntimeError(
            "desktop_window_not_found",
            `Desktop window ${windowId} is not available for capture.`
          );
        }
        const artifactPath = path.join(auditArtifactsDir, `${auditId}.png`);
        await runCommand("screencapture", ["-x", "-l", windowId, artifactPath]);
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
