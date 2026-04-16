import type { BrowserManagerLike } from "../browser/manager-types";
import { redactSensitive } from "../core/logging";
import type { InspiredesignCaptureEvidence } from "./inspiredesign-contract";

type InspiredesignCaptureManagerLike = Pick<
  BrowserManagerLike,
  "launch" | "goto" | "waitForLoad" | "snapshot" | "clonePage" | "disconnect" | "clonePageHtmlWithOptions"
>;

const INSPIREDESIGN_CAPTURE_TIMEOUT_MS = 30_000;

const clampInspiredesignCaptureTimeout = (timeoutMs?: number): number => {
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs)) return INSPIREDESIGN_CAPTURE_TIMEOUT_MS;
  return Math.max(1, Math.min(timeoutMs, INSPIREDESIGN_CAPTURE_TIMEOUT_MS));
};

const sanitizeInspiredesignCaptureText = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  const redacted = redactSensitive(value);
  return typeof redacted === "string" ? redacted : value;
};

export async function captureInspiredesignReferenceFromManager(
  manager: InspiredesignCaptureManagerLike,
  url: string,
  timeoutMs?: number
): Promise<InspiredesignCaptureEvidence> {
  const captureTimeoutMs = clampInspiredesignCaptureTimeout(timeoutMs);
  const session = await manager.launch({
    headless: true,
    startUrl: "about:blank",
    persistProfile: false
  });
  try {
    await manager.goto(session.sessionId, url, "load", captureTimeoutMs);
    await manager.waitForLoad(session.sessionId, "networkidle", captureTimeoutMs).catch(() => undefined);
    const snapshot = await manager.snapshot(session.sessionId, "actionables", 12_000);
    const clone = await manager.clonePage(session.sessionId);
    const dom = typeof manager.clonePageHtmlWithOptions === "function"
      ? await manager.clonePageHtmlWithOptions(session.sessionId).catch(() => null)
      : null;

    return {
      snapshot: {
        content: sanitizeInspiredesignCaptureText(snapshot.content) ?? snapshot.content,
        refCount: snapshot.refCount,
        warnings: snapshot.warnings ?? []
      },
      ...(dom?.html
        ? {
          dom: {
            outerHTML: sanitizeInspiredesignCaptureText(dom.html) ?? dom.html,
            truncated: false
          }
        }
        : {}),
      clone: {
        componentPreview: sanitizeInspiredesignCaptureText(clone.component) ?? clone.component,
        cssPreview: sanitizeInspiredesignCaptureText(clone.css) ?? clone.css,
        warnings: clone.warnings ?? []
      }
    };
  } finally {
    await manager.disconnect(session.sessionId, true).catch(() => undefined);
  }
}
