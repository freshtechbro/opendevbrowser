import type { JsonValue } from "../providers/types";
import type {
  GuidanceFieldExample,
  GuidanceParamsExample,
  GuidanceValidationCheck,
  NextStepGuidance
} from "../guidance/types";
import { renderWorkflowGuidance } from "../guidance/renderers";
import type {
  CanvasGenerationPlan,
  CanvasGenerationPlanIssue
} from "./types";

const EXAMPLE_MAX_INTERACTION_LATENCY_MS = 150;
const MAX_ISSUE_FIELD_EXAMPLES = 8;

export type CanvasRepairReasonCode =
  | "plan_required"
  | "generation_plan_invalid"
  | "governance_missing"
  | "missing_canvas_session_id"
  | "missing_lease_id"
  | "missing_document_id";

export type CanvasMissingIdentifier = "canvasSessionId" | "leaseId" | "documentId";

export type CanvasRepairGuidancePayload = {
  recommendedNextCommands: string[];
  reason: string;
  nextStepGuidance: Record<string, JsonValue>;
  paramsExamples: GuidanceParamsExample[];
  fieldExamples: GuidanceFieldExample[];
  validationChecks: GuidanceValidationCheck[];
  doNotProceedIf: string[];
};

export type CanvasRepairEnvelope = {
  code: CanvasRepairReasonCode;
  message: string;
  recommendedNextCommands: string[];
  guidance: CanvasRepairGuidancePayload;
  nextStepGuidance: Record<string, JsonValue>;
  paramsExamples: GuidanceParamsExample[];
  fieldExamples: GuidanceFieldExample[];
  validationChecks: GuidanceValidationCheck[];
  doNotProceedIf: string[];
};

export const EXAMPLE_CANVAS_GENERATION_PLAN: CanvasGenerationPlan = {
  targetOutcome: {
    mode: "high-fi-live-edit",
    summary: "Produce an evidence-backed, responsive landing page iteration."
  },
  visualDirection: {
    profile: "cinematic-minimal",
    themeStrategy: "single-theme"
  },
  layoutStrategy: {
    approach: "hero-led composition with clear content sections",
    navigationModel: "global-header"
  },
  contentStrategy: {
    source: "design brief, harvested references, and current project content"
  },
  componentStrategy: {
    mode: "reuse existing components before creating new primitives",
    interactionStates: ["default", "hover", "focus", "disabled"]
  },
  motionPosture: {
    level: "subtle",
    reducedMotion: "respect-user-preference"
  },
  responsivePosture: {
    primaryViewport: "desktop",
    requiredViewports: ["desktop", "tablet", "mobile"]
  },
  accessibilityPosture: {
    target: "WCAG_2_2_AA",
    keyboardNavigation: "full"
  },
  validationTargets: {
    blockOn: ["contrast-failure", "missing-intent", "missing-design-language"],
    requiredThemes: ["light"],
    browserValidation: "required",
    maxInteractionLatencyMs: EXAMPLE_MAX_INTERACTION_LATENCY_MS
  },
  interactionMoments: ["primary CTA hover", "keyboard focus ring", "mobile navigation open"],
  materialEffects: ["soft depth on primary surfaces"],
  designVectors: {
    density: "editorial",
    imagery: "dominant first-viewport visual plane"
  }
};

const exampleIds = {
  canvasSessionId: "canvas-session-from-session-open",
  leaseId: "lease-from-session-open",
  documentId: "document-from-session-open"
} as const;

const stringifyReceived = (value: unknown): string | undefined => {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const toExpectedString = (value: string | string[] | undefined): string | undefined => {
  if (Array.isArray(value)) return value.join(" | ");
  return value;
};

const commandForReason = (reasonCode: CanvasRepairReasonCode, blockedCommand?: string): string[] => {
  const retryCommand = blockedCommand && blockedCommand !== "canvas.session.attach" ? blockedCommand : "canvas.plan.set";
  if (reasonCode === "missing_canvas_session_id") return ["canvas.session.open", retryCommand];
  if (reasonCode === "missing_lease_id") return ["canvas.session.attach", retryCommand];
  if (reasonCode === "missing_document_id") return ["canvas.document.load"];
  if (reasonCode === "governance_missing") return ["canvas.document.patch", "canvas.preview.render", "canvas.document.save"];
  return ["canvas.plan.set", "canvas.plan.get"];
};

const titleForReason = (reasonCode: CanvasRepairReasonCode): string => {
  if (reasonCode === "missing_canvas_session_id") return "Open a Canvas session before running this command.";
  if (reasonCode === "missing_lease_id") return "Attach to the Canvas session and include the active leaseId.";
  if (reasonCode === "missing_document_id") return "Load a Canvas document by documentId or repoPath before continuing.";
  if (reasonCode === "governance_missing") return "Patch missing governance blocks before mutation, preview, or save.";
  if (reasonCode === "plan_required") return "Submit a valid generationPlan before mutating the Canvas document.";
  return "Repair generationPlan and resubmit canvas.plan.set.";
};

const labelForCommand = (command: string): string => {
  switch (command) {
    case "canvas.session.open":
      return "Open a Canvas session";
    case "canvas.session.attach":
      return "Attach or reclaim a Canvas lease";
    case "canvas.document.load":
      return "Load the target Canvas document";
    case "canvas.document.patch":
      return "Patch missing governance";
    case "canvas.plan.get":
      return "Inspect the current plan status";
    case "canvas.plan.set":
      return "Submit a valid generationPlan";
    default:
      return command.startsWith("canvas.") ? `Retry ${command}` : "Submit a valid generationPlan";
  }
};

const shellSingleQuote = (value: string): string => `'${value.replaceAll("'", "'\"'\"'")}'`;

const inlineParamsFlag = (params: Record<string, JsonValue>): string => (
  ` --params ${shellSingleQuote(JSON.stringify(params))}`
);

const buildCanvasSessionParamsExample = (): Record<string, JsonValue> => ({
  canvasSessionId: exampleIds.canvasSessionId,
  leaseId: exampleIds.leaseId
});

const cliForCommand = (command: string): string => {
  switch (command) {
    case "canvas.session.open":
      return "npx opendevbrowser canvas --command canvas.session.open --output-format json";
    case "canvas.session.attach":
      return `npx opendevbrowser canvas --command canvas.session.attach${inlineParamsFlag(buildAttachParamsExample())} --output-format json`;
    case "canvas.document.load":
      return `npx opendevbrowser canvas --command canvas.document.load${inlineParamsFlag(buildDocumentLoadParamsExample())} --output-format json`;
    case "canvas.document.patch":
      return `npx opendevbrowser canvas --command canvas.document.patch${inlineParamsFlag(buildCanvasGovernancePatchParamsExample())} --output-format json`;
    case "canvas.plan.get":
      return `npx opendevbrowser canvas --command canvas.plan.get${inlineParamsFlag(buildCanvasSessionParamsExample())} --output-format json`;
    case "canvas.plan.set":
      return `npx opendevbrowser canvas --command canvas.plan.set${inlineParamsFlag(buildCanvasPlanSetParamsExample())} --output-format json`;
    default:
      if (command.startsWith("canvas.")) {
        return `npx opendevbrowser canvas --command ${command}${inlineParamsFlag(buildCanvasSessionParamsExample())} --output-format json`;
      }
      return `npx opendevbrowser canvas --command canvas.plan.set${inlineParamsFlag(buildCanvasPlanSetParamsExample())} --output-format json`;
  }
};

const commandExamples = (reasonCode: CanvasRepairReasonCode, blockedCommand?: string) => {
  const commands = commandForReason(reasonCode, blockedCommand);
  return commands.map((command) => ({
    id: command.replaceAll(".", "-"),
    label: labelForCommand(command),
    command: cliForCommand(command)
  }));
};

export const buildCanvasPlanSetParamsExample = (): Record<string, JsonValue> => ({
  canvasSessionId: exampleIds.canvasSessionId,
  leaseId: exampleIds.leaseId,
  generationPlan: EXAMPLE_CANVAS_GENERATION_PLAN as unknown as JsonValue
});

export const buildCanvasGovernancePatchParamsExample = (): Record<string, JsonValue> => ({
  canvasSessionId: exampleIds.canvasSessionId,
  leaseId: exampleIds.leaseId,
  baseRevision: 1,
  patches: [{
    op: "governance.update",
    block: "intent",
    changes: {
      summary: "Create an evidence-backed landing page iteration for the current brief.",
      audience: "Primary product or service buyers",
      task: "Understand the offer and take the primary conversion action",
      successCriteria: [
        "Hero communicates the brand and offer without relying on navigation text",
        "Primary CTA is visible and keyboard reachable",
        "Desktop, tablet, and mobile layouts preserve content hierarchy"
      ]
    }
  }]
});

const buildDocumentLoadParamsExample = (): Record<string, JsonValue> => ({
  canvasSessionId: exampleIds.canvasSessionId,
  leaseId: exampleIds.leaseId,
  documentId: exampleIds.documentId
});

const buildAttachParamsExample = (): Record<string, JsonValue> => ({
  canvasSessionId: exampleIds.canvasSessionId,
  attachMode: "lease_reclaim"
});

const issuePriority = (issue: CanvasGenerationPlanIssue): number => {
  if (issue.code === "invalid_value") return 0;
  if (issue.code === "invalid_type") return 1;
  return 2;
};

const issueFieldExamples = (issues: CanvasGenerationPlanIssue[]): GuidanceFieldExample[] => {
  const prioritizedIssues = [...issues].sort((left, right) => issuePriority(left) - issuePriority(right));
  return prioritizedIssues.slice(0, MAX_ISSUE_FIELD_EXAMPLES).map((issue) => ({
    path: `generationPlan.${issue.path}`,
    description: issue.message,
    example: readExampleForIssuePath(issue.path),
    ...(issue.expected ? { expected: toExpectedString(issue.expected) } : {}),
    ...(typeof issue.received !== "undefined" ? { received: stringifyReceived(issue.received) } : {})
  }));
};

const readExampleForIssuePath = (path: string): JsonValue => {
  const segments = path.split(".");
  let current: JsonValue = EXAMPLE_CANVAS_GENERATION_PLAN as unknown as JsonValue;
  for (const segment of segments) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return "<valid value>";
    current = current[segment] ?? "<valid value>";
  }
  return current;
};

const normalizeGenerationPlanPath = (path: string): string => {
  const trimmed = path.trim();
  return trimmed.startsWith("generationPlan.") ? trimmed.slice("generationPlan.".length) : trimmed;
};

const missingFieldExamples = (missingFields: string[]): GuidanceFieldExample[] => missingFields
  .map(normalizeGenerationPlanPath)
  .filter((path) => path.length > 0)
  .slice(0, MAX_ISSUE_FIELD_EXAMPLES)
  .map((path) => ({
    path: `generationPlan.${path}`,
    description: `Provide generationPlan.${path} before retrying canvas.plan.set.`,
    example: readExampleForIssuePath(path),
    expected: "valid Canvas generation plan field"
  }));

const baseFieldExamples = (reasonCode: CanvasRepairReasonCode): GuidanceFieldExample[] => {
  if (reasonCode === "missing_canvas_session_id") {
    return [{
      path: "canvasSessionId",
      description: "Use the canvasSessionId returned by canvas.session.open.",
      example: exampleIds.canvasSessionId,
      expected: "non-empty string"
    }];
  }
  if (reasonCode === "missing_lease_id") {
    return [{
      path: "leaseId",
      description: "Use the active leaseId returned by canvas.session.open or canvas.session.attach.",
      example: exampleIds.leaseId,
      expected: "non-empty string"
    }];
  }
  if (reasonCode === "missing_document_id") {
    return [{
      path: "documentId",
      description: "Use documentId when loading a persisted Canvas document. Use repoPath instead when loading by file path.",
      example: exampleIds.documentId,
      expected: "non-empty string"
    }];
  }
  return [{
    path: "designGovernance.intent",
    description: "Patch intent before save or downstream handoff when governance warnings report missing intent.",
    example: {
      summary: "Create an evidence-backed landing page iteration for the current brief.",
      audience: "Primary product or service buyers",
      task: "Understand the offer and take the primary conversion action"
    }
  }];
};

const chooseFieldExamples = (
  reasonCode: CanvasRepairReasonCode,
  issues: CanvasGenerationPlanIssue[],
  missingFields: string[]
): GuidanceFieldExample[] => {
  const issueExamples = issueFieldExamples(issues);
  if (issueExamples.length > 0) return issueExamples;
  const missingExamples = missingFieldExamples(missingFields);
  if (missingExamples.length > 0) return missingExamples;
  return baseFieldExamples(reasonCode);
};

const paramsForCommand = (command: string): Record<string, JsonValue> | null => {
  switch (command) {
    case "canvas.session.attach":
      return buildAttachParamsExample();
    case "canvas.document.load":
      return buildDocumentLoadParamsExample();
    case "canvas.document.patch":
      return buildCanvasGovernancePatchParamsExample();
    case "canvas.plan.get":
      return buildCanvasSessionParamsExample();
    case "canvas.plan.set":
      return buildCanvasPlanSetParamsExample();
    default:
      return command.startsWith("canvas.") ? buildCanvasSessionParamsExample() : null;
  }
};

const paramsExamples = (reasonCode: CanvasRepairReasonCode, blockedCommand?: string): GuidanceParamsExample[] => {
  const examples: GuidanceParamsExample[] = [];
  if (reasonCode === "missing_lease_id") {
    examples.push({
      id: "canvas-attach-request",
      label: "Attach or reclaim a session lease",
      command: "canvas.session.attach",
      params: buildAttachParamsExample()
    });
    const blockedParams = blockedCommand ? paramsForCommand(blockedCommand) : null;
    if (blockedCommand && blockedCommand !== "canvas.session.attach" && blockedParams) {
      examples.push({
        id: `${blockedCommand.replaceAll(".", "-")}-request`,
        label: `Valid ${blockedCommand} params after lease recovery`,
        command: blockedCommand,
        params: blockedParams
      });
      return examples;
    }
  }
  if (reasonCode === "missing_document_id") {
    examples.push({
      id: "canvas-document-load-request",
      label: "Load a document by id",
      command: "canvas.document.load",
      params: buildDocumentLoadParamsExample()
    });
    return examples;
  }
  examples.push({
    id: "canvas-plan-set-request",
    label: "Valid canvas.plan.set params",
    command: "canvas.plan.set",
    params: buildCanvasPlanSetParamsExample()
  });
  if (reasonCode === "governance_missing") {
    examples.push({
      id: "canvas-governance-intent-patch",
      label: "Patch missing intent governance",
      command: "canvas.document.patch",
      params: buildCanvasGovernancePatchParamsExample()
    });
  }
  return examples;
};

const validationChecks = (reasonCode: CanvasRepairReasonCode): GuidanceValidationCheck[] => {
  const checks: GuidanceValidationCheck[] = [{
    id: "session-opened",
    description: "canvas.session.open or canvas.session.attach returns active ids before command retry.",
    assertion: "typeof canvasSessionId === \"string\" && typeof leaseId === \"string\""
  }];
  if (reasonCode !== "missing_document_id") {
    checks.push({
      id: "plan-valid",
      description: "generationPlan passes Canvas validation.",
      assertion: "validateGenerationPlan(generationPlan).ok === true"
    });
  } else {
    checks.push({
      id: "document-target-selected",
      description: "documentId or repoPath is present before loading a Canvas document.",
      assertion: "typeof documentId === \"string\" || typeof repoPath === \"string\""
    });
  }
  if (reasonCode === "governance_missing") {
    checks.push({
      id: "intent-present",
      description: "intent governance block is present after canvas.document.patch.",
      assertion: "designGovernance.intent is present"
    });
  }
  return checks;
};

const doNotProceedIf = (reasonCode: CanvasRepairReasonCode): string[] => {
  const blockers = [
    "canvasSessionId is missing or stale",
    "leaseId is missing or no longer active"
  ];
  if (reasonCode !== "missing_document_id") {
    blockers.push("generationPlan validation still reports missing or invalid fields");
  } else {
    blockers.push("documentId and repoPath are both missing");
  }
  if (reasonCode === "governance_missing") {
    blockers.push("intent or other required governance blocks are still missing");
  }
  return blockers;
};

export const buildCanvasRepairGuidance = (input: {
  reasonCode: CanvasRepairReasonCode;
  missingFields?: string[];
  issues?: CanvasGenerationPlanIssue[];
  message?: string;
  blockedCommand?: string;
}): NextStepGuidance => {
  const fields = chooseFieldExamples(input.reasonCode, input.issues ?? [], input.missingFields ?? []);
  const readiness = input.reasonCode === "governance_missing" ? "needs_recovery" : "needs_input";
  const severity = input.reasonCode === "governance_missing" ? "warning" : "blocked";
  return {
    id: `canvas.${input.reasonCode}`,
    recipeType: "schema_repair",
    workflow: "canvas",
    severity,
    readiness,
    reasonCode: input.reasonCode,
    primaryAction: {
      id: "repair_canvas_request",
      label: "Repair Canvas command params",
      summary: input.message ?? titleForReason(input.reasonCode)
    },
    commands: commandExamples(input.reasonCode, input.blockedCommand),
    paramsExamples: paramsExamples(input.reasonCode, input.blockedCommand),
    fieldExamples: fields,
    artifactInputs: [],
    validationChecks: validationChecks(input.reasonCode),
    fallbackPolicy: {
      allowed: false,
      requiresUserConfirmation: true,
      reason: "Do not skip Canvas validation or governance gates. Repair the typed command payload first."
    },
    doNotProceedIf: doNotProceedIf(input.reasonCode)
  };
};

export const buildCanvasRepairEnvelope = (input: {
  reasonCode: CanvasRepairReasonCode;
  message?: string;
  missingFields?: string[];
  issues?: CanvasGenerationPlanIssue[];
  blockedCommand?: string;
}): CanvasRepairEnvelope => {
  const guidance = buildCanvasRepairGuidance(input);
  const recommendedNextCommands = commandForReason(input.reasonCode, input.blockedCommand);
  const message = input.message ?? guidance.primaryAction.summary;
  const guidancePayload = {
    recommendedNextCommands,
    reason: message,
    nextStepGuidance: renderWorkflowGuidance(guidance),
    paramsExamples: guidance.paramsExamples,
    fieldExamples: guidance.fieldExamples,
    validationChecks: guidance.validationChecks,
    doNotProceedIf: guidance.doNotProceedIf
  };
  // Root-level fields preserve the legacy CLI/tool surface; details.guidance is the canonical typed payload.
  return {
    code: input.reasonCode,
    message,
    recommendedNextCommands,
    guidance: guidancePayload,
    nextStepGuidance: guidancePayload.nextStepGuidance,
    paramsExamples: guidancePayload.paramsExamples,
    fieldExamples: guidancePayload.fieldExamples,
    validationChecks: guidancePayload.validationChecks,
    doNotProceedIf: guidancePayload.doNotProceedIf
  };
};

const missingIdentifierReasonCode = (field: CanvasMissingIdentifier): CanvasRepairReasonCode => {
  if (field === "canvasSessionId") return "missing_canvas_session_id";
  if (field === "leaseId") return "missing_lease_id";
  return "missing_document_id";
};

const SESSION_REQUIRED_COMMANDS = new Set([
  "canvas.session.attach",
  "canvas.session.status",
  "canvas.session.close",
  "canvas.capabilities.get",
  "canvas.plan.set",
  "canvas.plan.get",
  "canvas.document.load",
  "canvas.document.import",
  "canvas.document.patch",
  "canvas.history.undo",
  "canvas.history.redo",
  "canvas.document.save",
  "canvas.document.export",
  "canvas.inventory.list",
  "canvas.inventory.insert",
  "canvas.starter.apply",
  "canvas.tab.open",
  "canvas.tab.close",
  "canvas.overlay.mount",
  "canvas.overlay.unmount",
  "canvas.overlay.select",
  "canvas.preview.render",
  "canvas.preview.refresh",
  "canvas.feedback.poll",
  "canvas.feedback.subscribe",
  "canvas.feedback.next",
  "canvas.feedback.unsubscribe",
  "canvas.code.bind",
  "canvas.code.unbind",
  "canvas.code.pull",
  "canvas.code.push",
  "canvas.code.status",
  "canvas.code.resolve"
]);

const requiresCanvasSessionId = (command: string): boolean => SESSION_REQUIRED_COMMANDS.has(command);

const LEASE_REQUIRED_COMMANDS = new Set([
  "canvas.session.close",
  "canvas.plan.set",
  "canvas.plan.get",
  "canvas.document.load",
  "canvas.document.import",
  "canvas.document.patch",
  "canvas.history.undo",
  "canvas.history.redo",
  "canvas.document.save",
  "canvas.document.export",
  "canvas.inventory.insert",
  "canvas.starter.apply",
  "canvas.tab.open",
  "canvas.tab.close",
  "canvas.overlay.mount",
  "canvas.overlay.unmount",
  "canvas.overlay.select",
  "canvas.preview.render",
  "canvas.preview.refresh",
  "canvas.code.bind",
  "canvas.code.unbind",
  "canvas.code.pull",
  "canvas.code.push",
  "canvas.code.resolve"
]);

const requiresLeaseId = (command: string): boolean => LEASE_REQUIRED_COMMANDS.has(command);

const missingString = (params: Record<string, unknown>, field: CanvasMissingIdentifier): boolean => {
  const value = params[field];
  return typeof value !== "string" || value.trim().length === 0;
};

export const buildCanvasCommandValidationEnvelope = (
  command: string,
  params: Record<string, unknown>
): CanvasRepairEnvelope | null => {
  if (requiresCanvasSessionId(command) && missingString(params, "canvasSessionId")) {
    return buildCanvasMissingIdentifierEnvelope("canvasSessionId", command);
  }
  if (requiresLeaseId(command) && missingString(params, "leaseId")) {
    return buildCanvasMissingIdentifierEnvelope("leaseId", command);
  }
  const repoPath = params.repoPath;
  const hasRepoPath = typeof repoPath === "string" && repoPath.trim().length > 0;
  if (command === "canvas.document.load" && missingString(params, "documentId") && !hasRepoPath) {
    return buildCanvasMissingIdentifierEnvelope("documentId", command);
  }
  return null;
};

export const buildCanvasMissingIdentifierEnvelope = (
  field: CanvasMissingIdentifier,
  blockedCommand?: string
): CanvasRepairEnvelope => {
  const reasonCode = missingIdentifierReasonCode(field);
  return buildCanvasRepairEnvelope({
    reasonCode,
    ...(blockedCommand ? { blockedCommand } : {}),
    message: `Missing ${field}. ${titleForReason(reasonCode)}`
  });
};
