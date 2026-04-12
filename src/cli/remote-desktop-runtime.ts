import type {
  DesktopCaptureInput,
  DesktopResult,
  DesktopRuntimeLike,
  DesktopRuntimeStatus,
  DesktopAccessibilityValue,
  DesktopCaptureValue,
  DesktopWindowSummary
} from "../desktop";
import { DaemonClient } from "./daemon-client";

export class RemoteDesktopRuntime implements DesktopRuntimeLike {
  private readonly client: DaemonClient;

  constructor(client: DaemonClient) {
    this.client = client;
  }

  status(): Promise<DesktopRuntimeStatus> {
    return this.client.call<DesktopRuntimeStatus>("desktop.status");
  }

  listWindows(reason?: string): Promise<DesktopResult<{ windows: DesktopWindowSummary[] }>> {
    return this.client.call("desktop.windows.list", {
      ...(reason ? { reason } : {})
    });
  }

  activeWindow(reason?: string): Promise<DesktopResult<DesktopWindowSummary | null>> {
    return this.client.call("desktop.window.active", {
      ...(reason ? { reason } : {})
    });
  }

  captureDesktop(input: DesktopCaptureInput): Promise<DesktopResult<DesktopCaptureValue>> {
    return this.client.call("desktop.capture.desktop", { reason: input.reason });
  }

  captureWindow(windowId: string, input: DesktopCaptureInput): Promise<DesktopResult<DesktopCaptureValue>> {
    return this.client.call("desktop.capture.window", {
      windowId,
      reason: input.reason
    });
  }

  accessibilitySnapshot(reason: string, windowId?: string): Promise<DesktopResult<DesktopAccessibilityValue>> {
    return this.client.call("desktop.accessibility.snapshot", {
      reason,
      ...(windowId ? { windowId } : {})
    });
  }
}
