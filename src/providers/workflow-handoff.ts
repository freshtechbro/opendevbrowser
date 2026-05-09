import { INSPIREDESIGN_HANDOFF_GUIDANCE } from "../inspiredesign/handoff";

export type WorkflowSuccessStep = {
  reason: string;
  command?: string;
};

export type WorkflowSuccessHandoff = {
  followthroughSummary: string;
  suggestedNextAction: string;
  suggestedSteps: WorkflowSuccessStep[];
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

const cliExample = (command: string, args = ""): string => (
  `npx opendevbrowser ${command}${args ? ` ${args}` : ""}`
);

const quoteCliValue = (value: string): string => JSON.stringify(value);

type ResearchHandoffInput = {
  topic: string;
  browserMode?: string;
};

const buildResearchRerunCommand = (input: ResearchHandoffInput): string => (
  cliExample(
    "research run",
    `--topic ${quoteCliValue(input.topic)} --days 14 --sources web,community --browser-mode ${input.browserMode ?? "managed"} --mode json --output-format json`
  )
);

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

type ProductVideoHandoffInput = {
  productUrl?: string;
  productName?: string;
  providerHint?: string;
  browserMode?: string;
  includeScreenshots?: boolean;
  includeAllImages?: boolean;
  includeCopy?: boolean;
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
};

type InspiredesignSuccessHandoffInput = {
  summary: string;
  nextStep: string;
  commandExamples: {
    loadBestPractices: string;
    loadDesignAgent: string;
    continueInCanvas: string;
  };
  deepCaptureRecommendation: string;
};

const buildMacroResolveArgs = (
  input: MacroResolveHandoffInput,
  options?: {
    execute?: boolean;
    browserMode?: "extension" | "managed";
    challengeAutomationMode?: "browser" | "browser_with_helper";
    includeOutputFormat?: boolean;
  }
): string => {
  const defaultProvider = input.defaultProvider ? ` --default-provider ${input.defaultProvider}` : "";
  const execute = options?.execute ? " --execute" : "";
  const browserMode = options?.browserMode ? ` --browser-mode ${options.browserMode}` : "";
  const challenge = options?.challengeAutomationMode
    ? ` --challenge-automation-mode ${options.challengeAutomationMode}`
    : "";
  const outputFormat = options?.includeOutputFormat === false ? "" : " --output-format json";
  return `--expression ${quoteCliValue(input.expression)}${defaultProvider}${execute}${browserMode}${challenge}${outputFormat}`;
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
    challengeAutomationMode
  }))
);

export const buildResearchSuccessHandoff = (input: ResearchHandoffInput): WorkflowSuccessHandoff => {
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

export const buildProductVideoSuccessHandoff = (input: ProductVideoHandoffInput = {}): WorkflowSuccessHandoff => {
  const rerunCommand = buildProductVideoRerunCommand(input);
  return createSuccessHandoff(
    "Review the generated asset pack to confirm whether it is visual-ready or metadata-first before briefing production.",
    "Open the returned pack path, inspect manifest.json plus copy and features, then run the product-video brief helper with that manifest path to generate production briefs and sourcing notes.",
    [
      { reason: "Confirm whether the pack already includes enough images or screenshots for production." },
      {
        reason: "Run the product-presentation-asset brief helper on manifest.json to generate the production brief files.",
        command: PRODUCT_VIDEO_BRIEF_HELPER_COMMAND
      },
      {
        reason: "Rerun the asset workflow with adjusted provider or media flags when the current pack is too thin.",
        command: rerunCommand
      },
      { reason: "Source or capture visuals before final handoff if the pack is metadata-first." }
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

export const buildInspiredesignSuccessHandoff = (
  input: InspiredesignSuccessHandoffInput
): WorkflowSuccessHandoff => createSuccessHandoff(
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
      reason: INSPIREDESIGN_HANDOFF_GUIDANCE.prepareCanvasPlanRequest,
      command: input.commandExamples.continueInCanvas
    },
    { reason: input.deepCaptureRecommendation }
  ]
);
