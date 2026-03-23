import type { GovernedLaneRequest, GovernedLaneResult } from "./types";

const APPROVED_FIXTURE_RE = /\b(turnstile-checkbox|recaptcha-v2-checkbox|1x00000000000000000000AA|6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI)\b/i;

export const runOwnedEnvironmentLane = (request: GovernedLaneRequest): GovernedLaneResult => {
  const haystack = [request.bundle.url, request.bundle.title, request.bundle.snapshotText]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" ");
  const approved = APPROVED_FIXTURE_RE.test(haystack);
  return {
    status: approved ? "executed" : "blocked",
    lane: "owned_environment_fixture",
    reason: approved
      ? "Approved owned-environment fixture detected."
      : "Owned-environment lane requires an approved vendor test fixture.",
    auditMetadata: {
      approvedFixture: approved
    }
  };
};
