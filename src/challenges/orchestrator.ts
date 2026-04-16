import type { ChallengeRuntimeHandle } from "../browser/manager-types";
import type { ProvidersChallengeOrchestrationConfig } from "../config";
import { buildCapabilityMatrix } from "./capability-matrix";
import { captureChallengeEvidence } from "./capture";
import { evaluateGovernedLane } from "./governed-adapter-gateway";
import { buildHumanYieldPacket, shouldYieldToHuman } from "./human-yield-gate";
import { interpretChallengeEvidence } from "./interpreter";
import { OutcomeRecorder } from "./outcome-recorder";
import { suggestComputerUseActions } from "./optional-computer-use-bridge";
import { buildChallengePolicyGate, resolveChallengeAutomationPolicy } from "./policy-gate";
import { selectChallengeStrategy } from "./strategy-selector";
import { runChallengeActionLoop } from "./action-loop";
import type {
  ChallengeCapabilityMatrix,
  ChallengeEvidenceBundle,
  ChallengeOrchestrationResult,
  ChallengeOrchestrationSnapshot,
  ChallengeStrategyDecision,
  OutcomeRecord,
  ResolvedChallengeAutomationPolicy,
  VerificationResult
} from "./types";
import type { JsonValue } from "../providers/types";

const toStillBlockedVerification = (bundle: ChallengeEvidenceBundle, reason: string): VerificationResult => ({
  status: "still_blocked",
  blockerState: bundle.blockerState,
  blocker: bundle.blocker,
  challenge: bundle.challenge,
  bundle,
  changed: false,
  reason,
  url: bundle.url,
  title: bundle.title
});

const buildOutcome = (args: {
  bundle: ChallengeEvidenceBundle;
  decision: ChallengeStrategyDecision;
  interpretation: ReturnType<typeof interpretChallengeEvidence>;
  policy: ResolvedChallengeAutomationPolicy;
  capabilityMatrix: ChallengeCapabilityMatrix;
  verification: VerificationResult;
  status: ChallengeOrchestrationSnapshot["status"];
  reason: string;
  attempts: number;
  reusedExistingSession: boolean;
  reusedCookies: boolean;
  yielded?: ChallengeOrchestrationSnapshot["yielded"];
}): ChallengeOrchestrationSnapshot => ({
  challengeId: args.bundle.challengeId,
  classification: args.interpretation.classification,
  mode: args.policy.mode,
  source: args.policy.source,
  lane: args.decision.lane,
  status: args.status,
  reason: args.reason,
  attempts: args.attempts,
  reusedExistingSession: args.reusedExistingSession,
  reusedCookies: args.reusedCookies,
  helperEligibility: args.capabilityMatrix.helperEligibility,
  ...(
    !args.capabilityMatrix.helperEligibility.allowed || args.policy.standDownReason
      ? {
        standDownReason: args.capabilityMatrix.helperEligibility.standDownReason ?? args.policy.standDownReason
      }
      : {}
  ),
  verification: args.verification,
  evidence: {
    url: args.bundle.url,
    title: args.bundle.title,
    blockerType: args.bundle.blocker?.type,
    fallbackDisposition: args.bundle.fallbackDisposition,
    loginRefs: args.bundle.continuity.loginRefs,
    humanVerificationRefs: args.bundle.continuity.humanVerificationRefs,
    checkpointRefs: args.bundle.continuity.checkpointRefs,
    ...(args.bundle.interaction?.surface && args.bundle.interaction.surface !== "unknown"
      ? { interactionSurface: args.bundle.interaction.surface }
      : {}),
    ...(args.bundle.interaction?.preferredAction && args.bundle.interaction.preferredAction !== "unknown"
      ? { preferredAction: args.bundle.interaction.preferredAction }
      : {}),
    ...(typeof args.bundle.interaction?.holdMs === "number"
      ? { holdMs: args.bundle.interaction.holdMs }
      : {}),
    registryPressure: args.bundle.registryPressure
  },
  ...(args.yielded ? { yielded: args.yielded } : {})
});

const buildRecord = (outcome: ChallengeOrchestrationSnapshot, executedSteps: OutcomeRecord["executedSteps"]): OutcomeRecord => ({
  at: new Date().toISOString(),
  challengeId: outcome.challengeId,
  lane: outcome.lane,
  status: outcome.status,
  reason: outcome.reason,
  attempts: outcome.attempts,
  reusedExistingSession: outcome.reusedExistingSession,
  reusedCookies: outcome.reusedCookies,
  verification: outcome.verification,
  evidence: outcome.evidence,
  resumeOutcome: outcome.status === "resolved"
    ? "continued"
    : outcome.status === "yield_required"
      ? "awaiting_human_reclaim"
      : outcome.status === "deferred" || outcome.status === "policy_blocked"
        ? "deferred"
        : "still_blocked",
  executedSteps,
  ...(outcome.yielded ? { yielded: outcome.yielded } : {})
});

export class ChallengeOrchestrator {
  private readonly recorder: OutcomeRecorder;
  private readonly config: ProvidersChallengeOrchestrationConfig;

  constructor(config: ProvidersChallengeOrchestrationConfig, recorder = new OutcomeRecorder()) {
    this.config = config;
    this.recorder = recorder;
  }

  getRecorder(): OutcomeRecorder {
    return this.recorder;
  }

  async captureEvidence(args: {
    handle: ChallengeRuntimeHandle;
    sessionId: string;
    targetId?: string | null;
    canImportCookies: boolean;
    fallbackDisposition?: ChallengeEvidenceBundle["fallbackDisposition"];
    registryPressure?: ChallengeEvidenceBundle["registryPressure"];
    taskData?: ChallengeEvidenceBundle["taskData"];
  }): Promise<ChallengeEvidenceBundle> {
    return captureChallengeEvidence(args);
  }

  async orchestrate(args: {
    handle: ChallengeRuntimeHandle;
    sessionId: string;
    targetId?: string | null;
    policy?: ResolvedChallengeAutomationPolicy;
    canImportCookies?: boolean;
    fallbackDisposition?: ChallengeEvidenceBundle["fallbackDisposition"];
    registryPressure?: ChallengeEvidenceBundle["registryPressure"];
    taskData?: ChallengeEvidenceBundle["taskData"];
    auditContext?: Record<string, JsonValue>;
  }): Promise<ChallengeOrchestrationResult> {
    const bundle = await this.captureEvidence({
      handle: args.handle,
      sessionId: args.sessionId,
      targetId: args.targetId,
      canImportCookies: args.canImportCookies ?? false,
      fallbackDisposition: args.fallbackDisposition,
      registryPressure: args.registryPressure,
      taskData: args.taskData
    });
    const interpretation = interpretChallengeEvidence(bundle);
    const policy = args.policy ?? resolveChallengeAutomationPolicy({
      configMode: this.config.mode
    });
    const gate = buildChallengePolicyGate(this.config, interpretation, policy);
    const capabilityMatrix = buildCapabilityMatrix(bundle, interpretation, gate);
    const decision = selectChallengeStrategy({
      config: this.config,
      bundle,
      interpretation,
      capabilityMatrix,
      gate
    });

    const latest = this.recorder.latest(bundle.challengeId);
    if (
      latest
      && Date.now() - Date.parse(latest.at) < this.config.minAttemptGapMs
      && latest.status !== "resolved"
    ) {
      const verification = toStillBlockedVerification(bundle, "Recent bounded challenge attempt already ran; throttling repeated execution.");
      const outcome = buildOutcome({
        bundle,
        decision,
        interpretation,
        policy: gate.resolvedPolicy,
        capabilityMatrix,
        verification,
        status: "deferred",
        reason: "Recent attempt throttle",
        attempts: 0,
        reusedExistingSession: false,
        reusedCookies: false
      });
      return {
        bundle,
        interpretation,
        decision,
        action: {
          status: "deferred",
          attempts: 0,
          noProgressCount: 0,
          executedSteps: [],
          verification,
          reusedExistingSession: false,
          reusedCookies: false
        },
        outcome
      };
    }

    if (decision.lane === "defer") {
      const verification = toStillBlockedVerification(bundle, decision.rationale);
      const outcome = buildOutcome({
        bundle,
        decision,
        interpretation,
        policy: gate.resolvedPolicy,
        capabilityMatrix,
        verification,
        status: "deferred",
        reason: decision.rationale,
        attempts: 0,
        reusedExistingSession: false,
        reusedCookies: false
      });
      this.recorder.record(buildRecord(outcome, []));
      return {
        bundle,
        interpretation,
        decision,
        action: {
          status: "deferred",
          attempts: 0,
          noProgressCount: 0,
          executedSteps: [],
          verification,
          reusedExistingSession: false,
          reusedCookies: false
        },
        outcome
      };
    }

    if (decision.lane === "human_yield") {
      const yieldDecision = shouldYieldToHuman({ interpretation, noProgressExhausted: false });
      const verification = toStillBlockedVerification(bundle, `Yield required: ${yieldDecision.reason}`);
      const packet = buildHumanYieldPacket({
        bundle,
        interpretation,
        sessionId: args.sessionId,
        targetId: bundle.activeTargetId ?? args.targetId ?? null,
        reason: yieldDecision.reason,
        verification
      });
      const outcome = buildOutcome({
        bundle,
        decision,
        interpretation,
        policy: gate.resolvedPolicy,
        capabilityMatrix,
        verification,
        status: "yield_required",
        reason: `Yield required: ${yieldDecision.reason}`,
        attempts: 0,
        reusedExistingSession: false,
        reusedCookies: false,
        yielded: packet
      });
      this.recorder.record(buildRecord(outcome, []));
      return {
        bundle,
        interpretation,
        decision,
        action: {
          status: "yield_required",
          attempts: 0,
          noProgressCount: 0,
          executedSteps: [],
          verification,
          reusedExistingSession: false,
          reusedCookies: false
        },
        outcome
      };
    }

    let suggestedSteps = undefined;
    if (decision.lane === "optional_computer_use_bridge") {
      suggestedSteps = suggestComputerUseActions({
        helperEligibility: capabilityMatrix.helperEligibility,
        bundle,
        maxSuggestions: this.config.optionalComputerUseBridge.maxSuggestions
      }).suggestedSteps;
    }
    if (decision.governedLane) {
      const governed = evaluateGovernedLane(this.config, {
        lane: decision.governedLane,
        bundle,
        interpretation,
        decision,
        auditContext: args.auditContext
      });
      if (governed.status === "blocked") {
        const verification = toStillBlockedVerification(bundle, governed.reason);
        const outcome = buildOutcome({
          bundle,
          decision,
          interpretation,
          policy: gate.resolvedPolicy,
          capabilityMatrix,
          verification,
          status: "policy_blocked",
          reason: governed.reason,
          attempts: 0,
          reusedExistingSession: false,
          reusedCookies: false
        });
        this.recorder.record(buildRecord(outcome, []));
        return {
          bundle,
          interpretation,
          decision,
          action: {
            status: "policy_blocked",
            attempts: 0,
            noProgressCount: 0,
            executedSteps: [],
            verification,
            reusedExistingSession: false,
            reusedCookies: false
          },
          outcome
        };
      }
      suggestedSteps = governed.suggestedSteps;
    }

    const action = await runChallengeActionLoop({
      handle: args.handle,
      sessionId: args.sessionId,
      targetId: args.targetId,
      initialBundle: bundle,
      decision,
      helperEligibility: capabilityMatrix.helperEligibility,
      config: this.config,
      suggestedSteps
    });
    const verifiedBundle = action.verification.bundle ?? bundle;

    const maybeYield = shouldYieldToHuman({
      interpretation,
      noProgressExhausted: action.status === "no_progress"
    });
    const yielded = action.status === "yield_required" || maybeYield.yield
      ? buildHumanYieldPacket({
        bundle: verifiedBundle,
        interpretation,
        sessionId: args.sessionId,
        targetId: verifiedBundle.activeTargetId ?? bundle.activeTargetId ?? args.targetId ?? null,
        reason: action.status === "yield_required" ? maybeYield.reason : maybeYield.reason,
        verification: action.verification
      })
      : undefined;

    const outcome = buildOutcome({
      bundle: verifiedBundle,
      decision,
      interpretation,
      policy: gate.resolvedPolicy,
      capabilityMatrix,
      verification: action.verification,
      status: action.status === "yield_required" || maybeYield.yield
        ? "yield_required"
        : action.status,
      reason: action.verification.reason,
      attempts: action.attempts,
      reusedExistingSession: action.reusedExistingSession,
      reusedCookies: action.reusedCookies,
      ...(yielded ? { yielded } : {})
    });

    this.recorder.record(buildRecord(outcome, action.executedSteps));
    return {
      bundle,
      interpretation,
      decision,
      action,
      outcome
    };
  }
}
