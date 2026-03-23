import type { ChallengeRuntimeHandle } from "../browser/manager-types";
import { buildChallengeEvidenceBundle } from "./evidence-bundle";
import { interpretChallengeEvidence } from "./interpreter";
import type { ChallengeEvidenceBundle, VerificationResult } from "./types";

const hasProgress = (previous: ChallengeEvidenceBundle, next: ChallengeEvidenceBundle): boolean => {
  return previous.blockerState !== next.blockerState
    || previous.blocker?.type !== next.blocker?.type
    || previous.url !== next.url
    || previous.title !== next.title
    || previous.continuity.cookieCount !== next.continuity.cookieCount
    || previous.continuity.loginRefs.join(",") !== next.continuity.loginRefs.join(",")
    || previous.continuity.sessionReuseRefs.join(",") !== next.continuity.sessionReuseRefs.join(",")
    || previous.continuity.humanVerificationRefs.join(",") !== next.continuity.humanVerificationRefs.join(",");
};

export const verifyChallengeProgress = async (args: {
  handle: ChallengeRuntimeHandle;
  sessionId: string;
  targetId?: string | null;
  previous: ChallengeEvidenceBundle;
  canImportCookies: boolean;
  fallbackDisposition?: ChallengeEvidenceBundle["fallbackDisposition"];
  registryPressure?: ChallengeEvidenceBundle["registryPressure"];
  taskData?: ChallengeEvidenceBundle["taskData"];
  snapshotChars?: number;
  traceMax?: number;
}): Promise<VerificationResult> => {
  const status = await args.handle.status(args.sessionId);
  const snapshot = await args.handle.snapshot(
    args.sessionId,
    "actionables",
    args.snapshotChars ?? 2400,
    undefined,
    args.targetId
  );
  const debugTrace = await args.handle.debugTraceSnapshot(args.sessionId, {
    max: args.traceMax ?? 50
  });
  const cookieList = status.url
    ? await args.handle.cookieList(args.sessionId, [status.url])
    : { count: 0 };
  const bundle = buildChallengeEvidenceBundle({
    status,
    snapshot: {
      content: snapshot.content,
      warnings: snapshot.warnings
    },
    debugTrace,
    cookieCount: cookieList.count,
    canImportCookies: args.canImportCookies,
    fallbackDisposition: args.fallbackDisposition,
    registryPressure: args.registryPressure,
    taskData: args.taskData
  });
  const interpretation = interpretChallengeEvidence(bundle);
  const changed = hasProgress(args.previous, bundle);

  if (bundle.blockerState === "clear" || bundle.blockerResolution?.status === "resolved") {
    return {
      status: "clear",
      blockerState: bundle.blockerState,
      blocker: bundle.blocker,
      challenge: bundle.challenge,
      bundle,
      changed: true,
      reason: "Manager verification cleared the blocker.",
      url: bundle.url,
      title: bundle.title
    };
  }

  if (bundle.blockerResolution?.status === "deferred") {
    return {
      status: "deferred",
      blockerState: bundle.blockerState,
      blocker: bundle.blocker,
      challenge: bundle.challenge,
      bundle,
      changed,
      reason: "Manager verification deferred blocker resolution.",
      url: bundle.url,
      title: bundle.title
    };
  }

  if (interpretation.humanBoundary !== "none" && interpretation.humanBoundary !== "policy_blocked") {
    return {
      status: "yield_required",
      blockerState: bundle.blockerState,
      blocker: bundle.blocker,
      challenge: bundle.challenge,
      bundle,
      changed,
      reason: `Human authority boundary detected: ${interpretation.humanBoundary}.`,
      url: bundle.url,
      title: bundle.title
    };
  }

  return {
    status: changed ? "progress" : "still_blocked",
    blockerState: bundle.blockerState,
    blocker: bundle.blocker,
    challenge: bundle.challenge,
    bundle,
    changed,
    reason: changed
      ? "Verification observed a meaningful state change, but the blocker is still active."
      : "Verification observed no meaningful progress.",
    url: bundle.url,
    title: bundle.title
  };
};
