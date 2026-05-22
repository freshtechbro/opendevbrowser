import { describe, expect, it } from "vitest";
import { GuidanceRouter, routeNextStepGuidance } from "../src/guidance/router";
import type { NextStepGuidance } from "../src/guidance/types";

const expectRunnableCommands = (guidance: NextStepGuidance): void => {
  for (const command of guidance.commands) {
    expect(command.command).not.toMatch(/<[^>]+>/);
    expect(command.command).toMatch(/^npx opendevbrowser |^opendevbrowser /);
  }
};

describe("GuidanceRouter", () => {
  it("routes Pinterest provider blockers to browser-native recovery", () => {
    const guidance = routeNextStepGuidance({
      workflow: "inspiredesign",
      reasonCode: "provider_unavailable",
      requestedProviders: ["social/pinterest"],
      siteRecipeId: "social/pinterest",
      providerUnavailable: true,
      query: "premium studio landing page",
      browserMode: "extension",
      useCookies: true,
      evidence: { referenceCount: 0, rankedReferenceCount: 0 }
    });

    expect(guidance.id).toBe("inspiredesign.harvest.pinterest_browser_native_recovery");
    expect(guidance.readiness).toBe("blocked");
    expect(guidance.primaryAction.summary).toContain("Pinterest browser-native recipe");
    expect(guidance.doNotProceedIf).toContain("reference_count is 0");
    expect(guidance.paramsExamples[0]?.params).toMatchObject({
      urls: ["https://www.pinterest.com/pin/27654985208435505/"],
      useCookies: true,
      cookiePolicy: "required"
    });
    expect(JSON.stringify(guidance.paramsExamples)).not.toContain("example.com");
    expectRunnableCommands(guidance);
  });

  it("routes design-ready evidence to Canvas handoff", () => {
    const guidance = routeNextStepGuidance({
      workflow: "inspiredesign",
      reasonCode: "design_ready",
      evidence: { referenceCount: 2, rankedReferenceCount: 2, topReferenceScore: 80, topReferenceConfidence: 0.8 }
    });

    expect(guidance.readiness).toBe("ready");
    expect(guidance.commands.map((entry) => entry.id)).toContain("canvas-session-open");
    expect(guidance.commands.map((entry) => entry.id)).toContain("canvas-plan-set");
    expect(guidance.commands.find((entry) => entry.id === "canvas-plan-set")?.command).toBe(
      "npx opendevbrowser canvas --command canvas.plan.set --params-file ./canvas-plan.request.json --output-format json"
    );
  });

  it("does not emit Canvas handoff commands when design-ready context is under evidence threshold", () => {
    const guidance = routeNextStepGuidance({
      workflow: "inspiredesign",
      reasonCode: "design_ready",
      evidence: { referenceCount: 1, rankedReferenceCount: 1, topReferenceScore: 20, topReferenceConfidence: 0.2 }
    });

    expect(guidance.readiness).toBe("needs_recovery");
    expect(guidance.reasonCode).toBe("weak_reference");
    expect(guidance.commands.map((entry) => entry.id)).not.toContain("canvas-session-open");
    expect(guidance.commands.map((entry) => entry.id)).not.toContain("canvas-plan-set");
  });

  it("does not emit Canvas handoff commands when the top reference is off brief", () => {
    const guidance = routeNextStepGuidance({
      workflow: "inspiredesign",
      reasonCode: "design_ready",
      evidence: {
        referenceCount: 1,
        rankedReferenceCount: 1,
        topReferenceScore: 88,
        topReferenceConfidence: 0.88,
        topReferenceIntentMatched: false
      }
    });

    expect(guidance.readiness).toBe("needs_recovery");
    expect(guidance.reasonCode).toBe("off_brief_reference");
    expect(guidance.commands.map((entry) => entry.id)).not.toContain("canvas-session-open");
    expect(guidance.commands.map((entry) => entry.id)).not.toContain("canvas-plan-set");
  });

  it("routes research gated-provider recovery with default typed examples", () => {
    const guidance = routeNextStepGuidance({
      workflow: "research",
      reasonCode: "gated_provider"
    });

    expect(guidance.id).toBe("research.gated_provider_recovery");
    expect(guidance.commands[0]?.command).toContain("--topic \"browser automation provider recovery\"");
    expect(guidance.commands[0]?.command).not.toContain("--use-cookies");
    expectRunnableCommands(guidance);
    expect(guidance.paramsExamples[0]?.params).toMatchObject({
      browserMode: "extension",
      useCookies: false,
      providers: "gated providers"
    });
  });

  it("routes research gated-provider recovery with explicit typed retry inputs", () => {
    const guidance = routeNextStepGuidance({
      workflow: "research",
      reasonCode: "gated_provider",
      requestedProviders: ["community/reddit", "social/linkedin"],
      browserMode: "cdp",
      useCookies: true,
      details: {
        topic: "camera studio launch references"
      }
    });

    expect(guidance.commands[0]?.command).toContain("--topic \"camera studio launch references\"");
    expect(guidance.commands[0]?.command).toContain("--browser-mode cdp --use-cookies");
    expect(guidance.paramsExamples[0]?.params).toMatchObject({
      browserMode: "cdp",
      useCookies: true,
      providers: "community/reddit, social/linkedin"
    });
  });

  it("routes Canvas schema repair recipes with typed missing-field examples", () => {
    const invalidPlanGuidance = routeNextStepGuidance({
      workflow: "canvas",
      reasonCode: "generation_plan_invalid",
      details: {
        missingFields: ["generationPlan.intent", 42, "generationPlan.sections"]
      }
    });
    const planRequiredGuidance = routeNextStepGuidance({ workflow: "canvas", reasonCode: "plan_required" });
    const governanceGuidance = routeNextStepGuidance({ workflow: "canvas", reasonCode: "governance_missing" });
    const sessionGuidance = routeNextStepGuidance({ workflow: "canvas", reasonCode: "missing_canvas_session_id" });
    const leaseGuidance = routeNextStepGuidance({ workflow: "canvas", reasonCode: "missing_lease_id" });
    const documentGuidance = routeNextStepGuidance({ workflow: "canvas", reasonCode: "missing_document_id" });

    expect(invalidPlanGuidance.id).toBe("canvas.generation_plan_invalid");
    expect(invalidPlanGuidance.fieldExamples.map((entry) => entry.path)).toEqual([
      "generationPlan.intent",
      "generationPlan.sections"
    ]);
    expect(planRequiredGuidance.id).toBe("canvas.plan_required");
    expect(governanceGuidance.id).toBe("canvas.governance_missing");
    expect(sessionGuidance.id).toBe("canvas.missing_canvas_session_id");
    expect(leaseGuidance.id).toBe("canvas.missing_lease_id");
    expect(documentGuidance.id).toBe("canvas.missing_document_id");
  });

  it("routes Canvas invalid-plan issue details into typed examples", () => {
    const guidance = routeNextStepGuidance({
      workflow: "canvas",
      reasonCode: "generation_plan_invalid",
      details: {
        issues: [{
          path: "targetOutcome.mode",
          code: "invalid_value",
          message: "Mode must be supported.",
          expected: ["high-fi-live-edit"],
          received: "wireframe"
        }, null, "not-an-issue", ["targetOutcome.mode"]]
      }
    });

    expect(guidance.fieldExamples[0]).toEqual(expect.objectContaining({
      path: "generationPlan.targetOutcome.mode",
      expected: "high-fi-live-edit",
      received: "wireframe"
    }));
  });

  it("routes all-rejected Pinterest URL evidence to browser-native recovery", () => {
    const guidance = routeNextStepGuidance({
      workflow: "inspiredesign",
      reasonCode: "zero_ranked_references",
      siteRecipeId: "social/pinterest",
      evidence: { referenceCount: 2, rankedReferenceCount: 0, rejectedReferenceCount: 2 }
    });

    expect(guidance.id).toBe("inspiredesign.harvest.pinterest_browser_native_recovery");
    expect(guidance.readiness).toBe("needs_recovery");
    expect(guidance.commands[0]?.command).toContain("--provider social/pinterest");
    expect(guidance.commands[0]?.command).toContain("--browser-mode extension --use-cookies --cookie-policy required");
  });

  it("omits non-canonical Pinterest chrome URLs from URL recovery commands", () => {
    const guidance = routeNextStepGuidance({
      workflow: "inspiredesign",
      reasonCode: "zero_ranked_references",
      requestedProviders: ["social/pinterest"],
      siteRecipeId: "social/pinterest",
      referenceUrls: [
        "https://www.pinterest.com/search/pins/?q=studio",
        "https://www.pinterest.com/pin/61572719900827789/?utm_source=test",
        "/pin/61572719900827790/?utm_source=relative",
        "https://www.pinterest.com/studio/pins/",
        "https://www.pinterest.com/ideas/web-design-parallax-scrolling/896364491640/#comments"
      ],
      evidence: { referenceCount: 4, rankedReferenceCount: 0, rejectedReferenceCount: 4 }
    });

    const command = guidance.commands[0]?.command ?? "";
    expect(command).toContain("--provider social/pinterest --url");
    expect(command).toContain("--url \"https://www.pinterest.com/pin/61572719900827789/\"");
    expect(command).toContain("--url \"https://www.pinterest.com/pin/61572719900827790/\"");
    expect(command).toContain("--url \"https://www.pinterest.com/ideas/web-design-parallax-scrolling/896364491640/\"");
    expect(command).not.toContain("/search/pins");
    expect(command).not.toContain("/studio/pins");
    expect(command).not.toContain("--query");
  });

  it("falls back to Pinterest query recovery when no canonical reference URLs remain", () => {
    const guidance = routeNextStepGuidance({
      workflow: "inspiredesign",
      reasonCode: "zero_ranked_references",
      requestedProviders: ["social/pinterest"],
      siteRecipeId: "social/pinterest",
      referenceUrls: [
        "https://www.pinterest.com/search/pins/?q=studio",
        "https://www.pinterest.com/studio/pins/"
      ],
      query: "fashion studio landing page",
      evidence: { referenceCount: 2, rankedReferenceCount: 0, rejectedReferenceCount: 2 }
    });

    const command = guidance.commands[0]?.command ?? "";
    expect(command).toContain("--query \"fashion studio landing page\"");
    expect(command).toContain("--provider social/pinterest");
    expect(command).not.toContain("--url");
  });

  it("does not route all-rejected generic evidence to Canvas handoff", () => {
    const guidance = routeNextStepGuidance({
      workflow: "inspiredesign",
      reasonCode: "zero_ranked_references",
      evidence: { referenceCount: 2, rankedReferenceCount: 0, rejectedReferenceCount: 2 }
    });

    expect(guidance.id).toBe("inspiredesign.harvest.zero_ranked_references");
    expect(guidance.readiness).toBe("needs_recovery");
    expect(guidance.commands.map((entry) => entry.id)).not.toContain("canvas-session-open");
  });

  it("routes generic Inspired Design evidence recovery variants", () => {
    const providerGuidance = routeNextStepGuidance({
      workflow: "inspiredesign",
      reasonCode: "provider_unavailable",
      providerUnavailable: true,
      evidence: { referenceCount: 0, rankedReferenceCount: 0 }
    });
    const diagnosticGuidance = routeNextStepGuidance({
      workflow: "inspiredesign",
      reasonCode: "diagnostic_only",
      evidence: { referenceCount: 1, rankedReferenceCount: 0, diagnosticOnlyReasons: ["cookie_or_consent_modal"] }
    });
    const zeroGuidance = routeNextStepGuidance({
      workflow: "inspiredesign",
      reasonCode: "zero_references",
      evidence: { referenceCount: 0, rankedReferenceCount: 0 }
    });
    const failedCaptureGuidance = routeNextStepGuidance({
      workflow: "inspiredesign",
      reasonCode: "failed_capture",
      evidence: {
        referenceCount: 1,
        rankedReferenceCount: 1,
        visualEvidenceRequired: true,
        failedCaptureCount: 1,
        topReferenceScore: 82,
        topReferenceConfidence: 0.82
      }
    });

    expect(providerGuidance.id).toBe("inspiredesign.harvest.provider_unavailable");
    expect(diagnosticGuidance.id).toBe("inspiredesign.harvest.diagnostic_only");
    expect(zeroGuidance.id).toBe("inspiredesign.harvest.zero_references");
    expect(failedCaptureGuidance.id).toBe("inspiredesign.harvest.failed_capture");
    expect(failedCaptureGuidance.readiness).toBe("needs_recovery");
  });

  it("does not route required missing screenshots to Canvas handoff", () => {
    const guidance = routeNextStepGuidance({
      workflow: "inspiredesign",
      reasonCode: "failed_capture",
      evidence: {
        referenceCount: 1,
        rankedReferenceCount: 1,
        visualEvidenceRequired: true,
        missingScreenshotCount: 1,
        topReferenceScore: 82,
        topReferenceConfidence: 0.82
      }
    });

    expect(guidance.id).toBe("inspiredesign.harvest.failed_capture");
    expect(guidance.readiness).toBe("needs_recovery");
    expect(guidance.commands.map((entry) => entry.id)).not.toContain("canvas-session-open");
  });

  it("routes non-Pinterest Inspired Design recovery with explicit non-cookie command flags", () => {
    const guidance = routeNextStepGuidance({
      workflow: "inspiredesign",
      reasonCode: "weak_reference",
      requestedProviders: ["web/default"],
      query: "editorial photography landing page references",
      browserMode: "managed",
      useCookies: true,
      evidence: { referenceCount: 1, rankedReferenceCount: 1, topReferenceScore: 42, topReferenceConfidence: 0.4 },
      details: {
        brief: "Create a premium photography studio landing page"
      }
    });

    expect(guidance.id).toBe("inspiredesign.harvest.weak_reference");
    expect(guidance.commands[0]?.command).toContain("--brief \"Create a premium photography studio landing page\"");
    expect(guidance.commands[0]?.command).toContain("--query \"editorial photography landing page references\"");
    expect(guidance.commands[0]?.command).toContain("--provider web/default");
    expect(guidance.commands[0]?.command).toContain("--browser-mode managed --use-cookies");
    expect(guidance.paramsExamples[0]?.params).toMatchObject({
      browserMode: "managed"
    });
  });

  it("uses generic evidence recovery for mixed-provider weak evidence that is not Pinterest-scoped", () => {
    const guidance = routeNextStepGuidance({
      workflow: "inspiredesign",
      reasonCode: "weak_reference",
      requestedProviders: ["web/default", "social/pinterest"],
      siteRecipeId: "social/pinterest",
      evidence: {
        referenceCount: 1,
        rankedReferenceCount: 1,
        topReferenceScore: 20,
        topReferenceConfidence: 0.2
      }
    });

    expect(guidance.id).toBe("inspiredesign.harvest.weak_reference");
    expect(guidance.reasonCode).toBe("weak_reference");
    expect(guidance.commands[0]?.command).toContain("--provider web/default");
    expect(guidance.commands[0]?.command).not.toContain("--provider social/pinterest");
    expect(guidance.commands[0]?.command).toContain("--browser-mode managed");
    expect(guidance.commands[0]?.command).not.toContain("--cookie-policy required");
    expect(guidance.paramsExamples[0]?.params).not.toMatchObject({
      useCookies: true,
      cookiePolicy: "required"
    });
  });

  it("uses generic provider recovery for mixed-provider unavailable evidence", () => {
    const guidance = routeNextStepGuidance({
      workflow: "inspiredesign",
      reasonCode: "provider_unavailable",
      requestedProviders: ["web/default", "social/pinterest"],
      siteRecipeId: "social/pinterest",
      providerUnavailable: true,
      evidence: {
        referenceCount: 0,
        rankedReferenceCount: 0
      }
    });

    expect(guidance.id).toBe("inspiredesign.harvest.provider_unavailable");
    expect(guidance.reasonCode).toBe("provider_unavailable");
    expect(guidance.commands[0]?.command).toContain("--provider web/default");
    expect(guidance.commands[0]?.command).toContain("--browser-mode managed");
    expect(guidance.commands[0]?.command).not.toContain("--provider social/pinterest");
    expect(guidance.commands[0]?.command).not.toContain("--cookie-policy required");
  });

  it("uses generic provider recovery for mixed-provider unavailable evidence regardless of provider order", () => {
    const guidance = routeNextStepGuidance({
      workflow: "inspiredesign",
      reasonCode: "provider_unavailable",
      requestedProviders: ["social/pinterest", "web/default"],
      siteRecipeId: "social/pinterest",
      providerUnavailable: true,
      evidence: {
        referenceCount: 0,
        rankedReferenceCount: 0
      }
    });

    expect(guidance.id).toBe("inspiredesign.harvest.provider_unavailable");
    expect(guidance.reasonCode).toBe("provider_unavailable");
    expect(guidance.commands[0]?.command).toContain("--provider web/default");
    expect(guidance.commands[0]?.command).toContain("--browser-mode managed");
    expect(guidance.commands[0]?.command).not.toContain("--provider social/pinterest");
    expect(guidance.commands[0]?.command).not.toContain("--cookie-policy required");
  });

  it("uses generic weak-reference recovery for mixed-provider evidence regardless of provider order", () => {
    const guidance = routeNextStepGuidance({
      workflow: "inspiredesign",
      reasonCode: "weak_reference",
      requestedProviders: ["social/pinterest", "web/default"],
      siteRecipeId: "social/pinterest",
      evidence: {
        referenceCount: 1,
        rankedReferenceCount: 1,
        topReferenceScore: 20,
        topReferenceConfidence: 0.2
      }
    });

    expect(guidance.id).toBe("inspiredesign.harvest.weak_reference");
    expect(guidance.reasonCode).toBe("weak_reference");
    expect(guidance.commands[0]?.command).toContain("--provider web/default");
    expect(guidance.commands[0]?.command).toContain("--browser-mode managed");
    expect(guidance.commands[0]?.command).not.toContain("--provider social/pinterest");
    expect(guidance.commands[0]?.command).not.toContain("--cookie-policy required");
  });

  it("routes exported provider and CLI validation contexts", () => {
    const providerGuidance = routeNextStepGuidance({
      workflow: "provider",
      reasonCode: "auth_required",
      requestedProviders: ["social/example"],
      browserMode: "extension",
      useCookies: true
    });
    const cliGuidance = routeNextStepGuidance({
      workflow: "cli",
      reasonCode: "missing_params"
    });

    expect(providerGuidance.id).toBe("provider.auth_required");
    expect(providerGuidance.commands[0]?.command).toBe("npx opendevbrowser help");
    expectRunnableCommands(providerGuidance);
    expect(cliGuidance.id).toBe("cli.missing_params");
    expect(cliGuidance.commands[0]?.command).toBe("npx opendevbrowser help");
    expectRunnableCommands(cliGuidance);
  });

  it("uses a typed default reason for sparse CLI validation contexts", () => {
    const guidance = routeNextStepGuidance({ workflow: "cli" });

    expect(guidance.id).toBe("cli.validation_error");
    expect(guidance.reasonCode).toBe("validation_error");
    expect(guidance.commands[0]?.command).toBe("npx opendevbrowser help");
    expectRunnableCommands(guidance);
  });

  it("renders sparse provider recovery with typed defaults", () => {
    const guidance = routeNextStepGuidance({ workflow: "provider" });

    expect(guidance.id).toBe("provider.provider_recovery");
    expect(guidance.severity).toBe("warning");
    expect(guidance.paramsExamples[0]?.params).toEqual(expect.objectContaining({
      providers: "provider diagnostics",
      reasonCode: "provider_recovery",
      browserMode: "extension",
      useCookies: false
    }));
    expectRunnableCommands(guidance);
  });

  it("throws when no recipe matches the context", () => {
    expect(() => new GuidanceRouter([]).route({
      workflow: "unknown" as never,
      reasonCode: "unknown"
    })).toThrow("No guidance recipe matched workflow unknown.");
  });
});
