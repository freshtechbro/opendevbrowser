import { describe, expect, it } from "vitest";
import { buildChallengeEvidenceBundle, interpretChallengeEvidence } from "../src/challenges";

const buildBundle = (args: {
  url: string;
  title: string;
  blockerType?: "auth_required" | "anti_bot_challenge";
  reasonCode?: "token_required" | "challenge_detected" | "auth_required";
  snapshot: string;
  cookieCount?: number;
  canImportCookies?: boolean;
  taskData?: Record<string, string>;
}) => buildChallengeEvidenceBundle({
  status: {
    mode: "extension",
    activeTargetId: "tab-1",
    url: args.url,
    title: args.title,
    meta: {
      blocker: args.blockerType ? {
        schemaVersion: "1.0",
        type: args.blockerType,
        source: "navigation",
        reasonCode: args.reasonCode ?? "token_required",
        confidence: 0.9,
        retryable: true,
        detectedAt: "2026-03-22T00:00:00.000Z",
        evidence: {
          matchedPatterns: [],
          networkHosts: []
        },
        actionHints: []
      } : undefined,
      blockerState: "active"
    }
  },
  snapshot: {
    content: args.snapshot
  },
  cookieCount: args.cookieCount ?? 0,
  canImportCookies: args.canImportCookies ?? true,
  ...(args.taskData ? { taskData: args.taskData } : {})
});

describe("challenge interpreter", () => {
  it("classifies reusable auth interruptions separately from fresh auth requirements", () => {
    const bundle = buildBundle({
      url: "https://example.com/login",
      title: "Sign in",
      blockerType: "auth_required",
      reasonCode: "token_required",
      snapshot: "[r1] link \"Sign in\"\n[r2] button \"Use existing session\"",
      cookieCount: 2
    });

    const result = interpretChallengeEvidence(bundle);
    expect(result.classification).toBe("existing_session_reuse");
    expect(result.authState).toBe("session_reusable");
    expect(result.continuityOpportunities).toContain("existing_session");
  });

  it("treats chooser-based account selection as existing-session reuse even without cookies", () => {
    const bundle = buildBundle({
      url: "https://accounts.google.com/v3/signin/identifier",
      title: "Choose an account",
      blockerType: "auth_required",
      reasonCode: "token_required",
      snapshot: [
        "[r1] button \"bishop@example.com\"",
        "[r2] button \"Use another account\""
      ].join("\n"),
      cookieCount: 0
    });

    const result = interpretChallengeEvidence(bundle);
    expect(result.classification).toBe("existing_session_reuse");
    expect(result.authState).toBe("session_reusable");
  });

  it("classifies unsupported third-party challenge pages distinctly", () => {
    const bundle = buildBundle({
      url: "https://example.com/challenge",
      title: "Security verification",
      blockerType: "anti_bot_challenge",
      reasonCode: "challenge_detected",
      snapshot: "[r1] button \"Verify you're human\""
    });

    const result = interpretChallengeEvidence(bundle);
    expect(result.classification).toBe("unsupported_third_party_challenge");
    expect(result.humanBoundary).toBe("unsupported_third_party");
    expect(result.laneHints).toContain("human_yield");
  });

  it("recognizes owned-environment fixture pages from local approved fixtures", () => {
    const bundle = buildBundle({
      url: "file:///tmp/turnstile-checkbox.html",
      title: "turnstile-checkbox fixture",
      blockerType: "anti_bot_challenge",
      reasonCode: "challenge_detected",
      snapshot: "[r1] button \"Verify you're human\""
    });

    const result = interpretChallengeEvidence(bundle);
    expect(result.classification).toBe("owned_environment_test_challenge");
    expect(result.laneHints[0]).toBe("owned_environment_fixture");
  });

  it("detects MFA boundaries as human verification requirements", () => {
    const bundle = buildBundle({
      url: "https://example.com/login",
      title: "Enter your verification code",
      blockerType: "auth_required",
      reasonCode: "auth_required",
      snapshot: "[r1] textbox \"Verification code\"\n[r2] button \"Continue\""
    });

    const result = interpretChallengeEvidence(bundle);
    expect(result.classification).toBe("human_verification_required");
    expect(result.authState).toBe("human_verification");
    expect(result.humanBoundary).toBe("mfa");
    expect(result.stopRisk).toBe("high");
  });

  it("keeps fresh auth requirements separate and allows non-secret form fill when task data exists", () => {
    const bundle = buildBundle({
      url: "https://example.com/login",
      title: "Create account",
      blockerType: "auth_required",
      reasonCode: "token_required",
      snapshot: "[r1] textbox \"Email\"\n[r2] button \"Continue\"",
      taskData: {
        email: "agent@example.com"
      }
    });

    const result = interpretChallengeEvidence(bundle);
    expect(result.classification).toBe("auth_required");
    expect(result.authState).toBe("login_page");
    expect(result.allowedActionFamilies).toContain("non_secret_form_fill");
    expect(result.continuityOpportunities).toContain("non_secret_form_fill");
  });

  it("falls back to checkpoint friction and authenticated state when no blocker-specific auth or challenge lane exists", () => {
    const bundle = buildBundle({
      url: "https://example.com/app",
      title: "Workspace",
      snapshot: "[r9] button \"Continue\"",
      cookieCount: 1
    });

    const result = interpretChallengeEvidence(bundle);
    expect(result.classification).toBe("checkpoint_or_friction");
    expect(result.authState).toBe("authenticated");
    expect(result.humanBoundary).toBe("none");
    expect(result.likelyCheckpoint).toBe("r9");
  });

  it("downgrades human-verification pages with explicit session reuse into checkpoint friction", () => {
    const bundle = buildBundle({
      url: "https://example.com/challenge",
      title: "Security verification",
      blockerType: "anti_bot_challenge",
      reasonCode: "challenge_detected",
      snapshot: "[r1] button \"Use existing session\"\n[r2] button \"Verify you're human\""
    });

    const result = interpretChallengeEvidence(bundle);
    expect(result.classification).toBe("checkpoint_or_friction");
    expect(result.humanBoundary).toBe("none");
    expect(result.summary).toContain("classification=checkpoint_or_friction");
  });

  it("includes popup interaction evidence in the summary when visible", () => {
    const bundle = buildBundle({
      url: "https://example.com/challenge",
      title: "Choose where you'd like to shop",
      blockerType: "anti_bot_challenge",
      reasonCode: "challenge_detected",
      snapshot: "[r1] dialog \"Choose where you'd like to shop\"\n[r2] button \"Pickup\""
    });

    const result = interpretChallengeEvidence(bundle);

    expect(result.summary).toContain("surface=popup");
    expect(result.summary).toContain("preferredAction=click");
  });

  it("omits unknown interaction surfaces from the summary", () => {
    const bundle = buildBundle({
      url: "https://example.com/challenge",
      title: "",
      blockerType: "anti_bot_challenge",
      reasonCode: "challenge_detected",
      snapshot: ""
    });

    const result = interpretChallengeEvidence(bundle);

    expect(result.summary).not.toContain("surface=");
  });

  it("adds click-and-hold actions when the interaction evidence requests a hold gesture", () => {
    const bundle = buildBundle({
      url: "https://example.com/challenge",
      title: "Press and hold",
      blockerType: "anti_bot_challenge",
      reasonCode: "challenge_detected",
      snapshot: "[r30] button \"Press and hold for 1 second\""
    });

    const result = interpretChallengeEvidence(bundle);

    expect(result.allowedActionFamilies).toContain("click_and_hold");
    expect(result.allowedActionFamilies).toContain("pointer");
    expect(result.summary).toContain("preferredAction=click_and_hold");
  });

  it("adds drag actions when the interaction evidence requests a slider gesture", () => {
    const bundle = buildBundle({
      url: "https://example.com/challenge",
      title: "Drag the slider",
      blockerType: "anti_bot_challenge",
      reasonCode: "challenge_detected",
      snapshot: "Drag the slider to continue."
    });

    const result = interpretChallengeEvidence(bundle);

    expect(result.allowedActionFamilies).toContain("drag");
    expect(result.allowedActionFamilies).toContain("pointer");
    expect(result.summary).toContain("preferredAction=drag");
  });

  it("omits continuity summary details when no continuity opportunity exists", () => {
    const bundle = buildBundle({
      url: "https://example.com/app",
      title: "Workspace",
      snapshot: "",
      canImportCookies: false
    });

    const result = interpretChallengeEvidence(bundle);
    expect(result.continuityOpportunities).toEqual([]);
    expect(result.summary).not.toContain("continuity=");
  });
});
