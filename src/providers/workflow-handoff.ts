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

const createSuccessHandoff = (
  followthroughSummary: string,
  suggestedNextAction: string,
  suggestedSteps: WorkflowSuccessStep[]
): WorkflowSuccessHandoff => ({
  followthroughSummary,
  suggestedNextAction,
  suggestedSteps
});

export const buildResearchSuccessHandoff = (): WorkflowSuccessHandoff => {
  return createSuccessHandoff(
    "Review the ranked records and artifact bundle before turning the result into a publishable claim.",
    "Open the returned artifact path, inspect the supporting records, and rerun with explicit --sources or a tighter timebox if you need stronger evidence.",
    [
      { reason: "Check which records actually support the final claim." },
      { reason: "Rerun with explicit sources or a narrower timebox if the evidence set is still too broad." }
    ]
  );
};

export const buildShoppingSuccessHandoff = (): WorkflowSuccessHandoff => {
  return createSuccessHandoff(
    "Review the offer set and diagnostics before calling any result a strong deal.",
    "Inspect the offers and meta.offerFilterDiagnostics, then rerun with explicit providers or budget and region adjustments if you need a tighter comparison.",
    [
      { reason: "Check which offers survived the workflow filters and why." },
      { reason: "Rerun with explicit providers or updated budget and region inputs if the comparison is still noisy." }
    ]
  );
};

export const buildProductVideoSuccessHandoff = (): WorkflowSuccessHandoff => {
  return createSuccessHandoff(
    "Review the generated asset pack to confirm whether it is visual-ready or metadata-first before briefing production.",
    `Open the returned pack path, inspect manifest.json plus copy and features, then run ${PRODUCT_VIDEO_BRIEF_HELPER_COMMAND} to generate production briefs and sourcing notes.`,
    [
      { reason: "Confirm whether the pack already includes enough images or screenshots for production." },
      {
        reason: "Run the product-presentation-asset brief helper on manifest.json to generate the production brief files.",
        command: PRODUCT_VIDEO_BRIEF_HELPER_COMMAND
      },
      { reason: "Source or capture visuals before final handoff if the pack is metadata-first." }
    ]
  );
};
