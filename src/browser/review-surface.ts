import type { BrowserManagerLike, BrowserReviewResult } from "./manager-types";

export async function buildBrowserReviewResult(args: {
  manager: Pick<BrowserManagerLike, "status" | "snapshot">;
  sessionId: string;
  targetId?: string | null;
  maxChars: number;
  cursor?: string;
}): Promise<BrowserReviewResult> {
  const status = await args.manager.status(args.sessionId);
  const snapshot = await args.manager.snapshot(
    args.sessionId,
    "actionables",
    args.maxChars,
    args.cursor,
    args.targetId
  );
  return {
    sessionId: args.sessionId,
    targetId: args.targetId ?? status.activeTargetId,
    mode: status.mode,
    snapshotId: snapshot.snapshotId,
    url: snapshot.url ?? status.url,
    title: snapshot.title ?? status.title,
    content: snapshot.content,
    truncated: snapshot.truncated,
    ...(snapshot.nextCursor ? { nextCursor: snapshot.nextCursor } : {}),
    refCount: snapshot.refCount,
    timingMs: snapshot.timingMs,
    ...(snapshot.warnings?.length ? { warnings: snapshot.warnings } : {}),
    ...(status.meta ? { meta: status.meta } : {})
  };
}
