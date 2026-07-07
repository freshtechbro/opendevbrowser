import { INSPIREDESIGN_HANDOFF_GUIDANCE } from "../inspiredesign/handoff";
import { renderWorkflowCompatibility, renderWorkflowGuidance } from "../guidance/renderers";
import { routeNextStepGuidance } from "../guidance/router";
import type { NextStepGuidance } from "../guidance/types";
import { isProviderReasonCode, normalizeProviderReasonCode } from "./errors";
import type { ProductVideoReadinessStatus, ProductVideoReadinessSummary } from "./product-video-presentation";
import type { JsonValue, ProviderFailureEntry, ProviderReasonCode } from "./types";

export type WorkflowSuccessStep = {
  reason: string;
  command?: string;
};

export type WorkflowSuccessHandoff = {
  followthroughSummary: string;
  suggestedNextAction: string;
  suggestedSteps: WorkflowSuccessStep[];
  nextStepGuidance?: Record<string, JsonValue>;
};

export const PRODUCT_VIDEO_BRIEF_HELPER_PATH = "./skills/opendevbrowser-product-presentation-asset/scripts/render-video-brief.sh";

const PRODUCT_VIDEO_BRIEF_HELPER_COMMAND = `${PRODUCT_VIDEO_BRIEF_HELPER_PATH} <pack>/manifest.json`;

export const createSuccessHandoff = (
  followthroughSummary: string,
  suggestedNextAction: string,
  suggestedSteps: WorkflowSuccessStep[]
): WorkflowSuccessHandoff => ({
  followthroughSummary,
  suggestedNextAction,
  suggestedSteps
});

const cliExample = (command: string, args: string): string => (
  `npx opendevbrowser ${command} ${args}`
);

const quoteCliValue = (value: string): string => JSON.stringify(value);

type ResearchHandoffInput = {
  topic: string;
  browserMode?: string;
  failures?: ProviderFailureEntry[];
  cookieDiagnostics?: Array<Record<string, JsonValue>>;
  challengeOrchestration?: Array<Record<string, JsonValue>>;
};

type ResearchRerunOptions = {
  browserMode?: string;
  useCookies?: boolean;
  challengeAutomationMode?: "browser_with_helper";
};

type ResearchGatedProviderSignal = {
  providers: string[];
  reasonCodes: string[];
  useCookies: boolean;
};

const GATED_PROVIDER_REASON_CODES = new Set<ProviderReasonCode>([
  "auth_required",
  "token_required",
  "challenge_detected"
]);

const buildResearchRerunCommand = (
  input: ResearchHandoffInput,
  options: ResearchRerunOptions = {}
): string => {
  const browserMode = options.browserMode ?? input.browserMode ?? "managed";
  const useCookies = options.useCookies ? " --use-cookies" : "";
  const challengeMode = options.challengeAutomationMode
    ? ` --challenge-automation-mode ${options.challengeAutomationMode}`
    : "";
  return cliExample(
    "research run",
    `--topic ${quoteCliValue(input.topic)} --days 14 --sources web,community --browser-mode ${browserMode}${useCookies}${challengeMode} --mode json --output-format json`
  );
};

const isJsonRecord = (value: JsonValue | undefined): value is Record<string, JsonValue> => (
  Boolean(value) && typeof value === "object" && !Array.isArray(value)
);

const readFailureReasonCode = (failure: ProviderFailureEntry): ProviderReasonCode | null => {
  return failure.error.reasonCode
    ?? normalizeProviderReasonCode({
      code: failure.error.code,
      message: failure.error.message,
      details: failure.error.details
    })
    ?? null;
};

const readDiagnosticReasonCode = (diagnostic: Record<string, JsonValue>): ProviderReasonCode | null => {
  const reasonCode = diagnostic.reasonCode ?? diagnostic.browserFallbackReasonCode;
  return isProviderReasonCode(reasonCode) && GATED_PROVIDER_REASON_CODES.has(reasonCode) ? reasonCode : null;
};

const cookieDiagnosticShowsAvailableCookies = (diagnostic: Record<string, JsonValue>): boolean => {
  return diagnostic.available === true
    || (typeof diagnostic.loaded === "number" && diagnostic.loaded > 0)
    || (typeof diagnostic.injected === "number" && diagnostic.injected > 0)
    || (typeof diagnostic.verifiedCount === "number" && diagnostic.verifiedCount > 0);
};

const addProviderSignal = (
  signal: ResearchGatedProviderSignal,
  provider: string | undefined,
  reasonCode: ProviderReasonCode | null
): void => {
  if (provider) signal.providers.push(provider);
  if (reasonCode) signal.reasonCodes.push(reasonCode);
};

const readFailureCookieDiagnostics = (failure: ProviderFailureEntry): Record<string, JsonValue> | null => {
  const candidate = failure.error.details?.cookieDiagnostics;
  return isJsonRecord(candidate) ? candidate : null;
};

const emptyResearchGatedProviderSignal = (): ResearchGatedProviderSignal => ({
  providers: [],
  reasonCodes: [],
  useCookies: false
});

const normalizeResearchGatedProviderSignal = (
  signal: ResearchGatedProviderSignal
): ResearchGatedProviderSignal | null => {
  return signal.providers.length > 0 || signal.reasonCodes.length > 0 ? {
    providers: [...new Set(signal.providers)].sort(),
    reasonCodes: [...new Set(signal.reasonCodes)].sort(),
    useCookies: signal.useCookies
  } : null;
};

const mergeResearchGatedProviderSignals = (
  signals: ResearchGatedProviderSignal[]
): ResearchGatedProviderSignal => {
  const merged = emptyResearchGatedProviderSignal();
  for (const signal of signals) {
    merged.providers.push(...signal.providers);
    merged.reasonCodes.push(...signal.reasonCodes);
    merged.useCookies = merged.useCookies || signal.useCookies;
  }
  return merged;
};

const detectResearchFailureSignals = (failures: ProviderFailureEntry[]): ResearchGatedProviderSignal => {
  const signal = emptyResearchGatedProviderSignal();
  for (const failure of failures) {
    const reasonCode = readFailureReasonCode(failure);
    const isGatedFailure = Boolean(reasonCode && GATED_PROVIDER_REASON_CODES.has(reasonCode));
    if (isGatedFailure) {
      addProviderSignal(signal, failure.provider, reasonCode);
      const diagnostic = readFailureCookieDiagnostics(failure);
      signal.useCookies = signal.useCookies || Boolean(diagnostic && cookieDiagnosticShowsAvailableCookies(diagnostic));
    }
  }
  return signal;
};

const detectResearchCookieSignals = (
  diagnostics: Array<Record<string, JsonValue>>
): ResearchGatedProviderSignal => {
  const signal = emptyResearchGatedProviderSignal();
  for (const diagnostic of diagnostics) {
    const reasonCode = readDiagnosticReasonCode(diagnostic);
    const isGatedDiagnostic = Boolean(reasonCode || diagnostic.policy === "required");
    if (isGatedDiagnostic) {
      addProviderSignal(signal, typeof diagnostic.provider === "string" ? diagnostic.provider : undefined, reasonCode);
      signal.useCookies = signal.useCookies || cookieDiagnosticShowsAvailableCookies(diagnostic);
    }
  }
  return signal;
};

const detectResearchChallengeSignals = (
  diagnostics: Array<Record<string, JsonValue>>
): ResearchGatedProviderSignal => {
  const signal = emptyResearchGatedProviderSignal();
  for (const diagnostic of diagnostics) {
    const reasonCode = readDiagnosticReasonCode(diagnostic);
    if (reasonCode || diagnostic.blockerType === "auth_required" || diagnostic.blockerType === "anti_bot_challenge") {
      addProviderSignal(signal, typeof diagnostic.provider === "string" ? diagnostic.provider : undefined, reasonCode);
    }
  }
  return signal;
};

const detectResearchGatedProviderSignal = (input: ResearchHandoffInput): ResearchGatedProviderSignal | null => {
  return normalizeResearchGatedProviderSignal(mergeResearchGatedProviderSignals([
    detectResearchFailureSignals(input.failures ?? []),
    detectResearchCookieSignals(input.cookieDiagnostics ?? []),
    detectResearchChallengeSignals(input.challengeOrchestration ?? [])
  ]));
};

const buildResearchRecoveryRerunCommand = (
  input: ResearchHandoffInput,
  signal: ResearchGatedProviderSignal
): string => buildResearchRerunCommand(input, {
  browserMode: "extension",
  useCookies: signal.useCookies,
  challengeAutomationMode: "browser_with_helper"
});

type ShoppingHandoffInput = {
  query: string;
  providers?: string[];
  budget?: number;
  region?: string;
  browserMode?: string;
  sort?: string;
};

const buildShoppingRerunCommand = (input: ShoppingHandoffInput): string => {
  const providers = input.providers?.length
    ? ` --providers ${input.providers.join(",")}`
    : " --providers shopping/bestbuy,shopping/ebay";
  const budget = typeof input.budget === "number" ? ` --budget ${input.budget}` : "";
  const region = input.region ? ` --region ${quoteCliValue(input.region)}` : "";
  const browserMode = ` --browser-mode ${input.browserMode ?? "managed"}`;
  const sort = input.sort ? ` --sort ${input.sort}` : "";
  return cliExample(
    "shopping run",
    `--query ${quoteCliValue(input.query)}${providers}${budget}${region}${browserMode}${sort} --use-cookies --challenge-automation-mode browser_with_helper --mode json --output-format json`
  );
};

type ProductVideoReadinessHandoffInput = Pick<ProductVideoReadinessSummary, "status" | "warnings" | "reasonCodes">;

type ProductVideoProviderGuidanceInput = {
  reason: string;
  recommendedNextCommands: readonly string[];
};

type ProductVideoHandoffInput = {
  productUrl?: string;
  productName?: string;
  providerHint?: string;
  browserMode?: string;
  includeScreenshots?: boolean;
  includeAllImages?: boolean;
  includeCopy?: boolean;
  presentationReadiness?: ProductVideoReadinessHandoffInput;
  productVideoReadiness?: ProductVideoReadinessHandoffInput;
  primaryConstraintSummary?: string;
  providerGuidance?: ProductVideoProviderGuidanceInput;
};

const buildProductVideoRerunCommand = (input: ProductVideoHandoffInput = {}): string => {
  const target = input.productUrl
    ? `--product-url ${quoteCliValue(input.productUrl)}`
    : `--product-name ${quoteCliValue(input.productName ?? "<product-name>")}`;
  const providerHint = input.providerHint ? ` --provider-hint ${input.providerHint}` : "";
  const screenshots = input.includeScreenshots ? " --include-screenshots" : "";
  const allImages = input.includeAllImages ? " --include-all-images" : "";
  const includeCopy = input.includeCopy ? " --include-copy" : "";
  const browserMode = ` --browser-mode ${input.browserMode ?? "managed"}`;
  return cliExample(
    "product-video run",
    `${target}${providerHint}${screenshots}${allImages}${includeCopy}${browserMode} --use-cookies --challenge-automation-mode browser_with_helper --output-format json`
  );
};

type MacroResolveHandoffInput = {
  expression: string;
  defaultProvider?: string;
  execute: boolean;
  blocked: boolean;
  executionNeedsCompletionReview?: boolean;
};

type MacroExecutionCompletenessInput = {
  failures: readonly ProviderFailureEntry[];
  meta: {
    ok: boolean;
    partial: boolean;
  };
};

type InspiredesignSuccessHandoffInput = {
  summary: string;
  nextStep: string;
  commandExamples: {
    loadBestPractices: string;
    loadDesignAgent: string;
    loadMotionDesign: string;
    continueInCanvas: string;
  };
  deepCaptureRecommendation: string;
  nextStepGuidance?: NextStepGuidance;
};

const extractPrimaryConstraintSentence = (summary: string): string | null => {
  const match = /^Primary constraint:\s+(.+?\.)\s/.exec(summary);
  return match?.[1] ?? null;
};

const buildMacroResolveArgs = (
  input: MacroResolveHandoffInput,
  options?: {
    execute?: boolean;
    browserMode?: "extension" | "managed";
    useCookies?: boolean;
    challengeAutomationMode?: "browser" | "browser_with_helper";
    cookiePolicyOverride?: "off" | "auto" | "required";
  }
): string => {
  const defaultProvider = input.defaultProvider ? ` --default-provider ${input.defaultProvider}` : "";
  const execute = options?.execute ? " --execute" : "";
  const browserMode = options?.browserMode ? ` --browser-mode ${options.browserMode}` : "";
  const useCookies = options?.useCookies ? " --use-cookies" : "";
  const challenge = options?.challengeAutomationMode
    ? ` --challenge-automation-mode ${options.challengeAutomationMode}`
    : "";
  const cookiePolicy = options?.cookiePolicyOverride
    ? ` --cookie-policy ${options.cookiePolicyOverride}`
    : "";
  const outputFormat = " --output-format json";
  return `--expression ${quoteCliValue(input.expression)}${defaultProvider}${execute}${browserMode}${useCookies}${cookiePolicy}${challenge}${outputFormat}`;
};

const buildMacroPreviewCommand = (input: MacroResolveHandoffInput): string => (
  cliExample("macro-resolve", buildMacroResolveArgs(input))
);

const buildMacroExecuteCommand = (
  input: MacroResolveHandoffInput,
  challengeAutomationMode?: "browser" | "browser_with_helper",
  browserMode?: "extension" | "managed"
): string => (
  cliExample("macro-resolve", buildMacroResolveArgs(input, {
    execute: true,
    browserMode,
    ...(browserMode === "extension" ? { useCookies: true, cookiePolicyOverride: "required" } : {}),
    challengeAutomationMode
  }))
);

const buildResearchGatedSuccessHandoff = (
  input: ResearchHandoffInput,
  signal: ResearchGatedProviderSignal
): WorkflowSuccessHandoff => {
  const recoveryCommand = buildResearchRecoveryRerunCommand(input, signal);
  const providers = signal.providers.length > 0 ? signal.providers.join(", ") : "gated providers";
  const cookieNote = signal.useCookies
    ? " The command includes --use-cookies because cookie diagnostics show available cookies."
    : " Add --use-cookies only when legitimate provider cookies are available.";
  const handoff = createSuccessHandoff(
    `Review ranked records, artifact metadata, and gated-provider diagnostics for ${providers} before publishing claims.`,
    `Open the returned artifact path, inspect records.json, context.json, meta.json, and report.md, then rerun ${recoveryCommand} only with a user-authorized signed-in relay session.${cookieNote}`,
    [
      { reason: "Check records.json, context.json, meta.json, failures, and cookie diagnostics before using the result as evidence." },
      {
        reason: "Rerun with an existing signed-in extension session and browser-scoped challenge assistance when gated providers blocked useful evidence.",
        command: recoveryCommand
      },
      { reason: "Keep SERPs discovery-only and publish only claims supported by destination records that passed review." }
    ]
  );
  const guidance = routeNextStepGuidance({
    workflow: "research",
    reasonCode: "gated_provider",
    requestedProviders: signal.providers,
    browserMode: "extension",
    useCookies: signal.useCookies,
    details: {
      topic: input.topic,
      reasonCodes: signal.reasonCodes
    }
  });
  return {
    ...handoff,
    nextStepGuidance: renderWorkflowGuidance(guidance)
  };
};

const buildResearchDefaultSuccessHandoff = (input: ResearchHandoffInput): WorkflowSuccessHandoff => {
  const rerunCommand = buildResearchRerunCommand(input);
  return createSuccessHandoff(
    "Review ranked records, artifact metadata, and source support before turning the result into a publishable claim.",
    `Open the returned artifact path, inspect records.json, context.json, meta.json, and report.md, then rerun ${rerunCommand} if you need a tighter evidence set.`,
    [
      { reason: "Check which ranked records and artifact metadata actually support the final claim." },
      {
        reason: "Rerun with explicit sources and a narrower timebox if the evidence set is still too broad.",
        command: rerunCommand
      }
    ]
  );
};

export const buildResearchSuccessHandoff = (input: ResearchHandoffInput): WorkflowSuccessHandoff => {
  const signal = detectResearchGatedProviderSignal(input);
  return signal
    ? buildResearchGatedSuccessHandoff(input, signal)
    : buildResearchDefaultSuccessHandoff(input);
};

export const buildShoppingSuccessHandoff = (input: ShoppingHandoffInput): WorkflowSuccessHandoff => {
  const rerunCommand = buildShoppingRerunCommand(input);
  return createSuccessHandoff(
    "Review the offer set and diagnostics before calling any result a strong deal.",
    `Inspect the offers and meta.offerFilterDiagnostics, then rerun ${rerunCommand} if you need a tighter comparison.`,
    [
      { reason: "Check which offers survived the workflow filters and why." },
      {
        reason: "Rerun with explicit providers or updated budget and region inputs if the comparison is still noisy.",
        command: rerunCommand
      }
    ]
  );
};

const PRODUCT_VIDEO_READINESS_SEVERITY: Record<ProductVideoReadinessStatus, number> = {
  pass: 0,
  partial: 1,
  fail: 2
};

const productVideoHandoffStatus = (input: ProductVideoHandoffInput): ProductVideoReadinessStatus | undefined => {
  const hasPresentationReadiness = Boolean(input.presentationReadiness);
  const hasProductVideoReadiness = Boolean(input.productVideoReadiness);
  const statuses = [
    input.presentationReadiness?.status,
    input.productVideoReadiness?.status
  ].filter((status): status is ProductVideoReadinessStatus => Boolean(status));
  if (statuses.length === 0) return undefined;
  if (!hasPresentationReadiness || !hasProductVideoReadiness) statuses.push("partial");
  return statuses.reduce((worst, status) => (
    PRODUCT_VIDEO_READINESS_SEVERITY[status] > PRODUCT_VIDEO_READINESS_SEVERITY[worst] ? status : worst
  ));
};

const productVideoHandoffHasMissingReadiness = (input: ProductVideoHandoffInput): boolean => (
  Boolean(input.presentationReadiness) !== Boolean(input.productVideoReadiness)
);

const productVideoHandoffReasonCodes = (input: ProductVideoHandoffInput): string => {
  const reasonCodes = [
    ...(input.presentationReadiness?.reasonCodes ?? []),
    ...(input.productVideoReadiness?.reasonCodes ?? []),
    ...(productVideoHandoffHasMissingReadiness(input) ? ["readiness_missing"] : [])
  ];
  const uniqueCodes = Array.from(new Set(reasonCodes));
  return uniqueCodes.length > 0 ? uniqueCodes.join(", ") : "none";
};

const productVideoHandoffWarnings = (input: ProductVideoHandoffInput): string => {
  const warnings = [
    ...(input.presentationReadiness?.warnings ?? []),
    ...(input.productVideoReadiness?.warnings ?? []),
    ...(productVideoHandoffHasMissingReadiness(input) ? ["both presentation and product-video readiness surfaces are required before production pass"] : [])
  ];
  const uniqueWarnings = Array.from(new Set(warnings));
  return uniqueWarnings.length > 0 ? uniqueWarnings.join("; ") : "none";
};

const productVideoHandoffFollowthroughSummary = (input: ProductVideoHandoffInput): string => {
  const status = productVideoHandoffStatus(input);
  if (status === "fail") {
    return "Product-video readiness is fail. Treat copy.md and features.md as diagnostics only until presentation-readiness.json reason codes are fixed.";
  }
  if (status === "partial") {
    return "Product-video readiness is partial for the generated asset pack. Use copy.md and features.md only as gated draft input until warnings and reason codes are resolved.";
  }
  if (status === "pass") {
    return "Product-video readiness is pass. Review the visual-ready asset pack, readiness evidence, and raw/source-record.json before briefing production.";
  }
  return "Review presentation-readiness.json and manifest.readiness before briefing production from the generated asset pack.";
};

const productVideoHandoffNextAction = (input: ProductVideoHandoffInput): string => {
  const status = productVideoHandoffStatus(input);
  const reasonCodes = productVideoHandoffReasonCodes(input);
  const warningSummary = productVideoHandoffWarnings(input);
  if (status === "fail") {
    return `Open presentation-readiness.json and manifest.readiness before briefing production. Readiness failed with reason codes: ${reasonCodes}. The product-video brief helper exits nonzero for fail and must not label copy or features as verified production input.`;
  }
  if (status === "partial") {
    return `Open presentation-readiness.json and manifest.readiness, then run the product-video brief helper to generate a gated brief with warnings. Reason codes: ${reasonCodes}. Warnings: ${warningSummary}.`;
  }
  if (status === "pass") {
    return "Open the returned pack path, inspect manifest.json, presentation-readiness.json, copy.md, features.md, and raw/source-record.json, then run the product-video brief helper with that manifest path to generate production briefs and sourcing notes.";
  }
  return "Open the returned pack path, inspect manifest.json, presentation-readiness.json, copy.md, features.md, and raw/source-record.json, then run the product-video brief helper only after readiness is known.";
};

const productVideoReadinessInspectionReason = (input: ProductVideoHandoffInput): string => {
  const status = productVideoHandoffStatus(input) ?? "unknown";
  return `Inspect presentation-readiness.json plus manifest.readiness.presentation and manifest.readiness.productVideo before production use. Current readiness: ${status}. Reason codes: ${productVideoHandoffReasonCodes(input)}.`;
};

const productVideoBriefHelperReason = (input: ProductVideoHandoffInput): string => {
  const status = productVideoHandoffStatus(input);
  if (status === "fail") {
    return "Run the product-presentation-asset brief helper only for a warning diagnostic. It exits nonzero and blocks production briefs when readiness is fail.";
  }
  if (status === "partial") {
    return "Run the product-presentation-asset brief helper on manifest.json to generate gated brief files with warnings and reason codes.";
  }
  return "Run the product-presentation-asset brief helper on manifest.json to generate readiness-aware production brief files.";
};

const productVideoProviderRecoveryReason = (input: ProductVideoHandoffInput): string | null => {
  const guidance = input.providerGuidance;
  if (!guidance) return null;
  const commands = guidance.recommendedNextCommands.filter((command) => command.trim().length > 0);
  const commandSuffix = commands.length > 0 ? ` Next steps: ${commands.join(" ")}` : "";
  const summaryPrefix = input.primaryConstraintSummary ? `${input.primaryConstraintSummary} ` : "";
  return `${summaryPrefix}${guidance.reason}${commandSuffix}`;
};

export const buildProductVideoSuccessHandoff = (input: ProductVideoHandoffInput = {}): WorkflowSuccessHandoff => {
  const rerunCommand = buildProductVideoRerunCommand(input);
  const providerRecoveryReason = productVideoProviderRecoveryReason(input);
  return createSuccessHandoff(
    productVideoHandoffFollowthroughSummary(input),
    productVideoHandoffNextAction(input),
    [
      { reason: productVideoReadinessInspectionReason(input) },
      ...(providerRecoveryReason ? [{ reason: providerRecoveryReason }] : []),
      {
        reason: productVideoBriefHelperReason(input),
        command: PRODUCT_VIDEO_BRIEF_HELPER_COMMAND
      },
      {
        reason: "Rerun the asset workflow with adjusted provider or media flags when readiness is partial, fail, or the current pack is too thin.",
        command: rerunCommand
      },
      { reason: "Source or capture visuals before final handoff when readiness reports missing visual assets or the pack is metadata-first." }
    ]
  );
};

export const buildMacroResolveSuccessHandoff = (input: MacroResolveHandoffInput): WorkflowSuccessHandoff => {
  const previewCommand = buildMacroPreviewCommand(input);
  const executeCommand = buildMacroExecuteCommand(input);
  const browserRetryCommand = buildMacroExecuteCommand(input, "browser_with_helper", "extension");
  if (!input.execute) {
    return createSuccessHandoff(
      "Review the resolved provider action and provenance before executing the macro.",
      `Run ${executeCommand} when the resolved action looks correct.`,
      [
        { reason: "Inspect resolution.action and resolution.provenance to confirm provider and query shaping." },
        { reason: "Execute the resolved macro once the plan looks correct.", command: executeCommand },
        { reason: "Add --default-provider only when you need to force a different provider lane.", command: previewCommand }
      ]
    );
  }
  if (input.blocked) {
    return createSuccessHandoff(
      "Review execution.meta.blocker and failures before retrying the macro.",
      `Run ${browserRetryCommand} after checking execution.meta.blocker and the current recovery path.`,
      [
        { reason: "Inspect execution.meta.blocker and execution.failures before retrying." },
        { reason: "Retry with browser-scoped challenge automation when the blocker requires live follow-up.", command: browserRetryCommand },
        { reason: "Preview the resolved action again if you need to switch providers before another execute attempt.", command: previewCommand }
      ]
    );
  }
  if (input.executionNeedsCompletionReview) {
    return createSuccessHandoff(
      "Macro transport succeeded, but execution is incomplete and unblocked. Inspect execution.meta.ok, execution.meta.partial, and execution.failures before treating results as complete.",
      `Inspect execution.meta.ok, execution.meta.partial, and execution.failures, then rerun ${executeCommand} after resolving unblocked provider failures.`,
      [
        { reason: "Inspect execution.meta.ok, execution.meta.partial, and execution.failures to separate transport success from execution completeness." },
        { reason: "Rerun the macro after resolving provider failures or accepting partial results intentionally.", command: executeCommand },
        { reason: "Use browser-scoped challenge automation only if the incomplete execution points to a live browser recovery path.", command: browserRetryCommand }
      ]
    );
  }
  return createSuccessHandoff(
    "Review execution.records and trace metadata before widening the macro or changing providers.",
    `Inspect execution.records and execution.meta, then rerun ${previewCommand} if you need a narrower plan.`,
    [
      { reason: "Inspect execution.records and execution.meta to confirm the resolved action hit the expected lane." },
      { reason: "Preview the macro again before changing providers or expression scope.", command: previewCommand },
      { reason: "Re-execute with browser-scoped challenge automation when the target requires live browser recovery.", command: browserRetryCommand }
    ]
  );
};

export const macroExecutionNeedsCompletionReview = (execution: MacroExecutionCompletenessInput): boolean => (
  !execution.meta.ok || execution.meta.partial || execution.failures.length > 0
);

export const buildInspiredesignSuccessHandoff = (
  input: InspiredesignSuccessHandoffInput
): WorkflowSuccessHandoff => {
  if (input.nextStepGuidance && input.nextStepGuidance.readiness !== "ready") {
    const primaryConstraint = extractPrimaryConstraintSentence(input.summary);
    const summary = primaryConstraint
      ? `Primary constraint: ${primaryConstraint} ${input.nextStepGuidance.primaryAction.summary}`
      : undefined;
    const compatibility = renderWorkflowCompatibility(input.nextStepGuidance, summary);
    return {
      ...compatibility,
      nextStepGuidance: renderWorkflowGuidance(input.nextStepGuidance)
    };
  }
  const handoff = createSuccessHandoff(
    input.summary,
    input.nextStep,
    [
    { reason: INSPIREDESIGN_HANDOFF_GUIDANCE.reviewAdvancedBrief },
    {
      reason: "Load the baseline workflow runbook before implementation.",
      command: input.commandExamples.loadBestPractices
    },
    {
      reason: "Load the Canvas contract lane before patching.",
      command: input.commandExamples.loadDesignAgent
    },
    {
      reason: "Load the motion-design lane before translating visual evidence into animation, timing, or reduced-motion behavior.",
      command: input.commandExamples.loadMotionDesign
    },
    { reason: INSPIREDESIGN_HANDOFF_GUIDANCE.visualArtifactRecommendation },
    {
      reason: INSPIREDESIGN_HANDOFF_GUIDANCE.prepareCanvasPlanRequest,
      command: input.commandExamples.continueInCanvas
    },
    { reason: input.deepCaptureRecommendation }
    ]
  );
  return input.nextStepGuidance
    ? { ...handoff, nextStepGuidance: renderWorkflowGuidance(input.nextStepGuidance) }
    : handoff;
};
