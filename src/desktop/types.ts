export type DesktopCapability =
  | "observe.windows"
  | "observe.screen"
  | "observe.window"
  | "observe.accessibility";

export type DesktopPermissionLevel = "off" | "observe";

export type DesktopFailureCode =
  | "desktop_unsupported"
  | "desktop_permission_denied"
  | "desktop_query_failed"
  | "desktop_window_not_found"
  | "desktop_capture_failed"
  | "desktop_accessibility_unavailable"
  | "desktop_aborted";

export type DesktopBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DesktopWindowSummary = {
  id: string;
  ownerName: string;
  ownerPid: number;
  title?: string;
  bounds: DesktopBounds;
  layer: number;
  alpha: number;
  isOnscreen: boolean;
};

export type DesktopRuntimeStatus = {
  platform: NodeJS.Platform;
  permissionLevel: DesktopPermissionLevel;
  available: boolean;
  reason?: DesktopFailureCode;
  capabilities: DesktopCapability[];
  auditArtifactsDir: string;
};

export type DesktopAuditInfo = {
  auditId: string;
  at: string;
  recordPath: string;
  artifactPaths: string[];
};

export type DesktopResult<T> =
  | {
      ok: true;
      value: T;
      audit: DesktopAuditInfo;
    }
  | {
      ok: false;
      code: DesktopFailureCode;
      message: string;
      audit: DesktopAuditInfo;
    };

export type DesktopCaptureInput = {
  reason: string;
};

export type DesktopCaptureArtifact = {
  path: string;
  mimeType: "image/png";
};

export type DesktopCaptureValue = {
  capture: DesktopCaptureArtifact;
  window?: DesktopWindowSummary;
};

export type DesktopAccessibilityNode = {
  role: string;
  title?: string;
  description?: string;
  value?: string;
  children: DesktopAccessibilityNode[];
};

export type DesktopAccessibilityValue = {
  window: DesktopWindowSummary;
  tree: DesktopAccessibilityNode;
};

export interface DesktopRuntimeLike {
  status(): Promise<DesktopRuntimeStatus>;
  listWindows(reason?: string): Promise<DesktopResult<{ windows: DesktopWindowSummary[] }>>;
  activeWindow(reason?: string): Promise<DesktopResult<DesktopWindowSummary | null>>;
  captureDesktop(input: DesktopCaptureInput): Promise<DesktopResult<DesktopCaptureValue>>;
  captureWindow(windowId: string, input: DesktopCaptureInput): Promise<DesktopResult<DesktopCaptureValue>>;
  accessibilitySnapshot(reason: string, windowId?: string): Promise<DesktopResult<DesktopAccessibilityValue>>;
}
