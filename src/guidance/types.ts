import type { JsonValue } from "../providers/types";

export type GuidanceWorkflow =
  | "inspiredesign"
  | "canvas"
  | "provider"
  | "daemon"
  | "cli"
  | "research"
  | "shopping"
  | "product_video"
  | "macro";

export type GuidanceRecipeType =
  | "workflow_entry"
  | "site_navigation"
  | "schema_repair"
  | "evidence_recovery"
  | "artifact_handoff"
  | "quality_gate";

export type GuidanceSeverity = "info" | "warning" | "blocked" | "fatal";
export type GuidanceReadiness = "ready" | "needs_input" | "needs_recovery" | "blocked" | "diagnostic_only";

export type GuidanceAction = {
  id: string;
  label: string;
  summary: string;
};

export type GuidanceCommandExample = {
  id: string;
  label: string;
  command: string;
  placeholders?: Record<string, string>;
};

export type GuidanceParamsExample = {
  id: string;
  label: string;
  command?: string;
  params: JsonValue;
};

export type GuidanceFieldExample = {
  path: string;
  description: string;
  example: JsonValue;
  expected?: string;
  received?: string;
};

export type GuidanceArtifactInput = {
  path: string;
  purpose: string;
  required: boolean;
};

export type GuidanceValidationCheck = {
  id: string;
  description: string;
  assertion?: string;
  command?: string;
};

export type GuidanceFallbackPolicy = {
  allowed: boolean;
  requiresUserConfirmation: boolean;
  reason: string;
};

export type GuidanceEvidenceContext = {
  referenceCount?: number;
  referenceEvidenceRequired?: boolean;
  rankedReferenceCount?: number;
  rejectedReferenceCount?: number;
  topReferenceScore?: number;
  topReferenceConfidence?: number;
  topReferenceIntentMatched?: boolean;
  failedCaptureCount?: number;
  missingScreenshotCount?: number;
  visualEvidenceRequired?: boolean;
  diagnosticOnlyReasons?: string[];
};

export type GuidanceContext = {
  workflow: GuidanceWorkflow;
  reasonCode?: string;
  requestedProviders?: string[];
  siteRecipeId?: string;
  query?: string;
  browserMode?: string;
  cookiePolicy?: string;
  useCookies?: boolean;
  providerUnavailable?: boolean;
  evidence?: GuidanceEvidenceContext;
  details?: Record<string, JsonValue>;
};

export type NextStepGuidance = {
  id: string;
  recipeType: GuidanceRecipeType;
  workflow: GuidanceWorkflow;
  severity: GuidanceSeverity;
  readiness: GuidanceReadiness;
  reasonCode: string;
  primaryAction: GuidanceAction;
  commands: GuidanceCommandExample[];
  paramsExamples: GuidanceParamsExample[];
  fieldExamples: GuidanceFieldExample[];
  artifactInputs: GuidanceArtifactInput[];
  validationChecks: GuidanceValidationCheck[];
  fallbackPolicy: GuidanceFallbackPolicy;
  doNotProceedIf: string[];
};

export type GuidanceRecipe = {
  id: string;
  recipeType: GuidanceRecipeType;
  workflow: GuidanceWorkflow;
  priority: number;
  reasonCode: string;
  matches: (context: GuidanceContext) => boolean;
  build: (context: GuidanceContext, readiness: GuidanceReadiness) => NextStepGuidance;
};

export type SiteRecipeAuthMode = "public" | "authenticated" | "authenticated_preferred";

export type SiteRecipeNavigationStep = {
  id: string;
  instruction: string;
};

export type SiteRecipeBadState = {
  id: string;
  markers: string[];
  reasonCode: string;
  recoveryAction: string;
};

export type SiteRecipeEvidenceRequirement = {
  id: string;
  description: string;
  validation: string;
};

export type SiteRecipeRecoveryStep = {
  id: string;
  instruction: string;
};

export type SiteRecipeReferenceCandidate = {
  url?: string;
  content?: string;
  html?: string;
  links?: string[];
};

export type SiteRecipeBrowserNativeDiscovery = {
  buildSearchUrl: (query: string) => string;
  extractReferenceUrls?: (candidate: SiteRecipeReferenceCandidate) => string[];
};

export type SiteRecipe = {
  id: string;
  providerIds: string[];
  hostnames: string[];
  authMode: SiteRecipeAuthMode;
  navigationSteps: SiteRecipeNavigationStep[];
  badStates: SiteRecipeBadState[];
  evidenceRequirements: SiteRecipeEvidenceRequirement[];
  recoverySteps: SiteRecipeRecoveryStep[];
  browserNativeDiscovery?: SiteRecipeBrowserNativeDiscovery;
  guidance: NextStepGuidance;
};
