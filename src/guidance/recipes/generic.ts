import { buildCanvasPlanSetParamsExample, buildCanvasRepairGuidance } from "../../canvas/repair-examples";
import type { CanvasGenerationPlanIssue } from "../../canvas/types";
import type {
  GuidanceCommandExample,
  GuidanceContext,
  GuidanceFallbackPolicy,
  GuidanceRecipe,
  GuidanceReadiness,
  NextStepGuidance
} from "../types";

const quote = (value: string): string => JSON.stringify(value);

const DAEMON_STATUS_PREFLIGHT_COMMAND = "opendevbrowser status --daemon --output-format json";
const DAEMON_FINGERPRINT_CURRENT_ASSERTION = "data.fingerprintCurrent === true";
const DEFAULT_INSPIREDESIGN_BRIEF = "Digital photography studio landing page";
const DEFAULT_INSPIREDESIGN_QUERY = "cinematic photography studio landing page inspiration";
const DEFAULT_RESEARCH_TOPIC = "browser automation provider recovery";
const DEFAULT_PROVIDER = "provider diagnostics";

const isCanvasGenerationPlanIssue = (value: unknown): value is CanvasGenerationPlanIssue => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.path === "string"
    && typeof record.message === "string"
    && typeof record.code === "string";
};

const canvasGenerationPlanIssues = (value: unknown): CanvasGenerationPlanIssue[] => (
  Array.isArray(value) ? value.filter(isCanvasGenerationPlanIssue) : []
);

const isPinterestProvider = (provider: string): boolean => provider === "social/pinterest" || provider === "pinterest";

const isPinterestOnlyContext = (context: GuidanceContext): boolean => {
  const providers = context.requestedProviders ?? [];
  return providers.length === 0 || providers.every(isPinterestProvider);
};

const selectedInspiredesignProvider = (context: GuidanceContext): string => {
  const providers = context.requestedProviders ?? [];
  const nonPinterestProvider = providers.find((provider) => !isPinterestProvider(provider));
  if (!isPinterestOnlyContext(context) && nonPinterestProvider) return nonPinterestProvider;
  return providers[0] ?? context.siteRecipeId ?? "web/default";
};

const selectedProviderIsPinterest = (context: GuidanceContext): boolean => (
  isPinterestProvider(selectedInspiredesignProvider(context))
);

const isPinterestScopedRecovery = (context: GuidanceContext): boolean => (
  context.siteRecipeId === "social/pinterest"
  && isPinterestOnlyContext(context)
);

const inspiredesignBrowserMode = (context: GuidanceContext): string =>
  selectedProviderIsPinterest(context) ? "extension" : context.browserMode ?? "managed";

const inspiredesignCookieFlags = (context: GuidanceContext): string => {
  if (selectedProviderIsPinterest(context)) return " --use-cookies --cookie-policy required";
  return context.useCookies === true ? " --use-cookies" : "";
};

const inspiredesignHarvestCommand = (context: GuidanceContext): GuidanceCommandExample => {
  const brief = typeof context.details?.brief === "string" ? context.details.brief : DEFAULT_INSPIREDESIGN_BRIEF;
  const query = context.query ?? DEFAULT_INSPIREDESIGN_QUERY;
  const provider = selectedInspiredesignProvider(context);
  const browserMode = inspiredesignBrowserMode(context);
  const cookieFlags = inspiredesignCookieFlags(context);
  return {
    id: "inspiredesign-harvest-rerun",
    label: "Rerun Inspired Design harvest with explicit evidence settings",
    command: `npx opendevbrowser inspiredesign harvest --brief ${quote(brief)} --query ${quote(query)} --provider ${provider} --max-references 5 --visual-evidence required --browser-mode ${browserMode}${cookieFlags} --challenge-automation-mode browser_with_helper --mode json --output-format json`
  };
};

const canvasSessionOpenCommand: GuidanceCommandExample = {
  id: "canvas-session-open",
  label: "Open a Canvas session before submitting the plan",
  command: "npx opendevbrowser canvas --command canvas.session.open --output-format json"
};

const canvasPlanSetCommand: GuidanceCommandExample = {
  id: "canvas-plan-set",
  label: "Submit the generated Canvas plan request after filling ids",
  command: "npx opendevbrowser canvas --command canvas.plan.set --params-file ./canvas-plan.request.json --output-format json"
};

const defaultFallbackPolicy: GuidanceFallbackPolicy = {
  allowed: false,
  requiresUserConfirmation: true,
  reason: "Do not widen provider or source scope without user confirmation."
};

const inspiredesignArtifacts = [
  { path: "advanced-brief.md", purpose: "Review the reference-first brief before design or implementation.", required: true },
  { path: "ranked-references.json", purpose: "Verify ranked evidence quality and rejected diagnostics.", required: true },
  { path: "visual-evidence.json", purpose: "Confirm screenshot metadata and warnings.", required: true },
  { path: "screenshot-index.json", purpose: "Confirm screenshot artifact paths exist before visual claims.", required: true }
] as const;

const requiresInspiredesignReferenceEvidence = (context: GuidanceContext): boolean => (
  context.evidence?.referenceEvidenceRequired !== false
);

const notReadyInspiredesignReasonCode = (context: GuidanceContext): string => (
  context.evidence?.topReferenceIntentMatched === false ? "off_brief_reference" : "weak_reference"
);

const notReadyInspiredesignSummary = (reasonCode: string): string => (
  reasonCode === "off_brief_reference"
    ? "The workflow requested a design-ready handoff, but the top ranked reference is off brief for Canvas continuation."
    : "The workflow requested a design-ready handoff, but the evidence does not meet the ready threshold for Canvas continuation."
);

const buildReadyInspiredesignGuidance = (context: GuidanceContext, readiness: GuidanceReadiness): NextStepGuidance => {
  if (readiness !== "ready") {
    const reasonCode = notReadyInspiredesignReasonCode(context);
    return buildEvidenceRecoveryGuidance(
      context,
      readiness,
      reasonCode,
      reasonCode === "off_brief_reference" ? "Replace off-brief reference evidence" : "Strengthen reference evidence before Canvas",
      notReadyInspiredesignSummary(reasonCode)
    );
  }
  const referenceEvidenceRequired = requiresInspiredesignReferenceEvidence(context);
  const artifactInputs = referenceEvidenceRequired
    ? [...inspiredesignArtifacts, { path: "canvas-plan.request.json", purpose: "Runtime request body for canvas.plan.set.", required: true }]
    : [
      { path: "advanced-brief.md", purpose: "Review the brief-expanded design direction before Canvas.", required: true },
      { path: "design-contract.json", purpose: "Use the brief-derived Canvas governance contract.", required: true },
      { path: "canvas-plan.request.json", purpose: "Runtime request body for canvas.plan.set.", required: true }
    ];
  const validationChecks = referenceEvidenceRequired
    ? [{
      id: "plan-accepted",
      description: "canvas.plan.set returns planStatus=accepted before document mutation.",
      assertion: "planStatus === \"accepted\""
    }]
    : [{
      id: "brief-contract-accepted",
      description: "canvas.plan.set accepts the generated brief-only generationPlan before document mutation.",
      assertion: "planStatus === \"accepted\""
    }];
  const doNotProceedIf = referenceEvidenceRequired
    ? [
      "rankedReferences is empty",
      "screenshot paths are missing when visual evidence was required",
      "planStatus is not accepted"
    ]
    : [
      "advanced-brief.md or design-contract.json is missing",
      "planStatus is not accepted"
    ];
  return {
    id: "inspiredesign.canvas_ready_handoff",
    recipeType: "artifact_handoff",
    workflow: "inspiredesign",
    severity: "info",
    readiness,
    reasonCode: "design_ready",
    primaryAction: {
      id: "continue_in_canvas",
      label: "Continue in Canvas",
      summary: "Read the generated artifacts, open a Canvas session, fill canvas-plan.request.json ids, then submit canvas.plan.set."
    },
    commands: [canvasSessionOpenCommand, canvasPlanSetCommand],
    paramsExamples: [{
      id: "canvas-plan-request-ids",
      label: "Canvas plan request id placeholders to fill",
      command: "canvas.plan.set",
      params: {
        canvasSessionId: "<canvasSessionId from canvas.session.open>",
        leaseId: "<leaseId from canvas.session.open>",
        generationPlan: "<keep generated generationPlan object unchanged>"
      }
    }],
    fieldExamples: [{
      path: "intent",
      description: "Patch emitted governance blocks from design-contract.json after plan acceptance.",
      example: { audience: "Primary user", task: "Complete the design goal", successCriteria: ["Evidence-backed design direction is implemented"] }
    }],
    artifactInputs,
    validationChecks,
    fallbackPolicy: {
      allowed: true,
      requiresUserConfirmation: false,
      reason: referenceEvidenceRequired
        ? "Canvas continuation is allowed because ranked reference evidence is ready."
        : "Canvas continuation is allowed because this brief-only run did not require reference evidence."
    },
    doNotProceedIf
  };
};

const buildDaemonFingerprintMismatchGuidance = (readiness: GuidanceReadiness): NextStepGuidance => ({
  id: "daemon.fingerprint_mismatch",
  recipeType: "workflow_entry",
  workflow: "daemon",
  severity: "blocked",
  readiness,
  reasonCode: "daemon_fingerprint_mismatch",
  primaryAction: {
    id: "verify_daemon_fingerprint",
    label: "Verify daemon fingerprint",
    summary: "Run the daemon status preflight and continue only when the running daemon matches the current opendevbrowser build."
  },
  commands: [{
    id: "daemon-status-preflight",
    label: "Check daemon fingerprint freshness",
    command: DAEMON_STATUS_PREFLIGHT_COMMAND
  }],
  paramsExamples: [],
  fieldExamples: [{
    path: "data.fingerprintCurrent",
    description: "The daemon status response must report the current build fingerprint.",
    example: true,
    expected: "true"
  }],
  artifactInputs: [],
  validationChecks: [{
    id: "fingerprint-current",
    description: "Daemon status confirms the binary and daemon fingerprint match.",
    assertion: DAEMON_FINGERPRINT_CURRENT_ASSERTION,
    command: DAEMON_STATUS_PREFLIGHT_COMMAND
  }],
  fallbackPolicy: {
    allowed: true,
    requiresUserConfirmation: false,
    reason: "Use the matching binary, restart the daemon from the current install, or isolate config, cache, daemon port, and relay port."
  },
  doNotProceedIf: [
    "data.fingerprintCurrent is false or missing",
    "the daemon is still running a different opendevbrowser build"
  ]
});

const buildResearchGatedProviderGuidance = (
  context: GuidanceContext,
  readiness: GuidanceReadiness
): NextStepGuidance => {
  const topic = typeof context.details?.topic === "string" ? context.details.topic : DEFAULT_RESEARCH_TOPIC;
  const browserMode = context.browserMode ?? "extension";
  const cookieFlag = context.useCookies === true ? " --use-cookies" : "";
  const providers = context.requestedProviders?.length ? context.requestedProviders.join(", ") : "gated providers";
  return {
    id: "research.gated_provider_recovery",
    recipeType: "evidence_recovery",
    workflow: "research",
    severity: "warning",
    readiness,
    reasonCode: "gated_provider",
    primaryAction: {
      id: "recover_gated_provider_evidence",
      label: "Recover gated provider evidence",
      summary: `Inspect gated-provider diagnostics for ${providers}, then rerun research with a user-authorized signed-in browser session before publishing claims.`
    },
    commands: [{
      id: "research-gated-provider-rerun",
      label: "Rerun research with browser-scoped provider recovery",
      command: `npx opendevbrowser research run --topic ${quote(topic)} --days 14 --sources web,community --browser-mode ${browserMode}${cookieFlag} --challenge-automation-mode browser_with_helper --mode json --output-format json`
    }],
    paramsExamples: [{
      id: "research-gated-provider-input",
      label: "Research gated-provider retry input",
      params: {
        topic,
        browserMode,
        useCookies: context.useCookies === true,
        challengeAutomationMode: "browser_with_helper",
        providers
      }
    }],
    fieldExamples: [{
      path: "meta.failures[].error.reasonCode",
      description: "Gated provider failures should identify auth or challenge reason codes before retry.",
      example: "auth_required"
    }],
    artifactInputs: [
      { path: "records.json", purpose: "Confirm destination records support claims.", required: true },
      { path: "context.json", purpose: "Inspect source and timebox context.", required: true },
      { path: "meta.json", purpose: "Review failures, cookie diagnostics, and challenge orchestration metadata.", required: true },
      { path: "report.md", purpose: "Publish only claims supported by accepted records.", required: true }
    ],
    validationChecks: [
      { id: "signed-in-session", description: "Provider auth or challenge state has been resolved in the browser session." },
      { id: "records-supported", description: "Final claims are supported by destination records, not SERP snippets." }
    ],
    fallbackPolicy: {
      allowed: false,
      requiresUserConfirmation: true,
      reason: "Do not switch sources or publish unsupported claims without user approval."
    },
    doNotProceedIf: [
      "gated provider failures remain unresolved",
      "records.json lacks destination evidence for the claim",
      "cookie or challenge recovery has not been user-authorized"
    ]
  };
};

const buildProviderWorkflowGuidance = (
  context: GuidanceContext,
  readiness: GuidanceReadiness
): NextStepGuidance => {
  const providers = context.requestedProviders?.join(", ") || DEFAULT_PROVIDER;
  const reasonCode = context.reasonCode ?? "provider_recovery";
  return {
    id: `provider.${reasonCode}`,
    recipeType: "evidence_recovery",
    workflow: "provider",
    severity: readiness === "blocked" ? "blocked" : "warning",
    readiness,
    reasonCode,
    primaryAction: {
      id: "inspect_provider_diagnostics",
      label: "Inspect provider diagnostics",
      summary: "Use the typed failure details to resolve auth, challenge, availability, or evidence-quality blockers before widening provider scope."
    },
    commands: [{
      id: "provider-diagnostic-rerun",
      label: "Show executable workflow help before rerunning",
      command: "npx opendevbrowser help"
    }],
    paramsExamples: [{
      id: "provider-recovery-input",
      label: "Provider recovery input",
      params: {
        providers,
        reasonCode,
        browserMode: context.browserMode ?? "extension",
        useCookies: context.useCookies === true
      }
    }],
    fieldExamples: [{
      path: "meta.failures[].error.reasonCode",
      description: "Use the provider reason code to choose auth, challenge, availability, or evidence recovery.",
      example: reasonCode
    }],
    artifactInputs: [
      { path: "meta.json", purpose: "Inspect provider diagnostics and reason codes.", required: true },
      { path: "records.json", purpose: "Confirm accepted destination records before using results.", required: true }
    ],
    validationChecks: [{
      id: "provider-evidence-ready",
      description: "At least one accepted record supports the workflow output before proceeding."
    }],
    fallbackPolicy: defaultFallbackPolicy,
    doNotProceedIf: [
      "provider failure reason codes remain unresolved",
      "accepted records are empty",
      "the requested provider scope would be widened without user confirmation"
    ]
  };
};

const buildCliValidationGuidance = (
  context: GuidanceContext,
  readiness: GuidanceReadiness
): NextStepGuidance => {
  const reasonCode = context.reasonCode ?? "validation_error";
  return {
    id: `cli.${reasonCode}`,
    recipeType: "schema_repair",
    workflow: "cli",
    severity: "blocked",
    readiness,
    reasonCode,
    primaryAction: {
      id: "repair_cli_arguments",
      label: "Repair CLI arguments",
      summary: "Use the command help and typed error details to rerun with valid flags, params, and output mode."
    },
    commands: [{
      id: "cli-help",
      label: "Show command help",
      command: "npx opendevbrowser help"
    }],
    paramsExamples: [{
      id: "cli-validation-input",
      label: "CLI validation retry",
      params: {
        reasonCode,
        outputFormat: "json"
      }
    }],
    fieldExamples: [{
      path: "error.reasonCode",
      description: "The reason code identifies which CLI argument or params field must be repaired.",
      example: reasonCode
    }],
    artifactInputs: [],
    validationChecks: [{
      id: "json-output",
      description: "Rerun the command with --output-format json and verify the response has no validation errors."
    }],
    fallbackPolicy: {
      allowed: true,
      requiresUserConfirmation: false,
      reason: "Help output and typed examples are the supported recovery path for invalid CLI input."
    },
    doNotProceedIf: [
      "the command still returns validation errors",
      "required params are missing or empty"
    ]
  };
};

const buildEvidenceRecoveryGuidance = (
  context: GuidanceContext,
  readiness: GuidanceReadiness,
  reasonCode: string,
  actionLabel: string,
  actionSummary: string
): NextStepGuidance => ({
  id: `inspiredesign.harvest.${reasonCode}`,
  recipeType: "evidence_recovery",
  workflow: "inspiredesign",
  severity: readiness === "blocked" ? "blocked" : "warning",
  readiness,
  reasonCode,
  primaryAction: {
    id: "recover_reference_evidence",
    label: actionLabel,
    summary: actionSummary
  },
  commands: [inspiredesignHarvestCommand(context)],
  paramsExamples: [{
    id: "explicit-reference-url-recovery",
      label: "Use explicit high-quality visual references when provider discovery is blocked",
      params: {
      brief: typeof context.details?.brief === "string" ? context.details.brief : DEFAULT_INSPIREDESIGN_BRIEF,
      urls: ["https://example.com/usable-reference"],
      visualEvidence: "required",
      browserMode: inspiredesignBrowserMode(context),
      ...(selectedProviderIsPinterest(context) ? { useCookies: true, cookiePolicy: "required" } : {})
    }
  }],
  fieldExamples: [],
  artifactInputs: inspiredesignArtifacts.map((artifact) => ({ ...artifact, required: false })),
  validationChecks: [
    { id: "ranked-reference-count", description: "At least one ranked reference is present.", assertion: "rankedReferences.length > 0" },
    { id: "reference-score", description: "The top reference score meets the ready threshold.", assertion: "topReferenceScore >= 50" },
    { id: "reference-intent", description: "The top ranked reference overlaps the requested brief intent.", assertion: "topReferenceIntentMatched === true" },
    { id: "visual-artifact", description: "Required visual evidence has finalized screenshot paths.", assertion: "missingScreenshotCount === 0" }
  ],
  fallbackPolicy: defaultFallbackPolicy,
  doNotProceedIf: [
    "reference_count is 0",
    "rankedReferences is empty",
    "top ranked reference is diagnostic-only or off brief",
    "required visual evidence is missing or failed"
  ]
});

export const genericGuidanceRecipes: GuidanceRecipe[] = [
  {
    id: "provider.generic_recovery",
    recipeType: "evidence_recovery",
    workflow: "provider",
    priority: 130,
    reasonCode: "provider_recovery",
    matches: (context) => context.workflow === "provider",
    build: buildProviderWorkflowGuidance
  },
  {
    id: "cli.validation_recovery",
    recipeType: "schema_repair",
    workflow: "cli",
    priority: 125,
    reasonCode: "validation_error",
    matches: (context) => context.workflow === "cli",
    build: buildCliValidationGuidance
  },
  {
    id: "daemon.fingerprint_mismatch",
    recipeType: "workflow_entry",
    workflow: "daemon",
    priority: 120,
    reasonCode: "daemon_fingerprint_mismatch",
    matches: (context) => context.workflow === "daemon" && context.reasonCode === "daemon_fingerprint_mismatch",
    build: (_context, readiness) => buildDaemonFingerprintMismatchGuidance(readiness)
  },
  {
    id: "research.gated_provider",
    recipeType: "evidence_recovery",
    workflow: "research",
    priority: 110,
    reasonCode: "gated_provider",
    matches: (context) => context.workflow === "research" && context.reasonCode === "gated_provider",
    build: buildResearchGatedProviderGuidance
  },
  {
    id: "canvas.generation_plan_invalid",
    recipeType: "schema_repair",
    workflow: "canvas",
    priority: 100,
    reasonCode: "generation_plan_invalid",
    matches: (context) => context.workflow === "canvas" && context.reasonCode === "generation_plan_invalid",
    build: (context) => buildCanvasRepairGuidance({
      reasonCode: "generation_plan_invalid",
      missingFields: Array.isArray(context.details?.missingFields)
        ? context.details.missingFields.filter((field): field is string => typeof field === "string")
        : [],
      issues: canvasGenerationPlanIssues(context.details?.issues)
    })
  },
  {
    id: "canvas.plan_required",
    recipeType: "schema_repair",
    workflow: "canvas",
    priority: 90,
    reasonCode: "plan_required",
    matches: (context) => context.workflow === "canvas" && context.reasonCode === "plan_required",
    build: () => buildCanvasRepairGuidance({ reasonCode: "plan_required" })
  },
  {
    id: "canvas.governance_missing",
    recipeType: "schema_repair",
    workflow: "canvas",
    priority: 80,
    reasonCode: "governance_missing",
    matches: (context) => context.workflow === "canvas" && context.reasonCode === "governance_missing",
    build: () => buildCanvasRepairGuidance({ reasonCode: "governance_missing" })
  },
  {
    id: "canvas.missing_canvas_session_id",
    recipeType: "schema_repair",
    workflow: "canvas",
    priority: 70,
    reasonCode: "missing_canvas_session_id",
    matches: (context) => context.workflow === "canvas" && context.reasonCode === "missing_canvas_session_id",
    build: () => buildCanvasRepairGuidance({ reasonCode: "missing_canvas_session_id" })
  },
  {
    id: "canvas.missing_lease_id",
    recipeType: "schema_repair",
    workflow: "canvas",
    priority: 60,
    reasonCode: "missing_lease_id",
    matches: (context) => context.workflow === "canvas" && context.reasonCode === "missing_lease_id",
    build: () => buildCanvasRepairGuidance({ reasonCode: "missing_lease_id" })
  },
  {
    id: "canvas.missing_document_id",
    recipeType: "schema_repair",
    workflow: "canvas",
    priority: 50,
    reasonCode: "missing_document_id",
    matches: (context) => context.workflow === "canvas" && context.reasonCode === "missing_document_id",
    build: () => buildCanvasRepairGuidance({ reasonCode: "missing_document_id" })
  },
  {
    id: "inspiredesign.pinterest.browser_native_recovery",
    recipeType: "site_navigation",
    workflow: "inspiredesign",
    priority: 100,
    reasonCode: "pinterest_browser_native_recovery",
    matches: (context) => context.workflow === "inspiredesign"
      && isPinterestScopedRecovery(context)
      && context.reasonCode !== "design_ready",
    build: (context, readiness) => buildEvidenceRecoveryGuidance(
      context,
      readiness,
      "pinterest_browser_native_recovery",
      "Recover Pinterest evidence in an authenticated browser session",
      "Use the Pinterest browser-native recipe to verify login, search the brief on Pinterest, collect usable pins or boards, and reject login, challenge, empty-grid, and search-shell pages before Canvas."
    )
  },
  {
    id: "inspiredesign.provider_unavailable",
    recipeType: "evidence_recovery",
    workflow: "inspiredesign",
    priority: 90,
    reasonCode: "provider_unavailable",
    matches: (context) => context.workflow === "inspiredesign" && context.reasonCode === "provider_unavailable",
    build: (context, readiness) => buildEvidenceRecoveryGuidance(
      context,
      readiness,
      "provider_unavailable",
      "Recover provider evidence",
      "Resolve the requested provider lane or supply explicit usable reference URLs before continuing to Canvas."
    )
  },
  {
    id: "inspiredesign.diagnostic_only",
    recipeType: "quality_gate",
    workflow: "inspiredesign",
    priority: 80,
    reasonCode: "diagnostic_only",
    matches: (context) => context.workflow === "inspiredesign" && context.reasonCode === "diagnostic_only",
    build: (context, readiness) => buildEvidenceRecoveryGuidance(
      context,
      readiness,
      "diagnostic_only",
      "Replace diagnostic references",
      "The harvest captured diagnostic or blocked pages. Replace them with usable creative references before Canvas."
    )
  },
  {
    id: "inspiredesign.zero_references",
    recipeType: "evidence_recovery",
    workflow: "inspiredesign",
    priority: 70,
    reasonCode: "zero_references",
    matches: (context) => context.workflow === "inspiredesign" && context.reasonCode === "zero_references",
    build: (context, readiness) => buildEvidenceRecoveryGuidance(
      context,
      readiness,
      "zero_references",
      "Collect reference evidence",
      "The harvest produced no references. Run source-specific discovery or provide explicit URLs before Canvas."
    )
  },
  {
    id: "inspiredesign.failed_capture",
    recipeType: "evidence_recovery",
    workflow: "inspiredesign",
    priority: 60,
    reasonCode: "failed_capture",
    matches: (context) => context.workflow === "inspiredesign" && context.reasonCode === "failed_capture",
    build: (context, readiness) => buildEvidenceRecoveryGuidance(
      context,
      readiness,
      "failed_capture",
      "Retry capture with a usable browser session",
      "Deep capture or required visual evidence failed. Restore session state or use explicit references with capturable pages."
    )
  },
  {
    id: "inspiredesign.zero_ranked_references",
    recipeType: "evidence_recovery",
    workflow: "inspiredesign",
    priority: 55,
    reasonCode: "zero_ranked_references",
    matches: (context) => context.workflow === "inspiredesign" && context.reasonCode === "zero_ranked_references",
    build: (context, readiness) => buildEvidenceRecoveryGuidance(
      context,
      readiness,
      "zero_ranked_references",
      "Replace rejected reference evidence",
      "The harvest captured references, but none survived scoring. Replace rejected, off-brief, blocked, or diagnostic pages before Canvas."
    )
  },
  {
    id: "inspiredesign.off_brief_reference",
    recipeType: "quality_gate",
    workflow: "inspiredesign",
    priority: 52,
    reasonCode: "off_brief_reference",
    matches: (context) => context.workflow === "inspiredesign" && context.reasonCode === "off_brief_reference",
    build: (context, readiness) => buildEvidenceRecoveryGuidance(
      context,
      readiness,
      "off_brief_reference",
      "Replace off-brief reference evidence",
      "The top ranked reference is captured, but its signals do not overlap the requested brief. Replace it with on-brief references before Canvas."
    )
  },
  {
    id: "inspiredesign.weak_reference",
    recipeType: "quality_gate",
    workflow: "inspiredesign",
    priority: 50,
    reasonCode: "weak_reference",
    matches: (context) => context.workflow === "inspiredesign" && context.reasonCode === "weak_reference",
    build: (context, readiness) => buildEvidenceRecoveryGuidance(
      context,
      readiness,
      "weak_reference",
      "Strengthen weak reference evidence",
      "The harvest has ranked references, but their score or confidence is too weak for Canvas-first design handoff."
    )
  },
  {
    id: "inspiredesign.ready",
    recipeType: "artifact_handoff",
    workflow: "inspiredesign",
    priority: 1,
    reasonCode: "design_ready",
    matches: (context) => context.workflow === "inspiredesign" && context.reasonCode === "design_ready",
    build: buildReadyInspiredesignGuidance
  }
];
