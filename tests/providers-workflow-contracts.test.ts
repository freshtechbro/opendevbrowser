import { describe, expect, it } from "vitest";
import { buildWorkflowResumeEnvelope, isWorkflowResumePayload } from "../src/providers/workflow-contracts";
import type { JsonValue, SuspendedIntentSummary, WorkflowResumePayload } from "../src/providers/types";

const workflowResumeInput = (
  kind: "research" | "shopping" | "product_video",
  input: Record<string, JsonValue>
): WorkflowResumePayload => ({
  workflow: {
    kind,
    input
  }
});

describe("workflow suspended intent contracts", () => {
  it("builds explicit workflow resume envelopes", () => {
    expect(buildWorkflowResumeEnvelope("shopping", {
      query: "contract item",
      mode: "json"
    })).toEqual({
      kind: "shopping",
      input: {
        query: "contract item",
        mode: "json"
      }
    });
  });

  it("embeds workflow resume envelopes through the runtime-owned suspended intent payload shape", () => {
    const payload = workflowResumeInput("research", {
      topic: "contract research",
      mode: "json",
      sources: ["web"],
      limitPerSource: 1
    });
    const summary: SuspendedIntentSummary = {
      kind: "workflow.research",
      input: payload
    };

    expect(summary.input).toEqual(payload);
    expect(isWorkflowResumePayload(summary.input)).toBe(true);
  });

  it("recognizes explicit workflow payloads and rejects raw workflow input shape", () => {
    expect(isWorkflowResumePayload(workflowResumeInput("research", {
      topic: "contract research",
      mode: "json"
    }))).toBe(true);

    expect(isWorkflowResumePayload({
      topic: "contract research",
      mode: "json"
    })).toBe(false);
  });

  it("accepts checkpoint-bearing workflow payloads with trace state", () => {
    const payload: WorkflowResumePayload = {
      workflow: buildWorkflowResumeEnvelope("shopping", {
        query: "checkpoint item",
        mode: "json"
      }, {
        checkpoint: {
          stage: "execute",
          stepId: "search:shopping/amazon",
          stepIndex: 0,
          state: {
            completed_step_ids: ["search:shopping/amazon"],
            step_results_by_id: {}
          },
          updatedAt: "2026-03-30T22:00:00.000Z"
        },
        trace: [{
          at: "2026-03-30T22:00:00.000Z",
          stage: "compile",
          event: "compile_completed"
        }]
      })
    };

    expect(isWorkflowResumePayload(payload)).toBe(true);
  });
});
