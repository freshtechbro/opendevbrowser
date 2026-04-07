import { describe, expect, it } from "vitest";
import { buildChallengeEvidenceBundle, evaluateGovernedLane } from "../src/challenges";
import type {
  ChallengeGovernedLaneKind,
  ChallengeInterpreterResult,
  ChallengeStrategyDecision,
  GovernedLaneRequest
} from "../src/challenges";
import type { ProvidersChallengeOrchestrationConfig } from "../src/config";

const makeConfig = (overrides: Partial<ProvidersChallengeOrchestrationConfig> = {}): ProvidersChallengeOrchestrationConfig => ({
  mode: "browser",
  attemptBudget: 6,
  noProgressLimit: 3,
  stepTimeoutMs: 5000,
  minAttemptGapMs: 10000,
  allowAuthNavigation: true,
  allowSessionReuse: true,
  allowCookieReuse: true,
  allowNonSecretFormFill: true,
  allowInteractionExploration: true,
  governed: {
    allowOwnedEnvironmentFixtures: true,
    allowSanctionedIdentity: false,
    allowServiceAdapters: false,
    requireAuditMetadata: true
  },
  optionalComputerUseBridge: {
    enabled: false,
    maxSuggestions: 3
  },
  ...overrides
});

const makeBundle = (url: string, title: string, snapshot: string) => buildChallengeEvidenceBundle({
  status: {
    mode: "extension",
    activeTargetId: "tab-1",
    url,
    title,
    meta: {
      blockerState: "active"
    }
  },
  snapshot: {
    content: snapshot
  }
});

const makeInterpretation = (classification: ChallengeInterpreterResult["classification"], laneHint: ChallengeGovernedLaneKind): ChallengeInterpreterResult => ({
  classification,
  authState: classification === "auth_required" ? "credentials_required" : "human_verification",
  humanBoundary: "none",
  requiredVerification: "full",
  continuityOpportunities: [],
  allowedActionFamilies: ["verification"],
  laneHints: [laneHint],
  stopRisk: "medium",
  summary: classification,
  likelyCheckpoint: undefined
});

const makeDecision = (lane: ChallengeGovernedLaneKind): ChallengeStrategyDecision => ({
  lane,
  governedLane: lane,
  rationale: lane,
  attemptBudget: 6,
  noProgressLimit: 3,
  verificationLevel: "full",
  stopConditions: [],
  allowedActionFamilies: ["verification"]
});

const makeRequest = (
  lane: ChallengeGovernedLaneKind,
  bundle: ReturnType<typeof makeBundle>,
  auditContext?: Record<string, string>
): GovernedLaneRequest => ({
  lane,
  bundle,
  interpretation: makeInterpretation(
    lane === "owned_environment_fixture" ? "owned_environment_test_challenge" : "auth_required",
    lane
  ),
  decision: makeDecision(lane),
  ...(auditContext ? { auditContext } : {})
});

describe("challenge governed adapter gateway", () => {
  it("blocks all governed lanes when challenge orchestration is disabled", () => {
    const result = evaluateGovernedLane(
      makeConfig({ mode: "off" }),
      makeRequest(
        "owned_environment_fixture",
        makeBundle("file:///tmp/turnstile-checkbox.html", "turnstile-checkbox fixture", "[r1] button \"Verify you're human\"")
      )
    );

    expect(result).toEqual({
      status: "blocked",
      lane: "owned_environment_fixture",
      reason: "Challenge automation mode is off.",
      auditMetadata: {}
    });
  });

  it("allows owned-environment fixtures with approved vendor markers", () => {
    const result = evaluateGovernedLane(
      makeConfig(),
      makeRequest(
        "owned_environment_fixture",
        makeBundle("file:///tmp/turnstile-checkbox.html", "turnstile-checkbox fixture", "[r1] button \"Verify you're human\"")
      )
    );

    expect(result.status).toBe("executed");
    expect(result.auditMetadata).toEqual({ approvedFixture: true });
  });

  it("blocks owned-environment fixtures when policy disables them or the marker is unapproved", () => {
    const disabled = evaluateGovernedLane(
      makeConfig({
        governed: {
          allowOwnedEnvironmentFixtures: false,
          allowSanctionedIdentity: false,
          allowServiceAdapters: false,
          requireAuditMetadata: true
        }
      }),
      makeRequest(
        "owned_environment_fixture",
        makeBundle("file:///tmp/turnstile-checkbox.html", "turnstile-checkbox fixture", "[r1] button \"Verify you're human\"")
      )
    );
    const unapproved = evaluateGovernedLane(
      makeConfig(),
      makeRequest(
        "owned_environment_fixture",
        makeBundle("https://example.com/challenge", "challenge", "[r1] button \"Verify\"")
      )
    );

    expect(disabled.reason).toContain("disabled by policy");
    expect(unapproved).toEqual({
      status: "blocked",
      lane: "owned_environment_fixture",
      reason: "Owned-environment lane requires an approved vendor test fixture.",
      auditMetadata: { approvedFixture: false }
    });
  });

  it("enforces explicit entitlement for sanctioned identity", () => {
    const config = makeConfig({
      governed: {
        allowOwnedEnvironmentFixtures: true,
        allowSanctionedIdentity: true,
        allowServiceAdapters: false,
        requireAuditMetadata: true
      }
    });
    const bundle = makeBundle("https://example.com/login", "Sign in", "[r1] link \"Sign in\"");

    const blocked = evaluateGovernedLane(config, makeRequest("sanctioned_identity", bundle));
    const executed = evaluateGovernedLane(
      config,
      makeRequest("sanctioned_identity", bundle, { identityEntitlement: "employee-sso" })
    );

    expect(blocked).toEqual({
      status: "blocked",
      lane: "sanctioned_identity",
      reason: "Sanctioned identity lane requires explicit entitlement metadata.",
      auditMetadata: { approved: false }
    });
    expect(executed).toEqual({
      status: "executed",
      lane: "sanctioned_identity",
      reason: "Sanctioned identity lane approved by explicit entitlement.",
      auditMetadata: {
        approved: true,
        entitlement: "employee-sso"
      }
    });
  });

  it("blocks sanctioned identity when policy leaves the lane disabled", () => {
    const result = evaluateGovernedLane(
      makeConfig(),
      makeRequest(
        "sanctioned_identity",
        makeBundle("https://example.com/login", "Sign in", "[r1] link \"Sign in\"")
      )
    );

    expect(result).toEqual({
      status: "blocked",
      lane: "sanctioned_identity",
      reason: "Sanctioned identity is disabled by policy.",
      auditMetadata: {}
    });
  });

  it("enforces explicit adapter metadata for service adapters", () => {
    const bundle = makeBundle("https://example.com/challenge", "Security verification", "[r1] button \"Continue\"");
    const blockedByPolicy = evaluateGovernedLane(
      makeConfig(),
      makeRequest("service_adapter", bundle)
    );
    const config = makeConfig({
      governed: {
        allowOwnedEnvironmentFixtures: true,
        allowSanctionedIdentity: false,
        allowServiceAdapters: true,
        requireAuditMetadata: true
      }
    });
    const blockedByMetadata = evaluateGovernedLane(config, makeRequest("service_adapter", bundle));
    const executed = evaluateGovernedLane(
      config,
      makeRequest("service_adapter", bundle, { adapterId: "vendor-sandbox" })
    );

    expect(blockedByPolicy.reason).toContain("disabled by policy");
    expect(blockedByMetadata).toEqual({
      status: "blocked",
      lane: "service_adapter",
      reason: "Service-adapter lane requires an explicit adapter identifier and entitlement.",
      auditMetadata: { approved: false }
    });
    expect(executed).toEqual({
      status: "executed",
      lane: "service_adapter",
      reason: "Governed service adapter approved by explicit adapter metadata.",
      auditMetadata: {
        approved: true,
        adapterId: "vendor-sandbox"
      }
    });
  });
});
