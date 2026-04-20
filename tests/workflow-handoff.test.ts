import { describe, expect, it } from "vitest";
import {
  PRODUCT_VIDEO_BRIEF_HELPER_PATH,
  buildMacroResolveSuccessHandoff,
  buildProductVideoSuccessHandoff,
  buildResearchSuccessHandoff,
  buildShoppingSuccessHandoff
} from "../src/providers/workflow-handoff";

describe("workflow handoff builders", () => {
  it("builds research rerun guidance with explicit source and timebox flags", () => {
    const handoff = buildResearchSuccessHandoff("browser automation blockers");

    expect(handoff.suggestedNextAction).toContain(
      "npx opendevbrowser research run --topic \"browser automation blockers\" --days 14 --source-selection auto --sources web,community --mode json --output-format json"
    );
    expect(handoff.suggestedSteps[1]?.command).toContain("--sources web,community");
  });

  it("falls back to default shopping providers and managed mode when optional inputs are absent", () => {
    const handoff = buildShoppingSuccessHandoff({
      query: "ergonomic mouse"
    });

    expect(handoff.suggestedNextAction).toContain(
      "npx opendevbrowser shopping run --query \"ergonomic mouse\" --providers shopping/bestbuy,shopping/ebay --browser-mode managed --mode json --output-format json"
    );
    expect(handoff.suggestedSteps[1]?.command).not.toContain("--budget");
    expect(handoff.suggestedSteps[1]?.command).not.toContain("--region");
  });

  it("preserves product-name reruns when no canonical product url is available yet", () => {
    const handoff = buildProductVideoSuccessHandoff({
      productName: "Desk Lamp",
      includeCopy: true
    });

    expect(handoff.suggestedNextAction).toContain(PRODUCT_VIDEO_BRIEF_HELPER_PATH);
    expect(handoff.suggestedSteps[1]?.command).toBe(`${PRODUCT_VIDEO_BRIEF_HELPER_PATH} <pack>/manifest.json`);
    expect(handoff.suggestedSteps[2]?.command).toBe(
      "npx opendevbrowser product-video run --product-name \"Desk Lamp\" --include-copy --output-format json"
    );
  });

  it("falls back to the placeholder product-name token when no rerun target is known yet", () => {
    const handoff = buildProductVideoSuccessHandoff();

    expect(handoff.suggestedSteps[2]?.command).toBe(
      "npx opendevbrowser product-video run --product-name \"<product-name>\" --output-format json"
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
    expect(handoff.suggestedNextAction).toContain("--challenge-automation-mode browser");
    expect(handoff.suggestedSteps[1]?.command).toContain("--challenge-automation-mode browser");
  });

  it("keeps preview-first follow-through after a successful execute run", () => {
    const handoff = buildMacroResolveSuccessHandoff({
      expression: '@media.search(\"browser automation\", \"facebook\", 5)',
      execute: true,
      blocked: false
    });

    expect(handoff.suggestedNextAction).toContain("macro-resolve --expression");
    expect(handoff.suggestedSteps[1]?.command).toContain("macro-resolve --expression");
    expect(handoff.suggestedSteps[2]?.command).toContain("--challenge-automation-mode browser");
  });
});
