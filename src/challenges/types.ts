import type { ProviderAntiBotSnapshot } from "../providers/registry";
import type {
  BlockerSignalV1,
  BrowserFallbackDisposition,
  JsonValue,
  ProviderCookieImportRecord,
  ProviderReasonCode,
  SessionChallengeSummary
} from "../providers/types";

export type ChallengeClassification =
  | "auth_required"
  | "existing_session_reuse"
  | "human_verification_required"
  | "owned_environment_test_challenge"
  | "unsupported_third_party_challenge"
  | "checkpoint_or_friction";

export type ChallengeHumanBoundary =
  | "none"
  | "secret_entry"
  | "mfa"
  | "explicit_consent"
  | "policy_blocked"
  | "unsupported_third_party"
  | "exhausted_no_progress";

export const CHALLENGE_AUTOMATION_MODES = ["off", "browser", "browser_with_helper"] as const;
export type ChallengeAutomationMode = (typeof CHALLENGE_AUTOMATION_MODES)[number];
const CHALLENGE_AUTOMATION_MODE_SET = new Set<string>(CHALLENGE_AUTOMATION_MODES);

export function isChallengeAutomationMode(value: unknown): value is ChallengeAutomationMode {
  return typeof value === "string" && CHALLENGE_AUTOMATION_MODE_SET.has(value);
}

export type ChallengeAutomationModeSource = "run" | "session" | "config";

export type ChallengeAutomationStandDownReason =
  | "challenge_automation_off"
  | "helper_disabled_for_browser_mode"
  | "helper_disabled_by_policy"
  | "helper_blocked_by_human_boundary"
  | "helper_no_safe_actions"
  | "suppressed_by_manager";

export type ChallengeAutomationHelperEligibility = {
  allowed: boolean;
  reason: string;
  standDownReason?: ChallengeAutomationStandDownReason;
};

export type ResolvedChallengeAutomationPolicy = {
  mode: ChallengeAutomationMode;
  source: ChallengeAutomationModeSource;
  standDownReason?: ChallengeAutomationStandDownReason;
};

export type ChallengeVerificationLevel = "light" | "full";

export type ChallengeGovernedLaneKind =
  | "owned_environment_fixture"
  | "sanctioned_identity"
  | "service_adapter";

export type ChallengeStrategyLane =
  | "generic_browser_autonomy"
  | "human_yield"
  | "owned_environment_fixture"
  | "sanctioned_identity"
  | "service_adapter"
  | "optional_computer_use_bridge"
  | "defer";

export type ChallengeActionFamily =
  | "wait"
  | "auth_navigation"
  | "session_reuse"
  | "cookie_reuse"
  | "element_discovery"
  | "click_path"
  | "click_and_hold"
  | "non_secret_form_fill"
  | "dropdown"
  | "scroll"
  | "hover"
  | "press"
  | "pointer"
  | "drag"
  | "verification"
  | "debug_trace";

export type ChallengeStepKind =
  | "wait"
  | "goto"
  | "click"
  | "click_and_hold"
  | "hover"
  | "press"
  | "type"
  | "select"
  | "scroll"
  | "pointer"
  | "drag"
  | "cookie_list"
  | "cookie_import"
  | "snapshot"
  | "debug_trace";

export type ChallengeActionStatus =
  | "resolved"
  | "still_blocked"
  | "yield_required"
  | "deferred"
  | "no_progress"
  | "policy_blocked";

export type ChallengeRuntimeBlockerState = "clear" | "active" | "resolving";

export type ChallengeResolutionMeta = {
  status: "resolved" | "unresolved" | "deferred";
  reason: "verifier_passed" | "verification_timeout" | "verifier_failed" | "env_limited" | "manual_clear";
  updatedAt: string;
};

export type ChallengeActionable = {
  ref: string;
  role: string;
  name?: string;
  value?: string;
  disabled: boolean;
  checked: boolean;
};

export type ChallengeInteractionSurface = "page" | "popup" | "interstitial" | "unknown";
export type ChallengeInteractionPreference = "click" | "click_and_hold" | "drag" | "unknown";

export type ChallengeInteractionSignals = {
  surface: ChallengeInteractionSurface;
  preferredAction: ChallengeInteractionPreference;
  clickRefs: string[];
  holdRefs: string[];
  dragRefs: string[];
  evidencePhrases: string[];
  holdMs?: number;
};

export type ChallengeDiagnosticsSummary = {
  traceRequestId?: string;
  consoleCount: number;
  exceptionCount: number;
  networkCount: number;
  networkHosts: string[];
  warnings: string[];
  screenshotCaptured: boolean;
};

export type ChallengeContinuitySignals = {
  hasPreservedSession: boolean;
  hasPreservedTarget: boolean;
  hasSuspendedIntent: boolean;
  attachedSession: boolean;
  cookieCount: number;
  canReuseExistingCookies: boolean;
  canImportCookies: boolean;
  hasNonSecretTaskData: boolean;
  likelyLoginPage: boolean;
  likelySessionPicker: boolean;
  likelyHumanVerification: boolean;
  loginRefs: string[];
  sessionReuseRefs: string[];
  humanVerificationRefs: string[];
  nonSecretFieldRefs: string[];
  checkpointRefs: string[];
};

export type ChallengeEvidenceBundle = {
  challengeId?: string;
  blocker?: BlockerSignalV1;
  blockerState: ChallengeRuntimeBlockerState;
  blockerResolution?: ChallengeResolutionMeta;
  challenge?: SessionChallengeSummary;
  url?: string;
  title?: string;
  activeTargetId?: string | null;
  snapshotId?: string;
  mode?: string;
  fallbackDisposition?: BrowserFallbackDisposition;
  ownerSurface?: SessionChallengeSummary["ownerSurface"];
  preservedSessionId?: string;
  preservedTargetId?: string;
  suspendedIntent?: SessionChallengeSummary["suspendedIntent"];
  registryPressure?: ProviderAntiBotSnapshot;
  taskData?: Record<string, JsonValue>;
  actionables: ChallengeActionable[];
  snapshotText?: string;
  diagnostics: ChallengeDiagnosticsSummary;
  continuity: ChallengeContinuitySignals;
  interaction?: ChallengeInteractionSignals;
};

export type ChallengeInterpreterResult = {
  classification: ChallengeClassification;
  authState:
    | "unknown"
    | "authenticated"
    | "login_page"
    | "session_reusable"
    | "credentials_required"
    | "human_verification";
  humanBoundary: ChallengeHumanBoundary;
  requiredVerification: ChallengeVerificationLevel;
  continuityOpportunities: Array<"existing_session" | "cookie_reuse" | "non_secret_form_fill">;
  allowedActionFamilies: ChallengeActionFamily[];
  laneHints: ChallengeStrategyLane[];
  stopRisk: "low" | "medium" | "high";
  summary: string;
  likelyCheckpoint?: string;
};

export type ChallengePolicyGate = {
  resolvedPolicy: ResolvedChallengeAutomationPolicy;
  allowedActions: ChallengeActionFamily[];
  forbiddenActions: ChallengeActionFamily[];
  handoffTriggers: ChallengeHumanBoundary[];
  governedLanes: ChallengeGovernedLaneKind[];
  optionalComputerUseBridge: boolean;
  helperEligibility: ChallengeAutomationHelperEligibility;
};

export type ChallengeCapabilityMatrix = {
  canNavigateToAuth: boolean;
  canReuseExistingSession: boolean;
  canReuseCookies: boolean;
  canFillNonSecretFields: boolean;
  canExploreClicks: boolean;
  canUseOwnedEnvironmentFixture: boolean;
  canUseSanctionedIdentity: boolean;
  canUseServiceAdapter: boolean;
  canUseComputerUseBridge: boolean;
  helperEligibility: ChallengeAutomationHelperEligibility;
  mustYield: boolean;
  mustDefer: boolean;
};

export type ChallengeStrategyDecision = {
  lane: ChallengeStrategyLane;
  governedLane?: ChallengeGovernedLaneKind;
  rationale: string;
  attemptBudget: number;
  noProgressLimit: number;
  verificationLevel: ChallengeVerificationLevel;
  stopConditions: string[];
  allowedActionFamilies: ChallengeActionFamily[];
};

export type ChallengeActionStep = {
  kind: ChallengeStepKind;
  reason: string;
  ref?: string;
  url?: string;
  text?: string;
  values?: string[];
  cookies?: ProviderCookieImportRecord[];
  snapshotChars?: number;
  traceMax?: number;
  dy?: number;
  holdMs?: number;
  coordinates?: {
    x: number;
    y: number;
  };
};

export type VerificationResult = {
  status: "clear" | "still_blocked" | "progress" | "yield_required" | "deferred";
  blockerState: ChallengeRuntimeBlockerState;
  blocker?: BlockerSignalV1;
  challenge?: SessionChallengeSummary;
  bundle?: ChallengeEvidenceBundle;
  changed: boolean;
  reason: string;
  url?: string;
  title?: string;
};

export type HumanYieldPacket = {
  challengeId: string;
  classification: ChallengeClassification;
  reason: ChallengeHumanBoundary;
  sessionId: string;
  targetId?: string | null;
  ownerSurface?: SessionChallengeSummary["ownerSurface"];
  url?: string;
  title?: string;
  requiredHumanStep: string;
  targetHints: string[];
  expectedPostAuthCheckpoint?: string;
  preserveUntil?: string;
  verifyUntil?: string;
  traceRequestId?: string;
  lastVerificationStatus?: VerificationResult["status"];
  lastVerificationReason?: string;
  evidenceSummary: string;
  reclaimHint: string;
  resumeRule: string;
};

export type OutcomeRecord = {
  at: string;
  challengeId?: string;
  lane: ChallengeStrategyLane;
  status: ChallengeActionStatus;
  reason: string;
  attempts: number;
  reusedExistingSession: boolean;
  reusedCookies: boolean;
  verification?: VerificationResult;
  evidence: ChallengeOrchestrationSnapshot["evidence"];
  resumeOutcome: "continued" | "awaiting_human_reclaim" | "deferred" | "still_blocked";
  executedSteps: ChallengeActionStep[];
  yielded?: HumanYieldPacket;
};

export type ChallengeOrchestrationSnapshot = {
  challengeId?: string;
  classification: ChallengeClassification;
  mode: ChallengeAutomationMode;
  source: ChallengeAutomationModeSource;
  lane: ChallengeStrategyLane;
  status: ChallengeActionStatus;
  reason: string;
  attempts: number;
  reusedExistingSession: boolean;
  reusedCookies: boolean;
  standDownReason?: ChallengeAutomationStandDownReason;
  helperEligibility: ChallengeAutomationHelperEligibility;
  verification: VerificationResult;
  evidence: {
    url?: string;
    title?: string;
    blockerType?: BlockerSignalV1["type"];
    fallbackDisposition?: BrowserFallbackDisposition;
    loginRefs: string[];
    humanVerificationRefs: string[];
    checkpointRefs: string[];
    interactionSurface?: ChallengeInteractionSurface;
    preferredAction?: ChallengeInteractionPreference;
    holdMs?: number;
    registryPressure?: ProviderAntiBotSnapshot;
  };
  yielded?: HumanYieldPacket;
};

export type ChallengeActionResult = {
  status: ChallengeActionStatus;
  attempts: number;
  noProgressCount: number;
  executedSteps: ChallengeActionStep[];
  verification: VerificationResult;
  reusedExistingSession: boolean;
  reusedCookies: boolean;
};

export type GovernedLaneRequest = {
  lane: ChallengeGovernedLaneKind;
  bundle: ChallengeEvidenceBundle;
  interpretation: ChallengeInterpreterResult;
  decision: ChallengeStrategyDecision;
  auditContext?: Record<string, JsonValue>;
};

export type GovernedLaneResult = {
  status: "executed" | "blocked" | "skipped";
  lane: ChallengeGovernedLaneKind;
  reason: string;
  auditMetadata: Record<string, JsonValue>;
  suggestedSteps?: ChallengeActionStep[];
};

export type ComputerUseBridgeResult = {
  status: "disabled" | "suggested" | "unsupported";
  reason: string;
  suggestedSteps: ChallengeActionStep[];
  standDownReason?: ChallengeAutomationStandDownReason;
  auditMetadata?: Record<string, JsonValue>;
};

export type ChallengeInspectPlan = {
  challengeId?: string;
  sessionMode?: string;
  classification: ChallengeClassification;
  authState: ChallengeInterpreterResult["authState"];
  summary: string;
  mode: ChallengeAutomationMode;
  source: ChallengeAutomationModeSource;
  helperEligibility: ChallengeAutomationHelperEligibility;
  standDownReason?: ChallengeAutomationStandDownReason;
  yield: {
    required: boolean;
    reason: ChallengeHumanBoundary;
  };
  decision: ChallengeStrategyDecision;
  allowedActionFamilies: ChallengeActionFamily[];
  forbiddenActionFamilies: ChallengeActionFamily[];
  governedLanes: ChallengeGovernedLaneKind[];
  capabilityMatrix: ChallengeCapabilityMatrix;
  helper: ComputerUseBridgeResult;
  suggestedSteps: ChallengeActionStep[];
  evidence: {
    blockerState: ChallengeRuntimeBlockerState;
    blockerType?: BlockerSignalV1["type"];
    url?: string;
    title?: string;
    activeTargetId?: string | null;
    snapshotId?: string;
    loginRefs: string[];
    sessionReuseRefs: string[];
    humanVerificationRefs: string[];
    checkpointRefs: string[];
  };
};

export type ChallengeOrchestrationResult = {
  bundle: ChallengeEvidenceBundle;
  interpretation: ChallengeInterpreterResult;
  decision: ChallengeStrategyDecision;
  action: ChallengeActionResult;
  outcome: ChallengeOrchestrationSnapshot;
};
