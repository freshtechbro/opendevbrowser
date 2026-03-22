import { randomUUID } from "crypto";
import type {
  ChallengeOwnerSurface,
  ChallengeTimelineEntry,
  ResumeMode,
  SessionChallengeStatus,
  SessionChallengeSummary,
  SuspendedIntentSummary
} from "../providers/types";

type ChallengeRecord = {
  summary: SessionChallengeSummary;
  timeline: ChallengeTimelineEntry[];
};

type ClaimArgs = {
  sessionId: string;
  blockerType: SessionChallengeSummary["blockerType"];
  reasonCode?: SessionChallengeSummary["reasonCode"];
  ownerSurface: ChallengeOwnerSurface;
  ownerLeaseId?: string;
  resumeMode: ResumeMode;
  suspendedIntent?: SuspendedIntentSummary;
  preservedSessionId?: string;
  preservedTargetId?: string;
  now?: Date;
};

const PRESERVE_WINDOW_MS = 15 * 60 * 1000;
const VERIFY_WINDOW_MS = 5 * 60 * 1000;

const toIso = (value: Date): string => value.toISOString();

const eventForStatus = (status: SessionChallengeStatus): ChallengeTimelineEntry["event"] => {
  switch (status) {
    case "resolved":
      return "resolved";
    case "deferred":
      return "deferred";
    case "expired":
      return "expired";
    default:
      return "claimed";
  }
};

export class GlobalChallengeCoordinator {
  private readonly bySessionId = new Map<string, ChallengeRecord>();
  private readonly timelinesByChallengeId = new Map<string, ChallengeTimelineEntry[]>();

  claimOrRefresh(args: ClaimArgs): SessionChallengeSummary {
    const now = args.now ?? new Date();
    const existing = this.bySessionId.get(args.sessionId);
    const challengeId = existing?.summary.challengeId ?? randomUUID();
    const previousTimeline = existing?.timeline ?? [];
    const nextEntry: ChallengeTimelineEntry = {
      at: toIso(now),
      event: existing ? "refreshed" : "claimed",
      status: "active"
    };
    const nextTimeline: ChallengeTimelineEntry[] = [...previousTimeline, nextEntry];
    const summary: SessionChallengeSummary = {
      challengeId,
      blockerType: args.blockerType,
      ...(args.reasonCode ? { reasonCode: args.reasonCode } : {}),
      ownerSurface: args.ownerSurface,
      ...(args.ownerLeaseId ? { ownerLeaseId: args.ownerLeaseId } : {}),
      resumeMode: args.resumeMode,
      ...(args.suspendedIntent ? { suspendedIntent: args.suspendedIntent } : {}),
      ...(args.preservedSessionId ? { preservedSessionId: args.preservedSessionId } : {}),
      ...(args.preservedTargetId ? { preservedTargetId: args.preservedTargetId } : {}),
      status: "active",
      preserveUntil: toIso(new Date(now.getTime() + PRESERVE_WINDOW_MS)),
      verifyUntil: toIso(new Date(now.getTime() + VERIFY_WINDOW_MS)),
      updatedAt: toIso(now),
      timeline: nextTimeline
    };
    const record: ChallengeRecord = {
      summary,
      timeline: nextTimeline
    };
    this.bySessionId.set(args.sessionId, record);
    this.timelinesByChallengeId.set(challengeId, nextTimeline);
    return summary;
  }

  resolve(sessionId: string, now = new Date()): SessionChallengeSummary | undefined {
    return this.transition(sessionId, "resolved", now);
  }

  defer(sessionId: string, now = new Date()): SessionChallengeSummary | undefined {
    return this.transition(sessionId, "deferred", now);
  }

  expire(sessionId: string, now = new Date()): SessionChallengeSummary | undefined {
    return this.transition(sessionId, "expired", now);
  }

  release(sessionId: string, now = new Date()): SessionChallengeSummary | undefined {
    const existing = this.bySessionId.get(sessionId);
    if (!existing) return undefined;
    const releaseEntry: ChallengeTimelineEntry = {
      at: toIso(now),
      event: "released",
      status: existing.summary.status
    };
    const timeline: ChallengeTimelineEntry[] = [...existing.timeline, releaseEntry];
    this.timelinesByChallengeId.set(existing.summary.challengeId, timeline);
    this.bySessionId.delete(sessionId);
    return {
      ...existing.summary,
      updatedAt: toIso(now),
      timeline
    };
  }

  getSummary(sessionId: string): SessionChallengeSummary | undefined {
    const record = this.bySessionId.get(sessionId);
    return record ? { ...record.summary, timeline: [...record.timeline] } : undefined;
  }

  getTimeline(challengeId: string): ChallengeTimelineEntry[] {
    return [...(this.timelinesByChallengeId.get(challengeId) ?? [])];
  }

  private transition(
    sessionId: string,
    status: Extract<SessionChallengeStatus, "resolved" | "deferred" | "expired">,
    now: Date
  ): SessionChallengeSummary | undefined {
    const existing = this.bySessionId.get(sessionId);
    if (!existing) return undefined;
    const transitionEntry: ChallengeTimelineEntry = {
      at: toIso(now),
      event: eventForStatus(status),
      status
    };
    const timeline: ChallengeTimelineEntry[] = [...existing.timeline, transitionEntry];
    const summary: SessionChallengeSummary = {
      ...existing.summary,
      status,
      updatedAt: toIso(now),
      timeline
    };
    const record: ChallengeRecord = {
      summary,
      timeline
    };
    this.bySessionId.set(sessionId, record);
    this.timelinesByChallengeId.set(summary.challengeId, timeline);
    return summary;
  }
}
