import type { ChallengeRuntimeHandle } from "../browser/manager-types";
import { buildChallengeEvidenceBundle } from "./evidence-bundle";
import type { ChallengeEvidenceBundle } from "./types";

type CaptureChallengeEvidenceArgs = {
  handle: ChallengeRuntimeHandle;
  sessionId: string;
  targetId?: string | null;
  canImportCookies: boolean;
  fallbackDisposition?: ChallengeEvidenceBundle["fallbackDisposition"];
  registryPressure?: ChallengeEvidenceBundle["registryPressure"];
  taskData?: ChallengeEvidenceBundle["taskData"];
};

export async function captureChallengeEvidence(
  args: CaptureChallengeEvidenceArgs
): Promise<ChallengeEvidenceBundle> {
  const status = await args.handle.status(args.sessionId);
  const effectiveTargetId = args.targetId ?? status.activeTargetId ?? null;
  const snapshot = await args.handle.snapshot(
    args.sessionId,
    "actionables",
    2400,
    undefined,
    effectiveTargetId
  );
  const debugTrace = await args.handle.debugTraceSnapshot(args.sessionId, { max: 50 });
  const cookies = status.url
    ? await args.handle.cookieList(args.sessionId, [status.url])
    : { count: 0 };

  return buildChallengeEvidenceBundle({
    status,
    snapshot: {
      snapshotId: snapshot.snapshotId,
      content: snapshot.content,
      warnings: snapshot.warnings
    },
    debugTrace,
    cookieCount: cookies.count,
    canImportCookies: args.canImportCookies,
    fallbackDisposition: args.fallbackDisposition,
    registryPressure: args.registryPressure,
    taskData: args.taskData
  });
}
