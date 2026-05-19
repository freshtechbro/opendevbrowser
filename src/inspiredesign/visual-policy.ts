import type { ProviderCookiePolicy, ProviderError, ProviderFailureEntry, ProviderReasonCode } from "../providers/types";
import type { InspiredesignVisualEvidenceMode } from "./visual-evidence";

export type InspiredesignVisualPolicyReason =
  | "visual_evidence_off"
  | "visual_capture_allowed"
  | "policy_blocked"
  | "auth_required"
  | "challenge_detected"
  | "rate_limited";

export type InspiredesignVisualPolicyDecision = {
  status: "allowed" | "skipped" | "failed";
  reason: InspiredesignVisualPolicyReason;
  message: string;
};

export type InspiredesignVisualPolicyInput = {
  visualEvidence: InspiredesignVisualEvidenceMode;
  failures?: ProviderFailureEntry[];
  topLevelError?: ProviderError;
  cookiePolicy?: ProviderCookiePolicy;
  hasUsableRecords?: boolean;
};

const VISUAL_BLOCKER_REASONS = new Set<ProviderReasonCode>([
  "policy_blocked",
  "auth_required",
  "challenge_detected",
  "rate_limited"
]);

const toVisualPolicyReason = (reasonCode: ProviderReasonCode): InspiredesignVisualPolicyReason | null => {
  if (!VISUAL_BLOCKER_REASONS.has(reasonCode)) return null;
  if (
    reasonCode === "policy_blocked"
    || reasonCode === "auth_required"
    || reasonCode === "challenge_detected"
    || reasonCode === "rate_limited"
  ) {
    return reasonCode;
  }
  return null;
};

const blockerFromFailures = (
  failures: ProviderFailureEntry[] | undefined
): InspiredesignVisualPolicyReason | null => {
  for (const failure of failures ?? []) {
    const reasonCode = failure.error.reasonCode;
    if (!reasonCode) continue;
    const blocker = toVisualPolicyReason(reasonCode);
    if (blocker) return blocker;
  }
  return null;
};

const blockerFromTopLevelError = (
  error: ProviderError | undefined
): InspiredesignVisualPolicyReason | null => {
  if (!error?.reasonCode) return null;
  return toVisualPolicyReason(error.reasonCode);
};

const messageForBlocker = (reason: InspiredesignVisualPolicyReason): string => {
  switch (reason) {
    case "policy_blocked":
      return "Visual capture skipped because provider policy blocked the reference.";
    case "auth_required":
      return "Visual capture skipped because authenticated access is unresolved.";
    case "challenge_detected":
      return "Visual capture skipped because a challenge was detected.";
    case "rate_limited":
      return "Visual capture skipped because the provider is rate limited.";
    case "visual_evidence_off":
      return "Visual evidence is disabled for this run.";
    case "visual_capture_allowed":
      return "Visual capture is allowed for this reference.";
  }
};

export const decideInspiredesignVisualCapturePolicy = (
  input: InspiredesignVisualPolicyInput
): InspiredesignVisualPolicyDecision => {
  if (input.visualEvidence === "off") {
    return {
      status: "skipped",
      reason: "visual_evidence_off",
      message: messageForBlocker("visual_evidence_off")
    };
  }
  const blocker = input.hasUsableRecords === true
    ? null
    : blockerFromFailures(input.failures) ?? blockerFromTopLevelError(input.topLevelError);
  if (blocker) {
    return {
      status: "skipped",
      reason: blocker,
      message: messageForBlocker(blocker)
    };
  }
  return {
    status: "allowed",
    reason: "visual_capture_allowed",
    message: messageForBlocker("visual_capture_allowed")
  };
};
