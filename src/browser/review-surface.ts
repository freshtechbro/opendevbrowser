import type { BrowserManagerLike, BrowserReviewResult } from "./manager-types";

export async function buildBrowserReviewResult(args: {
  manager: Pick<BrowserManagerLike, "status" | "snapshot" | "dialog">;
  sessionId: string;
  targetId?: string | null;
  maxChars: number;
  cursor?: string;
}): Promise<BrowserReviewResult> {
  const status = await args.manager.status(args.sessionId);
  const reviewTargetId = args.targetId ?? status.activeTargetId;
  const snapshot = await args.manager.snapshot(
    args.sessionId,
    "actionables",
    args.maxChars,
    args.cursor,
    reviewTargetId
  );
  const dialog = reviewTargetId
    ? (await args.manager.dialog(args.sessionId, {
      targetId: reviewTargetId,
      action: "status"
    })).dialog
    : undefined;
  const meta = status.meta
    ? (dialog ? { ...status.meta, dialog } : status.meta)
    : (dialog ? { blockerState: "clear" as const, dialog } : undefined);
  return {
    sessionId: args.sessionId,
    targetId: reviewTargetId,
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
    ...(meta ? { meta } : {})
  };
}
