import type { ProviderAntiBotSnapshot } from "../providers/registry";
import type { BrowserFallbackDisposition, JsonValue } from "../providers/types";
import type { ChallengeActionable, ChallengeContinuitySignals, ChallengeDiagnosticsSummary, ChallengeEvidenceBundle } from "./types";

type ChallengeStatusInput = {
  mode: string;
  activeTargetId: string | null;
  url?: string;
  title?: string;
  meta?: {
    blocker?: ChallengeEvidenceBundle["blocker"];
    blockerState: ChallengeEvidenceBundle["blockerState"];
    blockerResolution?: ChallengeEvidenceBundle["blockerResolution"];
    challenge?: ChallengeEvidenceBundle["challenge"];
  };
};

type ChallengeDebugTraceInput = {
  requestId?: string;
  channels?: {
    console?: { events?: unknown[] };
    network?: { events?: Array<{ url?: string }> };
    exception?: { events?: unknown[] };
  };
};

export type ChallengeEvidenceInput = {
  status: ChallengeStatusInput;
  snapshot?: {
    content?: string;
    warnings?: string[];
  };
  debugTrace?: ChallengeDebugTraceInput;
  cookieCount?: number;
  canImportCookies?: boolean;
  fallbackDisposition?: BrowserFallbackDisposition;
  registryPressure?: ProviderAntiBotSnapshot;
  taskData?: Record<string, JsonValue>;
};

const ACTIONABLE_RE =
  /^\[(r\d+)\]\s+([^\s]+)(?:\s+(disabled))?(?:\s+(checked))?(?:\s+"([^"]+)")?(?:\s+value="([^"]*)")?/i;

const LOGIN_RE = /\b(log ?in|sign ?in|sign in|continue with)\b/i;
const SESSION_REUSE_RE = /\b(use existing|existing session|choose account|switch account|stay signed in|remember me)\b/i;
const HUMAN_VERIFICATION_RE = /\b(captcha|verify (?:that )?you(?:'re| are) human|security check|prove you are human|turnstile|recaptcha|hcaptcha)\b/i;
const NON_SECRET_FIELD_RE = /\b(email|e-mail|username|first name|last name|full name|company|phone|city|state|country|linkedin|portfolio|resume|cv)\b/i;
const CHECKPOINT_RE = /\b(next|continue|resume|verify|submit|approve|allow)\b/i;
const LOGIN_PAGE_RE = /\/(login|signin|sign-in|auth|session)(?:[/?#]|$)/i;

const sanitize = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const parseActionables = (content: string | undefined): ChallengeActionable[] => {
  if (!content) return [];
  const actionables: ChallengeActionable[] = [];
  for (const line of content.split("\n")) {
    const match = line.match(ACTIONABLE_RE);
    if (!match) continue;
    actionables.push({
      ref: match[1]!,
      role: match[2]!,
      name: sanitize(match[5]),
      value: sanitize(match[6]),
      disabled: Boolean(match[3]),
      checked: Boolean(match[4])
    });
  }
  return actionables;
};

const collectRefs = (actionables: ChallengeActionable[], matcher: RegExp): string[] => {
  return actionables
    .filter((entry) => {
      const haystack = `${entry.role} ${entry.name ?? ""} ${entry.value ?? ""}`.trim();
      return matcher.test(haystack);
    })
    .map((entry) => entry.ref);
};

const buildContinuitySignals = (
  input: ChallengeEvidenceInput,
  actionables: ChallengeActionable[]
): ChallengeContinuitySignals => {
  const challenge = input.status.meta?.challenge;
  const url = input.status.url ?? "";
  const loginRefs = collectRefs(actionables, LOGIN_RE);
  const sessionReuseRefs = collectRefs(actionables, SESSION_REUSE_RE);
  const humanVerificationRefs = collectRefs(actionables, HUMAN_VERIFICATION_RE);
  const nonSecretFieldRefs = collectRefs(actionables, NON_SECRET_FIELD_RE);
  const checkpointRefs = collectRefs(actionables, CHECKPOINT_RE);
  const hasTaskData = Boolean(input.taskData && Object.keys(input.taskData).length > 0);
  const cookieCount = input.cookieCount ?? 0;

  return {
    hasPreservedSession: typeof challenge?.preservedSessionId === "string" && challenge.preservedSessionId.length > 0,
    hasPreservedTarget: typeof challenge?.preservedTargetId === "string" && challenge.preservedTargetId.length > 0,
    hasSuspendedIntent: Boolean(challenge?.suspendedIntent),
    attachedSession: typeof challenge?.ownerSurface === "string",
    cookieCount,
    canReuseExistingCookies: cookieCount > 0,
    canImportCookies: Boolean(input.canImportCookies),
    hasNonSecretTaskData: hasTaskData,
    likelyLoginPage: LOGIN_PAGE_RE.test(url) || loginRefs.length > 0,
    likelySessionPicker: sessionReuseRefs.length > 0,
    likelyHumanVerification: humanVerificationRefs.length > 0,
    loginRefs,
    sessionReuseRefs,
    humanVerificationRefs,
    nonSecretFieldRefs,
    checkpointRefs
  };
};

const buildDiagnostics = (input: ChallengeEvidenceInput): ChallengeDiagnosticsSummary => {
  const networkEvents = input.debugTrace?.channels?.network?.events ?? [];
  const networkHosts = [...new Set(networkEvents
    .map((event) => {
      try {
        return event.url ? new URL(event.url).hostname.toLowerCase() : null;
      } catch {
        return null;
      }
    })
    .filter((value): value is string => Boolean(value)))];

  return {
    traceRequestId: sanitize(input.debugTrace?.requestId),
    consoleCount: input.debugTrace?.channels?.console?.events?.length ?? 0,
    exceptionCount: input.debugTrace?.channels?.exception?.events?.length ?? 0,
    networkCount: networkEvents.length,
    networkHosts,
    warnings: input.snapshot?.warnings ?? [],
    screenshotCaptured: false
  };
};

export const buildChallengeEvidenceBundle = (input: ChallengeEvidenceInput): ChallengeEvidenceBundle => {
  const actionables = parseActionables(input.snapshot?.content);
  const diagnostics = buildDiagnostics(input);
  const continuity = buildContinuitySignals(input, actionables);
  const blockerState = input.status.meta?.blockerState ?? "clear";
  const challenge = input.status.meta?.challenge;

  return {
    challengeId: challenge?.challengeId,
    blocker: input.status.meta?.blocker,
    blockerState,
    blockerResolution: input.status.meta?.blockerResolution,
    challenge,
    url: sanitize(input.status.url),
    title: sanitize(input.status.title),
    activeTargetId: input.status.activeTargetId,
    mode: sanitize(input.status.mode),
    fallbackDisposition: input.fallbackDisposition,
    ownerSurface: challenge?.ownerSurface,
    preservedSessionId: challenge?.preservedSessionId,
    preservedTargetId: challenge?.preservedTargetId,
    suspendedIntent: challenge?.suspendedIntent,
    registryPressure: input.registryPressure,
    taskData: input.taskData,
    actionables,
    snapshotText: input.snapshot?.content,
    diagnostics,
    continuity
  };
};
