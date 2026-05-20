import { describe, expect, it } from "vitest";
import {
  renderCliGuidance,
  renderDaemonReadinessText,
  renderProviderConstraintCompatibility,
  renderWorkflowCompatibility
} from "../src/guidance/renderers";
import { routeNextStepGuidance } from "../src/guidance/router";
import type { NextStepGuidance } from "../src/guidance/types";

describe("guidance renderers", () => {
  it("renders compatibility fields from typed guidance", () => {
    const guidance = routeNextStepGuidance({
      workflow: "inspiredesign",
      reasonCode: "zero_references",
      evidence: { referenceCount: 0 }
    });

    const compatibility = renderWorkflowCompatibility(guidance, "summary");
    expect(compatibility.followthroughSummary).toBe("summary");
    expect(compatibility.suggestedNextAction).toBe(guidance.primaryAction.summary);
    expect(compatibility.suggestedSteps[0]?.command).toContain("inspiredesign harvest");
  });

  it("renders provider compatibility without losing typed guidance", () => {
    const guidance = routeNextStepGuidance({
      workflow: "inspiredesign",
      reasonCode: "failed_capture",
      evidence: { referenceCount: 1, rankedReferenceCount: 0, failedCaptureCount: 1, visualEvidenceRequired: true }
    });

    const compatibility = renderProviderConstraintCompatibility(guidance);
    expect(compatibility.recommendedNextCommands[0]).toContain("inspiredesign harvest");
    expect(compatibility.nextStepGuidance.readiness).toBe("needs_recovery");
  });

  it("renders CLI and daemon text across optional assertion branches", () => {
    const guidance = routeNextStepGuidance({
      workflow: "canvas",
      reasonCode: "missing_document_id",
      details: { command: "canvas.plan.set" }
    });

    expect(renderCliGuidance(guidance)).toContain("Run:");
    expect(renderDaemonReadinessText(guidance)).toContain("Validate with");

    const noAssertionGuidance: NextStepGuidance = {
      ...guidance,
      validationChecks: [{ id: "description-only", description: "Check daemon status first." }]
    };
    expect(renderCliGuidance(noAssertionGuidance)).toContain("Check: Check daemon status first.");
    expect(renderDaemonReadinessText(noAssertionGuidance)).toContain("Check daemon status first.");

    const noChecksGuidance: NextStepGuidance = {
      ...guidance,
      validationChecks: []
    };
    expect(renderDaemonReadinessText(noChecksGuidance)).toBe(guidance.primaryAction.summary);
  });

  it("renders workflow compatibility without fallback summaries and with validation commands", () => {
    const guidance = routeNextStepGuidance({
      workflow: "daemon",
      reasonCode: "daemon_fingerprint_mismatch"
    });
    const withCommand: NextStepGuidance = {
      ...guidance,
      validationChecks: [{
        id: "status",
        description: "Verify the daemon fingerprint.",
        command: "npx opendevbrowser status --daemon --output-format json"
      }]
    };

    const compatibility = renderWorkflowCompatibility(withCommand);
    expect(compatibility.followthroughSummary).toBe(guidance.primaryAction.summary);
    expect(compatibility.suggestedSteps.at(-1)).toEqual(expect.objectContaining({
      command: "npx opendevbrowser status --daemon --output-format json"
    }));
  });

  it("renders research and generation-plan recipes with default typed examples", () => {
    const researchGuidance = routeNextStepGuidance({
      workflow: "research",
      reasonCode: "gated_provider"
    });
    expect(researchGuidance.primaryAction.summary).toContain("gated providers");
    expect(researchGuidance.commands[0]?.command).toContain("--topic \"browser automation provider recovery\"");
    expect(researchGuidance.commands[0]?.command).toContain("--browser-mode extension");
    expect(researchGuidance.commands[0]?.command).not.toMatch(/<[^>]+>/);

    const invalidPlanGuidance = routeNextStepGuidance({
      workflow: "canvas",
      reasonCode: "generation_plan_invalid",
      details: { missingFields: ["targetOutcome.mode", 7, "validationTargets.blockOn"] }
    });
    expect(invalidPlanGuidance.id).toBe("canvas.generation_plan_invalid");
    expect(invalidPlanGuidance.paramsExamples[0]?.params).toEqual(expect.objectContaining({
      generationPlan: expect.objectContaining({
        targetOutcome: expect.objectContaining({ mode: "high-fi-live-edit" })
      })
    }));
    expect(invalidPlanGuidance.fieldExamples.map((example) => example.path)).toEqual([
      "generationPlan.targetOutcome.mode",
      "generationPlan.validationTargets.blockOn"
    ]);

    const invalidPlanGuidanceWithoutArray = routeNextStepGuidance({
      workflow: "canvas",
      reasonCode: "generation_plan_invalid",
      details: { missingFields: "targetOutcome.mode" }
    });
    expect(invalidPlanGuidanceWithoutArray.fieldExamples[0]?.path).toBe("designGovernance.intent");
  });
});
