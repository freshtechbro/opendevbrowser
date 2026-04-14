import { classifyBlockerSignal } from "./blocker";
import { isProviderReasonCode } from "./errors";
import type {
  BlockerSignalV1,
  BlockerType,
  JsonValue,
  NormalizedRecord,
  ProviderConstraint,
  ProviderConstraintKind,
  ProviderReasonCode
} from "./types";

export interface ProviderIssueHint {
  reasonCode: ProviderReasonCode;
  blockerType?: BlockerType;
  constraint?: ProviderConstraint;
}

export interface ProviderNextStepGuidance {
  [key: string]: JsonValue;
  reason: string;
  recommendedNextCommands: string[];
}

export interface ProviderIssueSummary extends ProviderIssueHint {
  provider?: string;
  summary: string;
  guidance?: ProviderNextStepGuidance;
}

const BLOCKER_TYPES = new Set<BlockerType>([
  "auth_required",
  "anti_bot_challenge",
  "rate_limited",
  "upstream_block",
  "restricted_target",
  "env_limited",
  "unknown"
]);

const CONSTRAINT_KINDS = new Set<ProviderConstraintKind>([
  "session_required",
  "render_required"
]);

const RENDER_REQUIRED_SHELLS = new Set<string>([
  "bestbuy_international_gate",
  "duckduckgo_non_js_redirect",
  "macys_access_denied_shell",
  "social_first_party_help_shell",
  "social_js_required_shell",
  "social_render_shell",
  "target_shell_page",
  "temu_empty_shell"
]);

const CHALLENGE_SHELLS = new Set<string>(["social_verification_wall", "temu_challenge_shell"]);

const toNonEmptyString = (value: unknown): string | undefined => {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
};

const normalizeBlockerType = (value: unknown): BlockerType | undefined => {
  return typeof value === "string" && BLOCKER_TYPES.has(value as BlockerType)
    ? value as BlockerType
    : undefined;
};

const buildConstraint = (
  kind: ProviderConstraintKind,
  evidenceCode: string,
  providerShell?: string,
  message?: string
): ProviderConstraint => ({
  kind,
  evidenceCode,
  ...(providerShell ? { providerShell } : {}),
  ...(message ? { message } : {})
});

export const isProviderConstraint = (value: unknown): value is ProviderConstraint => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return CONSTRAINT_KINDS.has(candidate.kind as ProviderConstraintKind)
    && typeof candidate.evidenceCode === "string"
    && candidate.evidenceCode.trim().length > 0
    && (candidate.providerShell === undefined || typeof candidate.providerShell === "string")
    && (candidate.message === undefined || typeof candidate.message === "string");
};

export const classifyProviderIssue = (input: {
  url?: string;
  title?: string;
  message?: string;
  providerShell?: string;
  browserRequired?: boolean;
  status?: number;
  providerErrorCode?: string;
  source?: BlockerSignalV1["source"];
  retryable?: boolean;
}): ProviderIssueHint | null => {
  const providerShell = toNonEmptyString(input.providerShell);
  const message = toNonEmptyString(input.message);

  if (providerShell && CHALLENGE_SHELLS.has(providerShell)) {
    return {
      reasonCode: "challenge_detected",
      blockerType: "anti_bot_challenge"
    };
  }

  if (providerShell && RENDER_REQUIRED_SHELLS.has(providerShell)) {
    return {
      reasonCode: "env_limited",
      blockerType: "env_limited",
      constraint: buildConstraint("render_required", providerShell, providerShell, message)
    };
  }

  const blocker = classifyBlockerSignal({
    source: input.source ?? "runtime_fetch",
    ...(input.url ? { url: input.url, finalUrl: input.url } : {}),
    ...(input.title ? { title: input.title } : {}),
    ...(message ? { message } : {}),
    ...(typeof input.status === "number" ? { status: input.status } : {}),
    ...(input.providerErrorCode ? { providerErrorCode: input.providerErrorCode } : {}),
    ...(typeof input.retryable === "boolean" ? { retryable: input.retryable } : {}),
    envLimited: input.browserRequired === true
  });

  if (blocker?.type === "auth_required") {
    return {
      /* c8 ignore next -- classifyBlockerSignal always supplies token_required for auth_required blockers */
      reasonCode: blocker.reasonCode ?? "token_required",
      blockerType: blocker.type,
      constraint: buildConstraint("session_required", providerShell ?? "auth_required", providerShell, message)
    };
  }

  if (blocker?.type === "anti_bot_challenge") {
    return {
      /* c8 ignore next -- classifyBlockerSignal always supplies challenge_detected for anti-bot blockers */
      reasonCode: blocker.reasonCode ?? "challenge_detected",
      blockerType: blocker.type
    };
  }

  if (input.browserRequired === true) {
    return {
      /* c8 ignore next -- browserRequired inputs always classify to a blocker payload in the shared classifier */
      reasonCode: blocker?.reasonCode ?? "env_limited",
      /* c8 ignore next -- browserRequired fallbacks only normalize unknown blocker types */
      blockerType: blocker?.type === "unknown" ? "env_limited" : blocker?.type,
      /* c8 ignore next -- providerShell or blocker type always survives before the defensive browser_required fallback */
      constraint: buildConstraint("render_required", providerShell ?? blocker?.type ?? "browser_required", providerShell, message)
    };
  }

  if (blocker?.type === "env_limited") {
    return {
      /* c8 ignore next -- classifyBlockerSignal always supplies env_limited for env_limited blockers */
      reasonCode: blocker.reasonCode ?? "env_limited",
      blockerType: blocker.type
    };
  }

  return null;
};

export const readProviderIssueHint = (args: {
  reasonCode?: unknown;
  blockerType?: unknown;
  code?: unknown;
  message?: unknown;
  details?: Record<string, unknown> | undefined;
}): ProviderIssueHint | null => {
  const details = args.details;
  const reasonCode = isProviderReasonCode(args.reasonCode)
    ? args.reasonCode
    : (isProviderReasonCode(details?.reasonCode) ? details.reasonCode : undefined);
  const blockerType = normalizeBlockerType(args.blockerType ?? details?.blockerType);
  const constraint = isProviderConstraint(details?.constraint)
    ? details.constraint
    : undefined;

  if (reasonCode || blockerType || constraint) {
    return {
      reasonCode: reasonCode
        ?? (constraint?.kind === "session_required" ? "token_required" : "env_limited"),
      ...(blockerType ? { blockerType } : {}),
      ...(constraint ? { constraint } : {})
    };
  }

  return classifyProviderIssue({
    url: toNonEmptyString(details?.url),
    title: toNonEmptyString(details?.title),
    message: toNonEmptyString(details?.message ?? args.message),
    providerShell: toNonEmptyString(details?.providerShell),
    browserRequired: details?.browserRequired === true,
    providerErrorCode: toNonEmptyString(args.code),
    source: "runtime_fetch"
  });
};

export const readProviderIssueHintFromRecord = (
  record: Pick<NormalizedRecord, "url" | "title" | "content" | "attributes">
): ProviderIssueHint | null => {
  const details = record.attributes as Record<string, unknown>;
  return readProviderIssueHint({
    reasonCode: details.reasonCode,
    blockerType: details.blockerType,
    message: record.content,
    details: {
      url: record.url,
      title: record.title,
      message: record.content,
      providerShell: details.providerShell,
      browserRequired: details.browserRequired,
      constraint: details.constraint
    }
  });
};

export const applyProviderIssueHint = (
  details: Record<string, JsonValue> | undefined,
  hint: ProviderIssueHint | null
): Record<string, JsonValue> | undefined => {
  if (!hint) return details;
  const next: Record<string, JsonValue> = {
    ...(details ?? {}),
    reasonCode: hint.reasonCode
  };
  if (hint.blockerType && typeof next.blockerType !== "string") {
    next.blockerType = hint.blockerType;
  }
  if (hint.constraint && !isProviderConstraint(next.constraint)) {
    next.constraint = hint.constraint;
  }
  if (typeof next.guidance === "undefined") {
    const guidance = buildProviderIssueGuidance({ hint, details: next });
    if (guidance) {
      next.guidance = guidance;
    }
  }
  return next;
};

const providerLabel = (provider: string | undefined): string => {
  const normalized = toNonEmptyString(provider);
  if (!normalized) return "Provider";
  const separator = normalized.lastIndexOf("/");
  const tail = separator >= 0 ? normalized.slice(separator + 1) : normalized;
  return tail.charAt(0).toUpperCase() + tail.slice(1);
};

const hasPreservedBrowserState = (details: Record<string, JsonValue> | undefined): boolean => {
  return typeof details?.preservedSessionId === "string" || typeof details?.preservedTargetId === "string";
};

const buildGuidance = (
  reason: string,
  recommendedNextCommands: string[]
): ProviderNextStepGuidance => ({
  reason,
  recommendedNextCommands
});

const buildAuthGuidance = (
  subject: string,
  preservedBrowserState: boolean
): ProviderNextStepGuidance => {
  return preservedBrowserState
    ? buildGuidance(
      `${subject} preserved browser state that can finish authentication.`,
      [
        "Complete the login or account checkpoint in the preserved browser session.",
        "Rerun the same provider or workflow after the session is fully authenticated."
      ]
    )
    : buildGuidance(
      `${subject} needs an authenticated session before retrying.`,
      [
        "Reuse an authenticated browser session, import logged-in cookies, or use the provider sign-in flow.",
        "Rerun the same provider or workflow once the session is active."
      ]
    );
};

const buildChallengeGuidance = (
  subject: string,
  preservedBrowserState: boolean
): ProviderNextStepGuidance => {
  return preservedBrowserState
    ? buildGuidance(
      `${subject} preserved browser state that can complete the current challenge.`,
      [
        "Finish the login or anti-bot challenge in the preserved browser session.",
        "Rerun the same provider or workflow after the page unlocks."
      ]
    )
    : buildGuidance(
      `${subject} hit a challenge that still needs browser-assisted follow-up.`,
      [
        "Retry with browser assistance so the challenge can be completed interactively.",
        "Only ask for manual credentials if browser-assisted recovery still cannot unlock the page."
      ]
    );
};

const buildRenderGuidance = (
  subject: string,
  preservedBrowserState: boolean
): ProviderNextStepGuidance => {
  return preservedBrowserState
    ? buildGuidance(
      `${subject} still needs a live browser-rendered page, but browser state is already preserved.`,
      [
        "Inspect the preserved browser session until usable content is visible.",
        "Rerun the same provider or workflow after the rendered page is ready."
      ]
    )
    : buildGuidance(
      `${subject} needs a live browser-rendered page before retrying.`,
      [
        "Retry with browser assistance or a headed browser session.",
        "Rerun the same provider or workflow after the rendered page is ready."
      ]
    );
};

export const buildProviderIssueGuidance = (args: {
  provider?: string;
  hint: ProviderIssueHint;
  details?: Record<string, JsonValue>;
}): ProviderNextStepGuidance | undefined => {
  const subject = providerLabel(args.provider);
  const preservedBrowserState = hasPreservedBrowserState(args.details);
  const disposition = toNonEmptyString(args.details?.disposition);
  if (disposition === "completed") return undefined;
  if (disposition === "challenge_preserved") {
    return buildChallengeGuidance(subject, true);
  }
  if (args.hint.reasonCode === "token_required" || args.hint.reasonCode === "auth_required") {
    return buildAuthGuidance(subject, preservedBrowserState);
  }
  if (args.hint.reasonCode === "challenge_detected") {
    return buildChallengeGuidance(subject, preservedBrowserState);
  }
  if (args.hint.constraint?.kind === "render_required" || args.hint.reasonCode === "env_limited") {
    return buildRenderGuidance(subject, preservedBrowserState);
  }
  return undefined;
};

const summaryPriority = (hint: ProviderIssueHint): number => {
  /* c8 ignore next -- providerLabel always passes a concrete tail string into this helper */
  if (hint.reasonCode === "token_required" || hint.reasonCode === "auth_required") return 3;
  if (hint.reasonCode === "challenge_detected") return 2;
  if (hint.constraint?.kind === "render_required") return 1;
  return 0;
};

export const summarizeProviderIssue = (args: {
  provider?: string;
  hint: ProviderIssueHint;
}): string => {
  const subject = providerLabel(args.provider);
  if (args.hint.reasonCode === "token_required" || args.hint.reasonCode === "auth_required") {
    return `${subject} requires login or an existing session.`;
  }
  if (args.hint.reasonCode === "challenge_detected") {
    return `${subject} hit an anti-bot challenge that requires manual completion.`;
  }
  if (args.hint.constraint?.kind === "render_required") {
    return `${subject} requires a live browser-rendered page.`;
  }
  return `${subject} requires manual browser follow-up; this run did not determine whether login or page rendering is required.`;
};

export const summarizePrimaryProviderIssue = (
  failures: Array<{ provider?: string; error?: { reasonCode?: unknown; code?: unknown; message?: unknown; details?: Record<string, unknown> } }> | undefined
): ProviderIssueSummary | null => {
  if (!Array.isArray(failures) || failures.length === 0) return null;
  let best: ProviderIssueSummary | null = null;

  for (const failure of failures) {
    const hint = readProviderIssueHint({
      reasonCode: failure.error?.reasonCode,
      code: failure.error?.code,
      message: failure.error?.message,
      details: failure.error?.details
    });
    if (!hint) continue;
    const summary = summarizeProviderIssue({ provider: failure.provider, hint });
    const guidance = buildProviderIssueGuidance({
      provider: failure.provider,
      hint,
      details: failure.error?.details as Record<string, JsonValue> | undefined
    });
    const candidate: ProviderIssueSummary = {
      provider: failure.provider,
      summary,
      ...hint,
      ...(guidance ? { guidance } : {})
    };
    if (!best || summaryPriority(candidate) > summaryPriority(best)) {
      best = candidate;
    }
  }

  return best;
};
