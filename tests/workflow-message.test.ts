import { describe, expect, it } from "vitest";
import {
  buildWorkflowCompletionMessage,
  readSuggestedNextAction,
  readSuggestedStepReason
} from "../src/cli/utils/workflow-message";

describe("workflow message helpers", () => {
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
});
