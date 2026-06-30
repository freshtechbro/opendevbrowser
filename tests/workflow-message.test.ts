import { describe, expect, it } from "vitest";
import {
  buildInspiredesignFollowthroughSummary,
  buildInspiredesignNextStep
} from "../src/inspiredesign/handoff";
import {
  buildProviderFollowupErrorMessage,
  buildWorkflowCompletionMessage,
  readFollowthroughSummary,
  readSuggestedNextAction,
  readSuggestedStepCommand,
  readSuggestedStepReason,
  readWorkflowGuidanceNextStep
} from "../src/cli/utils/workflow-message";

describe("workflow message helpers", () => {
  it("reads inspiredesign success follow-through summaries and next steps", () => {
    const followthroughSummary = buildInspiredesignFollowthroughSummary();
    const data = {
      followthroughSummary,
      suggestedNextAction: buildInspiredesignNextStep()
    };

    expect(followthroughSummary).toContain("pin-media-index.json");
    expect(followthroughSummary).toContain("evidenceAuthority=pin_media_ready");
    expect(followthroughSummary).toContain("snapshot_ready and motion_ready are not substitutes");
    expect(followthroughSummary).not.toContain("screenshot-first, screencast-first, or canonical pin-media evidence");
    expect(buildWorkflowCompletionMessage("Inspiredesign workflow", data)).toBe(
      `Inspiredesign workflow completed. ${followthroughSummary} Next step: ${buildInspiredesignNextStep()}`
    );
  });

  it("reads camelCase primary constraint summaries and next steps", () => {
    const data = {
      meta: {
        primaryConstraintSummary: "Manual browser follow-up is required.",
        primaryConstraint: {
          guidance: {
            recommendedNextCommands: [
              "Run shopping run --query='example' --browser-mode extension"
            ]
          }
        }
      }
    };

    expect(buildWorkflowCompletionMessage("Shopping workflow", data)).toBe(
      "Shopping workflow completed with provider follow-up required: Manual browser follow-up is required. Next step: Run shopping run --query='example' --browser-mode extension"
    );
  });

  it("adds next steps to provider follow-up errors", () => {
    expect(buildProviderFollowupErrorMessage(
      "Bestbuy requires manual browser follow-up; this run did not determine whether login or page rendering is required."
    )).toBe(
      "Bestbuy requires manual browser follow-up; this run did not determine whether login or page rendering is required. Next step: Retry with browser assistance or a headed browser session."
    );
    expect(buildProviderFollowupErrorMessage(
      "Costco requires login or an existing session."
    )).toBe(
      "Costco requires login or an existing session. Next step: Reuse a user-authorized signed-in browser session, load cookies only from that authorized session, or use the provider sign-in flow."
    );
    expect(buildProviderFollowupErrorMessage(
      "Costco requires login or an existing session. Next step: Retry."
    )).toBe("Costco requires login or an existing session. Next step: Retry.");
  });

  it("infers next steps for explicit summaries when failures carry provider guidance", () => {
    const data = {
      meta: {
        primaryConstraintSummary: "Bestbuy requires manual browser follow-up.",
        failures: [{
          provider: "shopping/bestbuy",
          error: {
            reasonCode: "env_limited",
            details: {
              constraint: {
                kind: "render_required"
              }
            }
          }
        }]
      }
    };

    expect(buildWorkflowCompletionMessage("Product video workflow", data)).toBe(
      "Product video workflow completed with provider follow-up required: Bestbuy requires manual browser follow-up. Next step: Retry with browser assistance or a headed browser session."
    );
  });

  it("prefers explicit session-inspector guidance before challenge-plan fallback", () => {
    expect(readSuggestedNextAction({
      sessionInspector: {
        suggestedNextAction: "Run review-desktop --session-id s1"
      },
      challengePlan: {
        suggestedSteps: [{ reason: "Fallback step" }]
      }
    })).toBe("Run review-desktop --session-id s1");

    expect(readSuggestedStepReason({
      challengePlan: {
        suggestedSteps: [{ reason: "Run session-inspector-audit --session-id s1" }]
      }
    })).toBe("Run session-inspector-audit --session-id s1");
  });

  it("falls back to a suggested step command when explicit next action is absent", () => {
    const data = {
      followthroughSummary: "Review the asset pack before briefing production.",
      suggestedSteps: [
        {
          reason: "Rerun with a narrower provider mix if the pack is too thin.",
          command: "npx opendevbrowser product-video run --product-url \"https://example.com/p/1\" --include-screenshots --output-format json"
        }
      ]
    };

    expect(readSuggestedStepCommand(data)).toBe(
      "npx opendevbrowser product-video run --product-url \"https://example.com/p/1\" --include-screenshots --output-format json"
    );
    expect(buildWorkflowCompletionMessage("Product video workflow", data)).toBe(
      "Product video workflow completed. Review the asset pack before briefing production. Next step: npx opendevbrowser product-video run --product-url \"https://example.com/p/1\" --include-screenshots --output-format json"
    );
  });

  it("finds the first runnable command even when the first suggested step is informational", () => {
    const data = {
      followthroughSummary: "Review the pack before rerunning the workflow.",
      suggestedSteps: [
        {
          reason: "Check the current pack before deciding whether a rerun is necessary."
        },
        {
          reason: "Rerun with the resolved URL when the pack is too thin.",
          command: "npx opendevbrowser product-video run --product-url \"https://example.com/p/2\" --output-format json"
        }
      ]
    };

    expect(readSuggestedStepCommand(data)).toBe(
      "npx opendevbrowser product-video run --product-url \"https://example.com/p/2\" --output-format json"
    );
    expect(buildWorkflowCompletionMessage("Product video workflow", data)).toBe(
      "Product video workflow completed. Review the pack before rerunning the workflow. Next step: npx opendevbrowser product-video run --product-url \"https://example.com/p/2\" --output-format json"
    );
  });

  it("skips placeholder helper commands and returns the first concrete rerun command", () => {
    const data = {
      followthroughSummary: "Review the current pack, then rerun only if the assets are still too thin.",
      suggestedSteps: [
        {
          reason: "Generate briefing notes from the existing pack.",
          command: "./skills/opendevbrowser-product-presentation-agent/scripts/render-video-brief.sh <pack>/manifest.json"
        },
        {
          reason: "Rerun the workflow with the resolved product URL if you need a thicker pack.",
          command: "npx opendevbrowser product-video run --product-url \"https://example.com/p/3\" --provider-hint shopping/amazon --output-format json"
        }
      ]
    };

    expect(readSuggestedStepCommand(data)).toBe(
      "npx opendevbrowser product-video run --product-url \"https://example.com/p/3\" --provider-hint shopping/amazon --output-format json"
    );
    expect(buildWorkflowCompletionMessage("Product video workflow", data)).toBe(
      "Product video workflow completed. Review the current pack, then rerun only if the assets are still too thin. Next step: npx opendevbrowser product-video run --product-url \"https://example.com/p/3\" --provider-hint shopping/amazon --output-format json"
    );
  });

  it("exports follow-through summary reading from top-level and meta fields", () => {
    expect(readFollowthroughSummary({ followthroughSummary: "Review artifacts." })).toBe("Review artifacts.");
    expect(readFollowthroughSummary({
      meta: {
        followthroughSummary: "Review workflow metadata."
      }
    })).toBe("Review workflow metadata.");
  });

  it("prefers typed nextStepGuidance primary action before compatibility fields", () => {
    const data = {
      followthroughSummary: "Review gated-provider diagnostics.",
      suggestedNextAction: "Legacy next action",
      nextStepGuidance: {
        primaryAction: {
          summary: "Typed primary recovery action"
        }
      }
    };

    expect(readWorkflowGuidanceNextStep(data)).toBe("Typed primary recovery action");
    expect(buildWorkflowCompletionMessage("Research workflow", data)).toBe(
      "Research workflow completed. Review gated-provider diagnostics. Next step: Typed primary recovery action"
    );
  });

  it("prefers typed nextStepGuidance when provider follow-up summaries are present", () => {
    const data = {
      meta: {
        primaryConstraintSummary: "Pinterest requires login or an existing session.",
        primaryConstraint: {
          guidance: {
            recommendedNextCommands: [
              "Legacy provider recovery command"
            ]
          }
        }
      },
      nextStepGuidance: {
        primaryAction: {
          summary: "Use the Pinterest browser-native recipe with extension cookies."
        }
      }
    };

    expect(buildWorkflowCompletionMessage("Inspiredesign workflow", data)).toBe(
      "Inspiredesign workflow completed with provider follow-up required: Pinterest requires login or an existing session. Next step: Use the Pinterest browser-native recipe with extension cookies."
    );
  });

  it("prefers product-ready authority over partial provider follow-up summaries", () => {
    const data = {
      productSuccess: true,
      artifactAuthority: "product_ready",
      evidenceAuthority: "pin_media_ready",
      meta: {
        primaryConstraintSummary: "Pinterest requires manual browser follow-up for one rejected candidate."
      },
      nextStepGuidance: {
        readiness: "ready",
        workflow: "inspiredesign",
        primaryAction: {
          summary: "Read generated artifacts and continue in Canvas."
        }
      }
    };

    expect(buildWorkflowCompletionMessage("Inspiredesign workflow", data)).toBe(
      "Inspiredesign workflow completed with product-ready artifacts. Next step: Read generated artifacts and continue in Canvas."
    );
  });

  it("does not report product-ready artifacts when next-step guidance is not ready", () => {
    const data = {
      productSuccess: true,
      artifactAuthority: "product_ready",
      evidenceAuthority: "pin_media_ready",
      meta: {
        primaryConstraintSummary: "Pinterest requires manual browser follow-up."
      },
      nextStepGuidance: {
        readiness: "needs_recovery",
        workflow: "inspiredesign",
        primaryAction: {
          summary: "Use the Pinterest browser-native recipe with extension cookies."
        }
      }
    };

    expect(buildWorkflowCompletionMessage("Inspiredesign workflow", data)).toBe(
      "Inspiredesign workflow completed with provider follow-up required: Pinterest requires manual browser follow-up. Next step: Use the Pinterest browser-native recipe with extension cookies."
    );
  });

  it("does not report product-ready artifacts when ready guidance belongs to another workflow", () => {
    const data = {
      productSuccess: true,
      artifactAuthority: "product_ready",
      evidenceAuthority: "pin_media_ready",
      meta: {
        primaryConstraintSummary: "Shopping needs browser follow-up."
      },
      nextStepGuidance: {
        readiness: "ready",
        workflow: "inspiredesign",
        primaryAction: {
          summary: "Open the generated design canvas."
        }
      }
    };

    expect(buildWorkflowCompletionMessage("Shopping workflow", data)).toBe(
      "Shopping workflow completed with provider follow-up required: Shopping needs browser follow-up."
    );
  });

  it("does not report product-ready artifacts when evidence authority is diagnostic-only", () => {
    const data = {
      productSuccess: true,
      artifactAuthority: "product_ready",
      evidenceAuthority: "diagnostic_only",
      meta: {
        primaryConstraintSummary: "Pinterest requires manual browser follow-up."
      }
    };

    expect(buildWorkflowCompletionMessage("Inspiredesign workflow", data)).toBe(
      "Inspiredesign workflow completed with provider follow-up required: Pinterest requires manual browser follow-up."
    );
  });

  it("does not combine split product-ready authority fields across response levels", () => {
    const cases = [
      {
        productSuccess: true,
        meta: {
          artifactAuthority: "product_ready",
          primaryConstraintSummary: "Pinterest requires manual browser follow-up."
        }
      },
      {
        artifactAuthority: "product_ready",
        meta: {
          productSuccess: true,
          primaryConstraintSummary: "Pinterest requires manual browser follow-up."
        }
      }
    ];

    for (const data of cases) {
      expect(buildWorkflowCompletionMessage("Inspiredesign workflow", data)).toBe(
        "Inspiredesign workflow completed with provider follow-up required: Pinterest requires manual browser follow-up."
      );
    }
  });

  it("reads typed nextStepGuidance from workflow metadata", () => {
    expect(readWorkflowGuidanceNextStep({
      meta: {
        nextStepGuidance: {
          primaryAction: {
            summary: "Typed metadata recovery action"
          }
        }
      }
    })).toBe("Typed metadata recovery action");
  });

  it("prefers typed nextStepGuidance when provider failures are inferred without a primary summary", () => {
    const data = {
      nextStepGuidance: {
        workflow: "shopping",
        primaryAction: {
          summary: "Use the shared typed recovery recipe."
        }
      },
      meta: {
        failures: [{
          provider: "shopping/costco",
          error: {
            reasonCode: "auth_required"
          }
        }]
      }
    };

    expect(buildWorkflowCompletionMessage("Shopping workflow", data)).toBe(
      "Shopping workflow completed with provider follow-up required: Costco requires login or an existing session. Next step: Use the shared typed recovery recipe."
    );
  });

  it("ignores typed guidance when it belongs to a different workflow", () => {
    const shoppingData = {
      followthroughSummary: "Review shopping diagnostics.",
      suggestedNextAction: "Run shopping follow-up",
      nextStepGuidance: {
        workflow: "inspiredesign",
        primaryAction: {
          summary: "Use Pinterest browser-native recovery."
        }
      }
    };

    expect(buildWorkflowCompletionMessage("Shopping workflow", shoppingData)).toBe(
      "Shopping workflow completed. Review shopping diagnostics."
    );

    expect(buildWorkflowCompletionMessage("Product video workflow", {
      followthroughSummary: "Review product-video artifacts.",
      suggestedNextAction: "Legacy Canvas next action",
      nextStepGuidance: {
        workflow: "canvas",
        primaryAction: {
          summary: "Open Canvas session."
        }
      }
    })).toBe("Product video workflow completed. Review product-video artifacts.");

    expect(buildWorkflowCompletionMessage("Product-video workflow", {
      followthroughSummary: "Review product-video artifacts.",
      suggestedNextAction: "Use Pinterest browser-native recovery.",
      nextStepGuidance: {
        workflow: "inspiredesign",
        primaryAction: {
          summary: "Use Pinterest browser-native recovery."
        }
      }
    })).toBe("Product-video workflow completed. Review product-video artifacts.");

    expect(buildWorkflowCompletionMessage("product_video workflow", {
      followthroughSummary: "Review product-video artifacts.",
      suggestedNextAction: "Use Pinterest browser-native recovery.",
      nextStepGuidance: {
        workflow: "inspiredesign",
        primaryAction: {
          summary: "Use Pinterest browser-native recovery."
        }
      }
    })).toBe("product_video workflow completed. Review product-video artifacts.");
  });

  it("exports shared next-step reading with placeholder command skipping", () => {
    expect(readWorkflowGuidanceNextStep({
      suggestedSteps: [
        { reason: "Generate notes.", command: "./helper <pack>/manifest.json" },
        { reason: "Rerun with concrete input.", command: "npx opendevbrowser research run --topic \"motion\" --output-format json" }
      ]
    })).toBe("npx opendevbrowser research run --topic \"motion\" --output-format json");
  });

  it("does not surface unresolved placeholders from suggested actions", () => {
    expect(buildWorkflowCompletionMessage("Product video workflow", {
      followthroughSummary: "Review the generated pack before production.",
      suggestedNextAction: "Run ./helper <pack>/manifest.json",
      suggestedSteps: [{
        reason: "Rerun with concrete input.",
        command: "npx opendevbrowser product-video run --product-url \"https://example.com/p/4\" --output-format json"
      }]
    })).toBe(
      "Product video workflow completed. Review the generated pack before production. Next step: npx opendevbrowser product-video run --product-url \"https://example.com/p/4\" --output-format json"
    );
  });
});
