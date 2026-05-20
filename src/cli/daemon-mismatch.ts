import { createDaemonGuidanceContext, renderWorkflowGuidance, routeNextStepGuidance } from "../guidance";
import type { NextStepGuidance } from "../guidance";
import type { JsonValue } from "../providers/types";

export const DAEMON_FINGERPRINT_MISMATCH_REASON = "daemon_fingerprint_mismatch";

export type DaemonFingerprintMismatchMessageInput = {
  label: string;
  port: number;
  pid?: number;
};

export const STATUS_PREFLIGHT_COMMAND = "opendevbrowser status --daemon --output-format json";
export const FINGERPRINT_CURRENT_ASSERTION = "data.fingerprintCurrent === true";

const formatPid = (pid?: number): string => {
  return Number.isInteger(pid) && Number(pid) > 0 ? ` pid=${pid}` : "";
};

export function buildDaemonFingerprintMismatchMessage({
  label,
  port,
  pid
}: DaemonFingerprintMismatchMessageInput): string {
  return `${label} on 127.0.0.1:${port}${formatPid(pid)} is protected by a different opendevbrowser build. Run \`${STATUS_PREFLIGHT_COMMAND}\` and continue only when \`${FINGERPRINT_CURRENT_ASSERTION}\`. Use the matching binary to stop it, restart the daemon from the current install, or isolate this run with separate OPENCODE_CONFIG_DIR, OPENCODE_CACHE_DIR, daemon port, and relay port.`;
}

export function buildDaemonFingerprintMismatchStatusGuidance(): string {
  return `Recovery: run \`${STATUS_PREFLIGHT_COMMAND}\` and proceed only when \`${FINGERPRINT_CURRENT_ASSERTION}\`; use the matching binary, restart the daemon from the current install, or isolate OPENCODE_CONFIG_DIR, OPENCODE_CACHE_DIR, daemon port, and relay port.`;
}

export function buildDaemonFingerprintMismatchNextStepGuidance(): NextStepGuidance {
  return routeNextStepGuidance(createDaemonGuidanceContext(DAEMON_FINGERPRINT_MISMATCH_REASON));
}

export function buildDaemonFingerprintMismatchGuidancePayload(): Record<string, JsonValue> {
  return renderWorkflowGuidance(buildDaemonFingerprintMismatchNextStepGuidance());
}
