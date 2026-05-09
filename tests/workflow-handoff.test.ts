import { describe, expect, it } from "vitest";
import {
  buildInspiredesignSuccessHandoff,
  PRODUCT_VIDEO_BRIEF_HELPER_PATH,
  buildMacroResolveSuccessHandoff,
  buildProductVideoSuccessHandoff,
  buildResearchSuccessHandoff,
  buildShoppingSuccessHandoff
} from "../src/providers/workflow-handoff";
import {
  buildCanvasCommandGuidance,
  getCanvasRequiredNextCommands
} from "../src/canvas/guidance";
import { INSPIREDESIGN_HANDOFF_COMMANDS, INSPIREDESIGN_HANDOFF_GUIDANCE } from "../src/inspiredesign/handoff";
import type { JsonValue, ProviderFailureEntry } from "../src/providers/types";

const researchGatedFailure = (cookieDiagnostics?: Record<string, JsonValue>): ProviderFailureEntry => ({
  provider: "community/reddit",
  source: "community",
  error: {
    code: "auth",
    message: "Reddit requires login or a token for this request.",
    retryable: false,
    reasonCode: "auth_required",
    ...(cookieDiagnostics ? { details: { cookieDiagnostics } } : {})
  }
});

const researchDetailsOnlyGatedFailure = (): ProviderFailureEntry => ({
  provider: "community/reddit",
  source: "community",
  error: {
    code: "unavailable",
    message: "Provider returned a challenge page.",
    retryable: false,
    details: { reasonCode: "challenge_detected" }
  }
});

const researchAuthCodeFailure = (): ProviderFailureEntry => ({
  provider: "community/reddit",
  source: "community",
  error: {
    code: "auth",
    message: "Provider returned a login wall.",
    retryable: false
  }
});

const researchRateLimitedFailure = (): ProviderFailureEntry => ({
  provider: "web/search",
  source: "web",
  error: {
    code: "rate_limited",
    message: "Provider returned 429.",
    retryable: true,
    reasonCode: "rate_limited"
  }
});

describe("workflow handoff builders", () => {
  it("builds research rerun guidance with explicit source and timebox flags", () => {
    const handoff = buildResearchSuccessHandoff({
      topic: "browser automation blockers"
    });

    expect(handoff.suggestedNextAction).toContain(
      "npx opendevbrowser research run --topic \"browser automation blockers\" --days 14 --sources web,community --browser-mode managed --mode json --output-format json"
    );
    expect(handoff.suggestedSteps[1]?.command).toContain("--sources web,community");
    expect(handoff.suggestedSteps[1]?.command).not.toContain("--source-selection auto");
    expect(handoff.suggestedSteps[1]?.command).toContain("--browser-mode managed");
    expect(handoff.suggestedNextAction).toContain("records.json, context.json, meta.json, and report.md");
    expect(handoff.followthroughSummary).toContain("artifact metadata");
  });

  it("preserves requested research browser mode in rerun guidance", () => {
    const handoff = buildResearchSuccessHandoff({
      topic: "signed-in social research",
      browserMode: "extension"
    });

    expect(handoff.suggestedSteps[1]?.command).toContain("--browser-mode extension");
  });

  it("adds gated research recovery guidance for auth-constrained providers", () => {
    const handoff = buildResearchSuccessHandoff({
      topic: "reddit browser automation reports",
      failures: [researchGatedFailure()]
    });

    expect(handoff.followthroughSummary).toContain("gated-provider diagnostics");
    expect(handoff.followthroughSummary).toContain("community/reddit");
    expect(handoff.suggestedNextAction).toContain("user-authorized signed-in relay session");
    expect(handoff.suggestedNextAction).toContain("--browser-mode extension");
    expect(handoff.suggestedNextAction).toContain("--challenge-automation-mode browser_with_helper");
    expect(handoff.suggestedNextAction).toContain("Add --use-cookies only when legitimate provider cookies are available.");
    expect(handoff.suggestedSteps[1]?.command).not.toContain("--use-cookies");
  });

  it("adds gated research recovery guidance for details-only challenge codes", () => {
    const handoff = buildResearchSuccessHandoff({
      topic: "challenge-constrained browser automation reports",
      failures: [researchDetailsOnlyGatedFailure()]
    });

    expect(handoff.followthroughSummary).toContain("community/reddit");
    expect(handoff.suggestedSteps[1]?.command).toContain("--browser-mode extension");
    expect(handoff.suggestedSteps[1]?.command).toContain("--challenge-automation-mode browser_with_helper");
  });

  it("normalizes auth-code research failures without top-level reason codes", () => {
    const handoff = buildResearchSuccessHandoff({
      topic: "login-constrained browser automation reports",
      failures: [researchAuthCodeFailure()]
    });

    expect(handoff.followthroughSummary).toContain("community/reddit");
    expect(handoff.suggestedSteps[1]?.command).toContain("--browser-mode extension");
  });

  it("adds gated research recovery guidance from challenge orchestration metadata", () => {
    const handoff = buildResearchSuccessHandoff({
      topic: "challenge-constrained browser automation reports",
      challengeOrchestration: [{
        provider: "community/reddit",
        source: "community",
        blockerType: "anti_bot_challenge",
        browserFallbackReasonCode: "challenge_detected"
      }]
    });

    expect(handoff.followthroughSummary).toContain("community/reddit");
    expect(handoff.suggestedSteps[1]?.command).toContain("--browser-mode extension");
    expect(handoff.suggestedSteps[1]?.command).toContain("--challenge-automation-mode browser_with_helper");
  });

  it("uses generic gated-provider guidance when diagnostics omit provider names", () => {
    const handoff = buildResearchSuccessHandoff({
      topic: "cookie-constrained browser automation reports",
      cookieDiagnostics: [{ reasonCode: "auth_required", policy: "required", injected: 1 }]
    });

    expect(handoff.followthroughSummary).toContain("gated providers");
    expect(handoff.suggestedSteps[1]?.command).toContain("--use-cookies");
  });

  it("reads browser fallback challenge reason metadata", () => {
    const handoff = buildResearchSuccessHandoff({
      topic: "challenge-constrained browser automation reports",
      challengeOrchestration: [{
        provider: "community/reddit",
        blockerType: "auth_required",
        browserFallbackReasonCode: "auth_required"
      }]
    });

    expect(handoff.followthroughSummary).toContain("community/reddit");
    expect(handoff.suggestedSteps[1]?.command).toContain("--challenge-automation-mode browser_with_helper");
  });

  it("uses generic gated guidance for providerless challenge metadata", () => {
    const handoff = buildResearchSuccessHandoff({
      topic: "challenge-constrained browser automation reports",
      challengeOrchestration: [{ reasonCode: "challenge_detected" }]
    });

    expect(handoff.followthroughSummary).toContain("gated providers");
    expect(handoff.suggestedSteps[1]?.command).toContain("--challenge-automation-mode browser_with_helper");
  });

  it("keeps non-gated challenge metadata on the default research handoff", () => {
    const handoff = buildResearchSuccessHandoff({
      topic: "rate-limited browser automation reports",
      challengeOrchestration: [{ blockerType: "rate_limited" }]
    });

    expect(handoff.followthroughSummary).not.toContain("gated-provider diagnostics");
    expect(handoff.suggestedSteps[1]?.command).not.toContain("--challenge-automation-mode browser_with_helper");
  });

  it("adds cookie-backed gated research recovery only when diagnostics show available cookies", () => {
    const handoff = buildResearchSuccessHandoff({
      topic: "reddit browser automation reports",
      failures: [researchGatedFailure({ available: true, verifiedCount: 2 })],
      cookieDiagnostics: [{
        provider: "community/reddit",
        source: "community",
        policy: "required",
        reasonCode: "auth_required",
        available: true,
        verifiedCount: 2
      }]
    });

    expect(handoff.suggestedNextAction).toContain("--use-cookies");
    expect(handoff.suggestedNextAction).toContain("cookie diagnostics show available cookies");
    expect(handoff.suggestedSteps[1]?.command).toContain("--use-cookies");
  });

  it("does not add cookies from unrelated aggregate cookie diagnostics", () => {
    const handoff = buildResearchSuccessHandoff({
      topic: "reddit browser automation reports",
      failures: [researchGatedFailure()],
      cookieDiagnostics: [{ provider: "web/search", available: true, loaded: 1 }]
    });

    expect(handoff.followthroughSummary).toContain("community/reddit");
    expect(handoff.suggestedSteps[1]?.command).not.toContain("--use-cookies");
  });

  it("keeps non-gated research failures on the default evidence rerun path", () => {
    const handoff = buildResearchSuccessHandoff({
      topic: "rate-limited browser automation reports",
      failures: [researchRateLimitedFailure()],
      cookieDiagnostics: [{ provider: "web/search", source: "web", available: true }]
    });

    expect(handoff.followthroughSummary).not.toContain("gated-provider diagnostics");
    expect(handoff.suggestedSteps[1]?.command).toContain("--browser-mode managed");
    expect(handoff.suggestedSteps[1]?.command).not.toContain("--use-cookies");
    expect(handoff.suggestedSteps[1]?.command).not.toContain("--challenge-automation-mode browser_with_helper");
  });

  it("does not add cookies when gated diagnostics show no available cookies", () => {
    const handoff = buildResearchSuccessHandoff({
      topic: "reddit browser automation reports",
      failures: [researchGatedFailure({
        available: false,
        loaded: 0,
        injected: 0,
        verifiedCount: 0
      })]
    });

    expect(handoff.followthroughSummary).toContain("community/reddit");
    expect(handoff.suggestedSteps[1]?.command).not.toContain("--use-cookies");
  });

  it("falls back to default shopping providers and managed mode when optional inputs are absent", () => {
    const handoff = buildShoppingSuccessHandoff({
      query: "ergonomic mouse"
    });

    expect(handoff.suggestedNextAction).toContain(
      "npx opendevbrowser shopping run --query \"ergonomic mouse\" --providers shopping/bestbuy,shopping/ebay --browser-mode managed --use-cookies --challenge-automation-mode browser_with_helper --mode json --output-format json"
    );
    expect(handoff.suggestedSteps[1]?.command).not.toContain("--budget");
    expect(handoff.suggestedSteps[1]?.command).not.toContain("--region");
  });

  it("preserves product-name reruns when no canonical product url is available yet", () => {
    const handoff = buildProductVideoSuccessHandoff({
      productName: "Desk Lamp",
      includeCopy: true
    });

    expect(handoff.suggestedNextAction).toContain("product-video brief helper");
    expect(handoff.suggestedNextAction).not.toContain("<pack>");
    expect(handoff.suggestedSteps[1]?.command).toBe(`${PRODUCT_VIDEO_BRIEF_HELPER_PATH} <pack>/manifest.json`);
    expect(handoff.suggestedSteps[2]?.command).toBe(
      "npx opendevbrowser product-video run --product-name \"Desk Lamp\" --include-copy --browser-mode managed --use-cookies --challenge-automation-mode browser_with_helper --output-format json"
    );
  });

  it("builds product-url reruns with provider and media flags", () => {
    const handoff = buildProductVideoSuccessHandoff({
      productUrl: "https://shop.example/item-1",
      providerHint: "amazon",
      browserMode: "extension",
      includeScreenshots: true,
      includeAllImages: true,
      includeCopy: true
    });

    expect(handoff.suggestedSteps[2]?.command).toBe(
      "npx opendevbrowser product-video run --product-url \"https://shop.example/item-1\" --provider-hint amazon --include-screenshots --include-all-images --include-copy --browser-mode extension --use-cookies --challenge-automation-mode browser_with_helper --output-format json"
    );
  });

  it("falls back to the placeholder product-name token when no rerun target is known yet", () => {
    const handoff = buildProductVideoSuccessHandoff();

    expect(handoff.suggestedSteps[2]?.command).toBe(
      "npx opendevbrowser product-video run --product-name \"<product-name>\" --browser-mode managed --use-cookies --challenge-automation-mode browser_with_helper --output-format json"
    );
  });

  it("uses preview-only macro guidance before execution", () => {
    const handoff = buildMacroResolveSuccessHandoff({
      expression: '@media.search(\"browser automation\", \"youtube\", 5)',
      defaultProvider: "social/youtube",
      execute: false,
      blocked: false
    });

    expect(handoff.suggestedNextAction).toContain("--execute");
    expect(handoff.suggestedSteps[1]?.command).toContain("--execute");
    expect(handoff.suggestedSteps[2]?.command).toContain("--default-provider social/youtube");
  });

  it("uses blocker-aware browser retry guidance after an execute failure", () => {
    const handoff = buildMacroResolveSuccessHandoff({
      expression: '@media.search(\"browser automation\", \"facebook\", 5)',
      execute: true,
      blocked: true
    });

    expect(handoff.followthroughSummary).toContain("execution.meta.blocker");
    expect(handoff.suggestedNextAction).toContain("--browser-mode extension");
    expect(handoff.suggestedNextAction).toContain("--challenge-automation-mode browser_with_helper");
    expect(handoff.suggestedSteps[1]?.command).toContain("--browser-mode extension");
    expect(handoff.suggestedSteps[1]?.command).toContain("--challenge-automation-mode browser_with_helper");
  });

  it("keeps preview-first follow-through after a successful execute run", () => {
    const handoff = buildMacroResolveSuccessHandoff({
      expression: '@media.search(\"browser automation\", \"facebook\", 5)',
      execute: true,
      blocked: false
    });

    expect(handoff.suggestedNextAction).toContain("macro-resolve --expression");
    expect(handoff.suggestedSteps[1]?.command).toContain("macro-resolve --expression");
    expect(handoff.suggestedSteps[2]?.command).toContain("--browser-mode extension");
    expect(handoff.suggestedSteps[2]?.command).toContain("--challenge-automation-mode browser_with_helper");
  });

  it("builds inspiredesign handoff steps from the shared workflow seam", () => {
    const handoff = buildInspiredesignSuccessHandoff({
      summary: "Read the generated artifacts before continuing.",
      nextStep: "Continue in Canvas after loading skills.",
      commandExamples: INSPIREDESIGN_HANDOFF_COMMANDS,
      deepCaptureRecommendation: "Rerun only when reference evidence must be refreshed."
    });

    expect(handoff.followthroughSummary).toBe("Read the generated artifacts before continuing.");
    expect(handoff.suggestedNextAction).toBe("Continue in Canvas after loading skills.");
    expect(handoff.suggestedSteps).toEqual([
      { reason: INSPIREDESIGN_HANDOFF_GUIDANCE.reviewAdvancedBrief },
      {
        reason: "Load the baseline workflow runbook before implementation.",
        command: INSPIREDESIGN_HANDOFF_COMMANDS.loadBestPractices
      },
      {
        reason: "Load the Canvas contract lane before patching.",
        command: INSPIREDESIGN_HANDOFF_COMMANDS.loadDesignAgent
      },
      {
        reason: INSPIREDESIGN_HANDOFF_GUIDANCE.prepareCanvasPlanRequest,
        command: INSPIREDESIGN_HANDOFF_COMMANDS.continueInCanvas
      },
      { reason: "Rerun only when reference evidence must be refreshed." }
    ]);
  });

  it.each([
    ["missing", "canvas.plan.set", ["canvas.plan.set"]],
    ["submitted", "canvas.document.patch", ["canvas.plan.set"]],
    ["invalid", "canvas.document.patch", ["canvas.plan.set"]],
    ["accepted", "canvas.document.patch", ["canvas.preview.render", "canvas.feedback.poll", "canvas.document.save"]],
    ["accepted", "canvas.session.open", ["canvas.document.patch", "canvas.preview.render", "canvas.feedback.poll", "canvas.document.save"]]
  ])("builds canvas guidance for %s plan status and %s", (planStatus, command, expectedCommands) => {
    expect(buildCanvasCommandGuidance({
      planStatus,
      command: command as Parameters<typeof buildCanvasCommandGuidance>[0]["command"]
    }).recommendedNextCommands).toEqual(expectedCommands);
  });

  it.each([
    ["plan_required", ["canvas.plan.set"]],
    ["generation_plan_invalid", ["canvas.plan.set", "canvas.plan.get"]],
    ["revision_conflict", ["canvas.document.load"]],
    ["policy_violation", ["canvas.plan.get", "canvas.document.load"]],
    ["unsupported_target", ["canvas.session.status"]],
    ["lease_reclaim_required", ["canvas.session.status"]]
  ] as const)("returns canvas blocker commands for %s", (code, expectedCommands) => {
    expect(getCanvasRequiredNextCommands(code)).toEqual(expectedCommands);
  });

  it("clones canvas guidance command arrays", () => {
    const commands = getCanvasRequiredNextCommands("plan_required");
    commands.push("canvas.document.patch");

    expect(getCanvasRequiredNextCommands("plan_required")).toEqual(["canvas.plan.set"]);
  });
});
