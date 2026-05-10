import type { ProviderAntiBotSnapshot } from "../providers/registry";
import type { BrowserFallbackDisposition, JsonValue } from "../providers/types";
import type {
  ChallengeActionable,
  ChallengeContinuitySignals,
  ChallengeDiagnosticsSummary,
  ChallengeEvidenceBundle,
  ChallengeInteractionSignals,
  ChallengeInteractionSurface
} from "./types";

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
    snapshotId?: string;
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
const ACCOUNT_CHOOSER_RE = /\b(?:choose an account|choose account|pick an account|select an account|continue as)\b/i;
const ALT_ACCOUNT_RE = /\b(?:use another account|use a different account|add account|add another account|sign in with another account)\b/i;
const HUMAN_VERIFICATION_RE = /\b(captcha|verify (?:that )?you(?:'re| are) human|security check|prove you are human|turnstile|recaptcha|hcaptcha)\b/i;
const NON_SECRET_FIELD_RE = /\b(email|e-mail|username|first name|last name|full name|company|phone|city|state|country|linkedin|portfolio|resume|cv)\b/i;
const CHECKPOINT_RE = /\b(next|continue|resume|verify|submit|approve|allow)\b/i;
const LOGIN_PAGE_RE = /\/(login|signin|sign-in|auth|session)(?:[/?#]|$)/i;
const GOOGLE_AUTH_RE = /\b(?:continue with google|sign in with google|log in with google|google sign(?: |-)?in)\b/i;
const GITHUB_AUTH_RE = /\b(?:continue with github|sign in with github|log in with github|github sign(?: |-)?in)\b/i;
const APPLE_AUTH_RE = /\b(?:continue with apple|sign in with apple|log in with apple|apple sign(?: |-)?in)\b/i;
const ACCOUNT_CHOOSER_NOISE_RE = /\b(?:help|privacy|terms|learn more|english|afrikaans|espa[ñn]ol)\b/i;
const CLICK_ACTION_RE = /\b(click|tap|select|choose|continue|allow|dismiss|close|not now|got it|delivery|pickup|ship(?:ping)? here)\b/i;
const HOLD_ACTION_RE = /\b(?:click|press|tap|activate)\s+(?:and\s+)?hold\b|\bhold (?:the )?(?:button|slider)\b/i;
const DRAG_ACTION_RE = /\b(?:drag|slide|move)(?:\s+the)?\s+(?:slider|puzzle(?:\s+piece)?|piece|button)\b/i;
const POPUP_SURFACE_RE = /\b(?:popup|pop up|modal|dialog|choose where (?:you(?:'|’)d|you would|to) like to shop|how do you want your items|set your location|confirm your location|choose a store)\b/i;
const INTERSTITIAL_SURFACE_RE = /\b(?:interstitial|security check|verify (?:that )?you(?:'re| are) human|checking your browser|captcha|challenge|press and hold|click and hold|drag the slider|slide to verify)\b/i;
const CLICKABLE_ROLE_RE = /^(?:button|link|menuitem|option|tab|radio|checkbox)$/i;
const DIALOG_ROLE_RE = /^(?:dialog|alertdialog)$/i;
const HOLD_DURATION_RE = /\b(\d+)\s*(second|sec|seconds|minute|min|minutes)\b/i;
const DEFAULT_HOLD_MS = 1500;
const MAX_HOLD_MS = 60_000;

const sanitize = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const dedupe = (values: string[]): string[] => {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
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

const collectInteractiveRefs = (actionables: ChallengeActionable[], matcher: RegExp): string[] => {
  return actionables
    .filter((entry) => {
      if (entry.disabled || !CLICKABLE_ROLE_RE.test(entry.role)) {
        return false;
      }
      const haystack = `${entry.role} ${entry.name ?? ""} ${entry.value ?? ""}`.trim();
      return matcher.test(haystack);
    })
    .map((entry) => entry.ref);
};

const resolveActionableLabel = (entry: ChallengeActionable): string =>
  `${entry.name ?? ""} ${entry.value ?? ""}`.trim();

const collectPreferredAuthRefs = (actionables: ChallengeActionable[]): string[] => {
  const collect = (matcher: RegExp): string[] => actionables
    .filter((entry) => {
      if (entry.disabled || !CLICKABLE_ROLE_RE.test(entry.role)) {
        return false;
      }
      return matcher.test(resolveActionableLabel(entry));
    })
    .map((entry) => entry.ref);

  return dedupe([
    ...collect(GOOGLE_AUTH_RE),
    ...collect(GITHUB_AUTH_RE),
    ...collect(APPLE_AUTH_RE),
    ...collectRefs(actionables, LOGIN_RE)
  ]);
};

const collectChooserRefs = (actionables: ChallengeActionable[], chooserSurface: boolean): {
  recentAccountRefs: string[];
  alternateAccountRefs: string[];
} => {
  if (!chooserSurface) {
    return {
      recentAccountRefs: [],
      alternateAccountRefs: []
    };
  }

  const interactiveActionables = actionables.filter((entry) => !entry.disabled && CLICKABLE_ROLE_RE.test(entry.role));
  const alternateAccountRefs = interactiveActionables
    .filter((entry) => ALT_ACCOUNT_RE.test(resolveActionableLabel(entry)))
    .map((entry) => entry.ref);
  const firstAlternateIndex = alternateAccountRefs.length > 0
    ? interactiveActionables.findIndex((entry) => entry.ref === alternateAccountRefs[0])
    : interactiveActionables.length;
  const recentAccountRefs = interactiveActionables
    .filter((entry, index) => {
      if (index >= firstAlternateIndex) {
        return false;
      }
      const label = resolveActionableLabel(entry);
      return label.length > 0
        && !ACCOUNT_CHOOSER_NOISE_RE.test(label)
        && !LOGIN_RE.test(label)
        && !CHECKPOINT_RE.test(label)
        && !HUMAN_VERIFICATION_RE.test(label);
    })
    .map((entry) => entry.ref);

  return {
    recentAccountRefs,
    alternateAccountRefs
  };
};

const parseHoldDurationMs = (value: string): number | undefined => {
  const match = value.match(HOLD_DURATION_RE);
  if (!match?.[1] || !match[2]) {
    return undefined;
  }
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) {
    return undefined;
  }
  const unit = match[2].toLowerCase();
  const multiplier = unit.startsWith("min") ? 60_000 : 1000;
  return Math.min(MAX_HOLD_MS, Math.max(1000, Math.floor(amount * multiplier)));
};

const buildContinuitySignals = (
  input: ChallengeEvidenceInput,
  actionables: ChallengeActionable[]
): ChallengeContinuitySignals => {
  const challenge = input.status.meta?.challenge;
  const url = input.status.url ?? "";
  const chooserSurface = ACCOUNT_CHOOSER_RE.test([
    input.status.title,
    input.snapshot?.content,
    url
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" "));
  const { recentAccountRefs, alternateAccountRefs } = collectChooserRefs(actionables, chooserSurface);
  const loginRefs = dedupe([
    ...collectPreferredAuthRefs(actionables),
    ...alternateAccountRefs
  ]);
  const sessionReuseRefs = dedupe([
    ...recentAccountRefs,
    ...collectRefs(actionables, SESSION_REUSE_RE).filter((ref) => !alternateAccountRefs.includes(ref))
  ]);
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
    likelySessionPicker: chooserSurface || sessionReuseRefs.length > 0,
    likelyHumanVerification: humanVerificationRefs.length > 0,
    loginRefs,
    sessionReuseRefs,
    humanVerificationRefs,
    nonSecretFieldRefs,
    checkpointRefs
  };
};

const resolveInteractionSurface = (args: {
  actionables: ChallengeActionable[];
  combinedText: string;
  warnings: string[];
}): ChallengeInteractionSurface => {
  if (args.actionables.some((entry) => DIALOG_ROLE_RE.test(entry.role)) || POPUP_SURFACE_RE.test(args.combinedText)) {
    return "popup";
  }
  if (INTERSTITIAL_SURFACE_RE.test(args.combinedText) || args.warnings.some((warning) => INTERSTITIAL_SURFACE_RE.test(warning))) {
    return "interstitial";
  }
  if (args.combinedText.trim().length > 0 || args.actionables.length > 0) {
    return "page";
  }
  return "unknown";
};

const buildInteractionSignals = (
  input: ChallengeEvidenceInput,
  actionables: ChallengeActionable[],
  continuity: ChallengeContinuitySignals
): ChallengeInteractionSignals => {
  const warnings = input.snapshot?.warnings ?? [];
  const combinedText = [
    input.status.title,
    input.snapshot?.content,
    ...warnings
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ");
  const surface = resolveInteractionSurface({ actionables, combinedText, warnings });
  const holdRefs = dedupe(collectInteractiveRefs(actionables, HOLD_ACTION_RE));
  const dragRefs = dedupe(collectInteractiveRefs(actionables, DRAG_ACTION_RE));
  const clickRefs = dedupe([
    ...collectInteractiveRefs(actionables, CLICK_ACTION_RE),
    ...continuity.checkpointRefs,
    ...(surface === "popup"
      ? actionables
        .filter((entry) => !entry.disabled && CLICKABLE_ROLE_RE.test(entry.role))
        .slice(0, 4)
        .map((entry) => entry.ref)
      : [])
  ]);

  const evidencePhrases = dedupe([
    ...(surface === "popup" ? ["popup_surface"] : []),
    ...(surface === "interstitial" ? ["interstitial_surface"] : []),
    ...(HOLD_ACTION_RE.test(combinedText) ? ["click_and_hold_prompt"] : []),
    ...(DRAG_ACTION_RE.test(combinedText) ? ["drag_prompt"] : [])
  ]);
  const holdMs = HOLD_ACTION_RE.test(combinedText)
    ? parseHoldDurationMs(combinedText) ?? DEFAULT_HOLD_MS
    : undefined;

  const preferredAction = holdRefs.length > 0 || HOLD_ACTION_RE.test(combinedText)
    ? "click_and_hold"
    : dragRefs.length > 0 || DRAG_ACTION_RE.test(combinedText)
      ? "drag"
      : clickRefs.length > 0 || surface === "popup"
        ? "click"
        : "unknown";

  return {
    surface,
    preferredAction,
    clickRefs,
    holdRefs,
    dragRefs,
    evidencePhrases,
    ...(typeof holdMs === "number" ? { holdMs } : {})
  };
};

const buildDiagnostics = (input: ChallengeEvidenceInput): ChallengeDiagnosticsSummary => {
  const networkEvents = input.debugTrace?.channels?.network?.events ?? [];
  const warnings = input.snapshot?.warnings ?? [];
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
    warnings,
    screenshotCaptured: false
  };
};

export const buildChallengeEvidenceBundle = (input: ChallengeEvidenceInput): ChallengeEvidenceBundle => {
  const actionables = parseActionables(input.snapshot?.content);
  const diagnostics = buildDiagnostics(input);
  const continuity = buildContinuitySignals(input, actionables);
  const interaction = buildInteractionSignals(input, actionables, continuity);
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
    snapshotId: input.snapshot?.snapshotId,
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
    continuity,
    interaction
  };
};
