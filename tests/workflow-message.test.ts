import { describe, expect, it } from "vitest";
import {
  buildWorkflowCompletionMessage,
  readSuggestedNextAction,
  readSuggestedStepCommand,
  readSuggestedStepReason
} from "../src/cli/utils/workflow-message";

describe("workflow message helpers", () => {
  it("reads inspiredesign success follow-through summaries and next steps", () => {
    const data = {
      followthroughSummary: "Continue in OpenDevBrowser Canvas with canvas-plan.request.json and design-agent-handoff.json, load opendevbrowser-best-practices \"quick start\" plus opendevbrowser-design-agent \"canvas-contract\" before implementation, and rerun with captureMode=deep only when you need richer evidence.",
      suggestedNextAction: "Open a Canvas session, fill canvasSessionId, leaseId, and documentId in canvas-plan.request.json, submit canvas.plan.set, confirm planStatus=accepted, then patch only the governance blocks listed in design-agent-handoff.json."
    };

    expect(buildWorkflowCompletionMessage("Inspiredesign workflow", data)).toBe(
      "Inspiredesign workflow completed. Continue in OpenDevBrowser Canvas with canvas-plan.request.json and design-agent-handoff.json, load opendevbrowser-best-practices \"quick start\" plus opendevbrowser-design-agent \"canvas-contract\" before implementation, and rerun with captureMode=deep only when you need richer evidence. Next step: Open a Canvas session, fill canvasSessionId, leaseId, and documentId in canvas-plan.request.json, submit canvas.plan.set, confirm planStatus=accepted, then patch only the governance blocks listed in design-agent-handoff.json."
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
});
