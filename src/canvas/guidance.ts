import type { JsonValue } from "../providers/types";
import type {
  GuidanceFieldExample,
  GuidanceParamsExample,
  GuidanceValidationCheck
} from "../guidance/types";
import { buildCanvasRepairEnvelope } from "./repair-examples";

export type CanvasNextStepGuidance = {
  recommendedNextCommands: string[];
  reason: string;
  nextStepGuidance?: Record<string, JsonValue>;
  paramsExamples?: GuidanceParamsExample[];
  fieldExamples?: GuidanceFieldExample[];
  validationChecks?: GuidanceValidationCheck[];
  doNotProceedIf?: string[];
};

export type CanvasGuidanceCommand =
  | "canvas.session.open"
  | "canvas.capabilities.get"
  | "canvas.plan.set"
  | "canvas.plan.get"
  | "canvas.document.load"
  | "canvas.document.patch"
  | "canvas.preview.render"
  | "canvas.preview.refresh"
  | "canvas.feedback.poll"
  | "canvas.document.save"
  | "canvas.document.export";

type CanvasBlockerGuidanceCode =
  | "plan_required"
  | "generation_plan_invalid"
  | "revision_conflict"
  | "policy_violation"
  | "unsupported_target"
  | "lease_reclaim_required";

const withRepairEnvelope = (
  guidance: Pick<CanvasNextStepGuidance, "recommendedNextCommands" | "reason">,
  envelope: ReturnType<typeof buildCanvasRepairEnvelope>
): CanvasNextStepGuidance => ({
  ...guidance,
  nextStepGuidance: envelope.nextStepGuidance,
  paramsExamples: envelope.paramsExamples,
  fieldExamples: envelope.fieldExamples,
  validationChecks: envelope.validationChecks,
  doNotProceedIf: envelope.doNotProceedIf
});

export const PREPLAN_CANVAS_GUIDANCE: CanvasNextStepGuidance = withRepairEnvelope({
  recommendedNextCommands: ["canvas.plan.set"],
  reason: "Handshake is complete. Submit a complete generationPlan before mutation."
}, buildCanvasRepairEnvelope({ reasonCode: "plan_required" }));

export const INVALID_PLAN_CANVAS_GUIDANCE: CanvasNextStepGuidance = withRepairEnvelope({
  recommendedNextCommands: ["canvas.plan.set"],
  reason: "generationPlan is invalid. Submit a supported plan before mutation."
}, buildCanvasRepairEnvelope({ reasonCode: "generation_plan_invalid" }));

export const PLAN_ACCEPTED_CANVAS_GUIDANCE: CanvasNextStepGuidance = {
  recommendedNextCommands: ["canvas.document.patch", "canvas.preview.render", "canvas.feedback.poll", "canvas.document.save"],
  reason: "generationPlan is accepted. Patch the document, render the preview, inspect feedback, and save when the iteration is stable."
};

export const PATCH_APPLIED_CANVAS_GUIDANCE: CanvasNextStepGuidance = {
  recommendedNextCommands: ["canvas.preview.render", "canvas.feedback.poll", "canvas.document.save"],
  reason: "The patch is applied. Render the preview, review feedback, and save when the surface is ready."
};

export const PREVIEW_READY_CANVAS_GUIDANCE: CanvasNextStepGuidance = {
  recommendedNextCommands: ["canvas.feedback.poll", "canvas.document.patch", "canvas.document.save"],
  reason: "Preview output is available. Poll feedback, patch again if needed, and save when the runtime matches the contract."
};

export const FEEDBACK_LOOP_CANVAS_GUIDANCE: CanvasNextStepGuidance = {
  recommendedNextCommands: ["canvas.document.patch", "canvas.preview.render", "canvas.document.save"],
  reason: "Feedback is available. Patch the document to address issues, rerender, and save when blockers are cleared."
};

export const PERSISTED_CANVAS_GUIDANCE: CanvasNextStepGuidance = {
  recommendedNextCommands: ["canvas.document.export", "canvas.session.status", "canvas.document.patch"],
  reason: "The document is persisted. Export deliverables, inspect session state, or keep iterating with another patch."
};

export const EXPORTED_CANVAS_GUIDANCE: CanvasNextStepGuidance = {
  recommendedNextCommands: ["canvas.session.status", "canvas.document.patch"],
  reason: "Artifacts are exported. Inspect session state or continue patching if another iteration is required."
};

export const CANVAS_GUIDANCE_BY_COMMAND: Partial<Record<CanvasGuidanceCommand, CanvasNextStepGuidance>> = {
  "canvas.document.patch": PATCH_APPLIED_CANVAS_GUIDANCE,
  "canvas.preview.render": PREVIEW_READY_CANVAS_GUIDANCE,
  "canvas.preview.refresh": PREVIEW_READY_CANVAS_GUIDANCE,
  "canvas.feedback.poll": FEEDBACK_LOOP_CANVAS_GUIDANCE,
  "canvas.document.save": PERSISTED_CANVAS_GUIDANCE,
  "canvas.document.export": EXPORTED_CANVAS_GUIDANCE
};

const CANVAS_REQUIRED_COMMANDS_BY_BLOCKER: Record<CanvasBlockerGuidanceCode, string[]> = {
  plan_required: ["canvas.plan.set"],
  generation_plan_invalid: ["canvas.plan.set", "canvas.plan.get"],
  revision_conflict: ["canvas.document.load"],
  policy_violation: ["canvas.plan.get", "canvas.document.load"],
  unsupported_target: ["canvas.session.status"],
  lease_reclaim_required: ["canvas.session.status"]
};

const cloneCanvasGuidance = (guidance: CanvasNextStepGuidance): CanvasNextStepGuidance => ({
  recommendedNextCommands: [...guidance.recommendedNextCommands],
  reason: guidance.reason,
  ...(guidance.nextStepGuidance ? { nextStepGuidance: structuredClone(guidance.nextStepGuidance) } : {}),
  ...(guidance.paramsExamples ? { paramsExamples: structuredClone(guidance.paramsExamples) } : {}),
  ...(guidance.fieldExamples ? { fieldExamples: structuredClone(guidance.fieldExamples) } : {}),
  ...(guidance.validationChecks ? { validationChecks: structuredClone(guidance.validationChecks) } : {}),
  ...(guidance.doNotProceedIf ? { doNotProceedIf: [...guidance.doNotProceedIf] } : {})
});

export const buildCanvasCommandGuidance = (input: {
  planStatus: string;
  command: CanvasGuidanceCommand;
}): CanvasNextStepGuidance => {
  if (input.planStatus === "invalid") {
    return cloneCanvasGuidance(INVALID_PLAN_CANVAS_GUIDANCE);
  }
  if (input.planStatus !== "accepted") {
    return cloneCanvasGuidance(PREPLAN_CANVAS_GUIDANCE);
  }
  return cloneCanvasGuidance(CANVAS_GUIDANCE_BY_COMMAND[input.command] ?? PLAN_ACCEPTED_CANVAS_GUIDANCE);
};

export const getCanvasRequiredNextCommands = (code: CanvasBlockerGuidanceCode): string[] => (
  [...CANVAS_REQUIRED_COMMANDS_BY_BLOCKER[code]]
);
