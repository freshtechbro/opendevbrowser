import { describe, expect, it } from "vitest";
import {
  buildInspiredesignSuccessHandoff,
  PRODUCT_VIDEO_BRIEF_HELPER_PATH,
  buildMacroResolveSuccessHandoff,
  buildProductVideoSuccessHandoff,
  buildResearchSuccessHandoff,
  buildShoppingSuccessHandoff
} from "../src/providers/workflow-handoff";
import {
  buildCanvasCommandGuidance,
  getCanvasRequiredNextCommands
} from "../src/canvas/guidance";
import { INSPIREDESIGN_HANDOFF_COMMANDS, INSPIREDESIGN_HANDOFF_GUIDANCE } from "../src/inspiredesign/handoff";

describe("workflow handoff builders", () => {
  it("builds research rerun guidance with explicit source and timebox flags", () => {
    const handoff = buildResearchSuccessHandoff({
      topic: "browser automation blockers"
    });

    expect(handoff.suggestedNextAction).toContain(
      "npx opendevbrowser research run --topic \"browser automation blockers\" --days 14 --sources web,community --browser-mode managed --mode json --output-format json"
    );
    expect(handoff.suggestedSteps[1]?.command).toContain("--sources web,community");
    expect(handoff.suggestedSteps[1]?.command).not.toContain("--source-selection auto");
    expect(handoff.suggestedSteps[1]?.command).toContain("--browser-mode managed");
    expect(handoff.suggestedNextAction).toContain("records.json, context.json, meta.json, and report.md");
    expect(handoff.followthroughSummary).toContain("artifact metadata");
  });

  it("preserves requested research browser mode in rerun guidance", () => {
    const handoff = buildResearchSuccessHandoff({
      topic: "signed-in social research",
      browserMode: "extension"
    });

    expect(handoff.suggestedSteps[1]?.command).toContain("--browser-mode extension");
  });

  it("falls back to default shopping providers and managed mode when optional inputs are absent", () => {
    const handoff = buildShoppingSuccessHandoff({
      query: "ergonomic mouse"
    });

    expect(handoff.suggestedNextAction).toContain(
      "npx opendevbrowser shopping run --query \"ergonomic mouse\" --providers shopping/bestbuy,shopping/ebay --browser-mode managed --use-cookies --challenge-automation-mode browser_with_helper --mode json --output-format json"
    );
    expect(handoff.suggestedSteps[1]?.command).not.toContain("--budget");
    expect(handoff.suggestedSteps[1]?.command).not.toContain("--region");
  });

  it("preserves product-name reruns when no canonical product url is available yet", () => {
    const handoff = buildProductVideoSuccessHandoff({
      productName: "Desk Lamp",
      includeCopy: true
    });

    expect(handoff.suggestedNextAction).toContain("product-video brief helper");
    expect(handoff.suggestedNextAction).not.toContain("<pack>");
    expect(handoff.suggestedSteps[1]?.command).toBe(`${PRODUCT_VIDEO_BRIEF_HELPER_PATH} <pack>/manifest.json`);
    expect(handoff.suggestedSteps[2]?.command).toBe(
      "npx opendevbrowser product-video run --product-name \"Desk Lamp\" --include-copy --browser-mode managed --use-cookies --challenge-automation-mode browser_with_helper --output-format json"
    );
  });

  it("builds product-url reruns with provider and media flags", () => {
    const handoff = buildProductVideoSuccessHandoff({
      productUrl: "https://shop.example/item-1",
      providerHint: "amazon",
      browserMode: "extension",
      includeScreenshots: true,
      includeAllImages: true,
      includeCopy: true
    });

    expect(handoff.suggestedSteps[2]?.command).toBe(
      "npx opendevbrowser product-video run --product-url \"https://shop.example/item-1\" --provider-hint amazon --include-screenshots --include-all-images --include-copy --browser-mode extension --use-cookies --challenge-automation-mode browser_with_helper --output-format json"
    );
  });

  it("falls back to the placeholder product-name token when no rerun target is known yet", () => {
    const handoff = buildProductVideoSuccessHandoff();

    expect(handoff.suggestedSteps[2]?.command).toBe(
      "npx opendevbrowser product-video run --product-name \"<product-name>\" --browser-mode managed --use-cookies --challenge-automation-mode browser_with_helper --output-format json"
    );
  });

  it("uses preview-only macro guidance before execution", () => {
    const handoff = buildMacroResolveSuccessHandoff({
      expression: '@media.search(\"browser automation\", \"youtube\", 5)',
      defaultProvider: "social/youtube",
      execute: false,
      blocked: false
    });

    expect(handoff.suggestedNextAction).toContain("--execute");
    expect(handoff.suggestedSteps[1]?.command).toContain("--execute");
    expect(handoff.suggestedSteps[2]?.command).toContain("--default-provider social/youtube");
  });

  it("uses blocker-aware browser retry guidance after an execute failure", () => {
    const handoff = buildMacroResolveSuccessHandoff({
      expression: '@media.search(\"browser automation\", \"facebook\", 5)',
      execute: true,
      blocked: true
    });

    expect(handoff.followthroughSummary).toContain("execution.meta.blocker");
    expect(handoff.suggestedNextAction).toContain("--browser-mode extension");
    expect(handoff.suggestedNextAction).toContain("--challenge-automation-mode browser_with_helper");
    expect(handoff.suggestedSteps[1]?.command).toContain("--browser-mode extension");
    expect(handoff.suggestedSteps[1]?.command).toContain("--challenge-automation-mode browser_with_helper");
  });

  it("keeps preview-first follow-through after a successful execute run", () => {
    const handoff = buildMacroResolveSuccessHandoff({
      expression: '@media.search(\"browser automation\", \"facebook\", 5)',
      execute: true,
      blocked: false
    });

    expect(handoff.suggestedNextAction).toContain("macro-resolve --expression");
    expect(handoff.suggestedSteps[1]?.command).toContain("macro-resolve --expression");
    expect(handoff.suggestedSteps[2]?.command).toContain("--browser-mode extension");
    expect(handoff.suggestedSteps[2]?.command).toContain("--challenge-automation-mode browser_with_helper");
  });

  it("builds inspiredesign handoff steps from the shared workflow seam", () => {
    const handoff = buildInspiredesignSuccessHandoff({
      summary: "Read the generated artifacts before continuing.",
      nextStep: "Continue in Canvas after loading skills.",
      commandExamples: INSPIREDESIGN_HANDOFF_COMMANDS,
      deepCaptureRecommendation: "Rerun only when reference evidence must be refreshed."
    });

    expect(handoff.followthroughSummary).toBe("Read the generated artifacts before continuing.");
    expect(handoff.suggestedNextAction).toBe("Continue in Canvas after loading skills.");
    expect(handoff.suggestedSteps).toEqual([
      { reason: INSPIREDESIGN_HANDOFF_GUIDANCE.reviewAdvancedBrief },
      {
        reason: "Load the baseline workflow runbook before implementation.",
        command: INSPIREDESIGN_HANDOFF_COMMANDS.loadBestPractices
      },
      {
        reason: "Load the Canvas contract lane before patching.",
        command: INSPIREDESIGN_HANDOFF_COMMANDS.loadDesignAgent
      },
      {
        reason: INSPIREDESIGN_HANDOFF_GUIDANCE.prepareCanvasPlanRequest,
        command: INSPIREDESIGN_HANDOFF_COMMANDS.continueInCanvas
      },
      { reason: "Rerun only when reference evidence must be refreshed." }
    ]);
  });

  it.each([
    ["missing", "canvas.plan.set", ["canvas.plan.set"]],
    ["submitted", "canvas.document.patch", ["canvas.plan.set"]],
    ["invalid", "canvas.document.patch", ["canvas.plan.set"]],
    ["accepted", "canvas.document.patch", ["canvas.preview.render", "canvas.feedback.poll", "canvas.document.save"]],
    ["accepted", "canvas.session.open", ["canvas.document.patch", "canvas.preview.render", "canvas.feedback.poll", "canvas.document.save"]]
  ])("builds canvas guidance for %s plan status and %s", (planStatus, command, expectedCommands) => {
    expect(buildCanvasCommandGuidance({
      planStatus,
      command: command as Parameters<typeof buildCanvasCommandGuidance>[0]["command"]
    }).recommendedNextCommands).toEqual(expectedCommands);
  });

  it.each([
    ["plan_required", ["canvas.plan.set"]],
    ["generation_plan_invalid", ["canvas.plan.set", "canvas.plan.get"]],
    ["revision_conflict", ["canvas.document.load"]],
    ["policy_violation", ["canvas.plan.get", "canvas.document.load"]],
    ["unsupported_target", ["canvas.session.status"]],
    ["lease_reclaim_required", ["canvas.session.status"]]
  ] as const)("returns canvas blocker commands for %s", (code, expectedCommands) => {
    expect(getCanvasRequiredNextCommands(code)).toEqual(expectedCommands);
  });

  it("clones canvas guidance command arrays", () => {
    const commands = getCanvasRequiredNextCommands("plan_required");
    commands.push("canvas.document.patch");

    expect(getCanvasRequiredNextCommands("plan_required")).toEqual(["canvas.plan.set"]);
  });
});
