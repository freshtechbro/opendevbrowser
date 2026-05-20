import { describe, expect, it } from "vitest";
import {
  buildCanvasCommandValidationEnvelope,
  buildCanvasMissingIdentifierEnvelope,
  buildCanvasRepairEnvelope
} from "../src/canvas/repair-examples";

const commandsFromEnvelope = (envelope: ReturnType<typeof buildCanvasRepairEnvelope>): string[] => {
  const nextStepGuidance = envelope.nextStepGuidance as { commands?: Array<{ command?: string }> };
  return nextStepGuidance.commands?.map((command) => command.command ?? "") ?? [];
};

describe("Canvas repair examples", () => {
  it("renders governance repair commands, params, checks, and blockers", () => {
    const envelope = buildCanvasRepairEnvelope({ reasonCode: "governance_missing" });
    const commands = commandsFromEnvelope(envelope);

    expect(envelope.code).toBe("governance_missing");
    expect(envelope.recommendedNextCommands).toEqual([
      "canvas.document.patch",
      "canvas.preview.render",
      "canvas.document.save"
    ]);
    expect(envelope.nextStepGuidance).toEqual(expect.objectContaining({
      readiness: "needs_recovery",
      severity: "warning"
    }));
    expect(envelope.guidance.recommendedNextCommands).toEqual(envelope.recommendedNextCommands);
    expect(envelope.guidance.reason).toBe(envelope.message);
    expect(envelope.guidance.nextStepGuidance).toEqual(envelope.nextStepGuidance);
    expect(envelope.guidance.paramsExamples).toEqual(envelope.paramsExamples);
    expect(envelope.paramsExamples.map((example) => example.id)).toContain("canvas-governance-intent-patch");
    expect(envelope.validationChecks.map((check) => check.id)).toContain("intent-present");
    expect(envelope.doNotProceedIf).toContain("intent or other required governance blocks are still missing");
    expect(commands).toEqual(expect.arrayContaining([
      expect.stringContaining("--params '{\"canvasSessionId\":\"canvas-session-from-session-open\"")
    ]));
    expect(commands.join("\n")).not.toContain("--params-file");
    expect(commands.join("\n")).not.toMatch(/<[^>]+>/);
  });

  it("prioritizes typed generation-plan issue examples and falls back for unknown paths", () => {
    const circularValue: Record<string, unknown> = {};
    circularValue.self = circularValue;
    const envelope = buildCanvasRepairEnvelope({
      reasonCode: "generation_plan_invalid",
      issues: [
        {
          path: "targetOutcome.unknown",
          code: "missing_required",
          message: "Nested detail is not part of the example plan."
        },
        {
          path: "targetOutcome",
          code: "missing_required",
          message: "Target outcome should use the typed example object."
        },
        {
          path: "targetOutcome.mode",
          code: "invalid_type",
          message: "Mode must be a string.",
          expected: "string",
          received: 7
        },
        {
          path: "validationTargets.browserValidation",
          code: "invalid_value",
          message: "Browser validation must be required.",
          expected: ["required", "manual"]
        },
        {
          path: "contentStrategy.source",
          code: "invalid_type",
          message: "Source must be a string.",
          received: circularValue
        }
      ]
    });

    expect(envelope.fieldExamples.map((example) => example.path)).toEqual([
      "generationPlan.validationTargets.browserValidation",
      "generationPlan.targetOutcome.mode",
      "generationPlan.contentStrategy.source",
      "generationPlan.targetOutcome.unknown",
      "generationPlan.targetOutcome"
    ]);
    expect(envelope.fieldExamples[0]).toEqual(expect.objectContaining({
      expected: "required | manual",
      example: "required"
    }));
    expect(envelope.fieldExamples[1]).toEqual(expect.objectContaining({
      expected: "string",
      received: "7"
    }));
    expect(envelope.fieldExamples[2]).toEqual(expect.objectContaining({
      example: "design brief, harvested references, and current project content",
      received: "[object Object]"
    }));
    expect(envelope.fieldExamples[3]?.example).toBe("<valid value>");
  });

  it("uses missing generation-plan fields as typed field examples when issue details are absent", () => {
    const envelope = buildCanvasRepairEnvelope({
      reasonCode: "generation_plan_invalid",
      missingFields: ["targetOutcome.mode", "generationPlan.validationTargets.blockOn", "unknown.path"]
    });

    expect(envelope.fieldExamples.map((example) => example.path)).toEqual([
      "generationPlan.targetOutcome.mode",
      "generationPlan.validationTargets.blockOn",
      "generationPlan.unknown.path"
    ]);
    expect(envelope.fieldExamples[0]).toEqual(expect.objectContaining({
      example: "high-fi-live-edit",
      expected: "valid Canvas generation plan field"
    }));
    expect(envelope.fieldExamples[1]?.example).toEqual(["contrast-failure", "missing-intent", "missing-design-language"]);
    expect(envelope.fieldExamples[2]?.example).toBe("<valid value>");
  });

  it("blocks document load when both documentId and repoPath are missing", () => {
    const envelope = buildCanvasCommandValidationEnvelope("canvas.document.load", {
      canvasSessionId: "session-1",
      leaseId: "lease-1"
    });

    expect(envelope?.code).toBe("missing_document_id");
    expect(envelope?.validationChecks.map((check) => check.id)).toContain("document-target-selected");
    expect(envelope?.doNotProceedIf).toContain("documentId and repoPath are both missing");
  });

  it("does not require identifiers for unknown Canvas commands", () => {
    expect(buildCanvasCommandValidationEnvelope("canvas.unknown", {})).toBeNull();
  });

  it("does not require identifiers before opening a Canvas session", () => {
    expect(buildCanvasCommandValidationEnvelope("canvas.session.open", {})).toBeNull();
  });

  it("does not require identifiers for public Canvas starter catalog listing", () => {
    expect(buildCanvasCommandValidationEnvelope("canvas.starter.list", {})).toBeNull();
  });

  it("returns typed session repair guidance for capability diagnostics without a session", () => {
    const envelope = buildCanvasCommandValidationEnvelope("canvas.capabilities.get", {});

    expect(envelope?.code).toBe("missing_canvas_session_id");
    expect(envelope?.recommendedNextCommands).toEqual(["canvas.session.open", "canvas.capabilities.get"]);
    expect(envelope?.guidance.nextStepGuidance).toEqual(expect.objectContaining({
      readiness: "needs_input",
      reasonCode: "missing_canvas_session_id"
    }));
    expect(envelope ? commandsFromEnvelope(envelope).join("\n") : "").not.toMatch(/<[^>]+>|--params-file/);
  });

  it("uses the blocked Canvas command in missing-lease params examples", () => {
    const envelope = buildCanvasCommandValidationEnvelope("canvas.document.patch", {
      canvasSessionId: "session-1"
    });

    expect(envelope?.code).toBe("missing_lease_id");
    expect(envelope?.recommendedNextCommands).toEqual(["canvas.session.attach", "canvas.document.patch"]);
    expect(envelope?.paramsExamples.map((example) => example.command)).toEqual([
      "canvas.session.attach",
      "canvas.document.patch"
    ]);
    expect(envelope?.paramsExamples[1]?.params).toEqual(expect.objectContaining({
      canvasSessionId: "canvas-session-from-session-open",
      leaseId: "lease-from-session-open",
      patches: expect.any(Array)
    }));
  });

  it("recommends the blocked Canvas command after lease repair", () => {
    const envelope = buildCanvasCommandValidationEnvelope("canvas.document.patch", {
      canvasSessionId: "session-1"
    });

    expect(envelope?.code).toBe("missing_lease_id");
    expect(envelope?.recommendedNextCommands).toEqual(["canvas.session.attach", "canvas.document.patch"]);
    const commands = envelope ? commandsFromEnvelope(envelope).join("\n") : "";
    expect(commands).toContain("--command canvas.session.attach");
    expect(commands).toContain("--command canvas.document.patch");
    expect(commands).not.toMatch(/<[^>]+>|--params-file/);
  });

  it("covers typed examples for other lease-repaired Canvas commands", () => {
    const attachEnvelope = buildCanvasRepairEnvelope({
      reasonCode: "missing_lease_id",
      blockedCommand: "canvas.session.attach"
    });
    const loadEnvelope = buildCanvasRepairEnvelope({
      reasonCode: "missing_lease_id",
      blockedCommand: "canvas.document.load"
    });
    const planGetEnvelope = buildCanvasRepairEnvelope({
      reasonCode: "missing_lease_id",
      blockedCommand: "canvas.plan.get"
    });
    const planSetEnvelope = buildCanvasRepairEnvelope({
      reasonCode: "missing_lease_id",
      blockedCommand: "canvas.plan.set"
    });
    const fallbackCanvasEnvelope = buildCanvasRepairEnvelope({
      reasonCode: "missing_lease_id",
      blockedCommand: "canvas.history.undo"
    });

    expect(attachEnvelope.paramsExamples).toEqual([
      expect.objectContaining({ command: "canvas.session.attach" }),
      expect.objectContaining({ command: "canvas.plan.set" })
    ]);
    expect(loadEnvelope.paramsExamples[1]).toEqual(expect.objectContaining({
      command: "canvas.document.load",
      params: expect.objectContaining({ documentId: "document-from-session-open" })
    }));
    expect(planGetEnvelope.paramsExamples[1]).toEqual(expect.objectContaining({
      command: "canvas.plan.get",
      params: expect.objectContaining({ canvasSessionId: "canvas-session-from-session-open" })
    }));
    expect(planSetEnvelope.paramsExamples[1]).toEqual(expect.objectContaining({
      command: "canvas.plan.set",
      params: expect.objectContaining({ generationPlan: expect.any(Object) })
    }));
    expect(fallbackCanvasEnvelope.paramsExamples[1]).toEqual(expect.objectContaining({
      command: "canvas.history.undo",
      params: expect.objectContaining({ leaseId: "lease-from-session-open" })
    }));
  });

  it("renders safe defaults for non-canvas blocked commands and direct missing-id envelopes", () => {
    const nonCanvasEnvelope = buildCanvasRepairEnvelope({
      reasonCode: "missing_canvas_session_id",
      blockedCommand: "workflow.retry"
    });
    const directEnvelope = buildCanvasMissingIdentifierEnvelope("documentId");
    const nonCanvasCommands = commandsFromEnvelope(nonCanvasEnvelope).join("\n");

    expect(nonCanvasEnvelope.recommendedNextCommands).toEqual(["canvas.session.open", "workflow.retry"]);
    expect(nonCanvasEnvelope.nextStepGuidance).toEqual(expect.objectContaining({
      reasonCode: "missing_canvas_session_id"
    }));
    expect(nonCanvasCommands).toContain("--command canvas.plan.set");
    expect(directEnvelope.code).toBe("missing_document_id");
    expect(directEnvelope.recommendedNextCommands).toEqual(["canvas.document.load"]);
  });
});
