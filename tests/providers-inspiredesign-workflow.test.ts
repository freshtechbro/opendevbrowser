import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeRecord } from "../src/providers/normalize";
import {
  runInspiredesignWorkflow,
  workflowTestUtils,
  type ProviderExecutor
} from "../src/providers/workflows";
import type { InspiredesignCaptureEvidence } from "../src/providers/inspiredesign-contract";
import { buildWorkflowResumeEnvelope } from "../src/providers/workflow-contracts";
import type {
  ProviderAggregateResult,
  ProviderError,
  ProviderFailureEntry,
  ProviderSource
} from "../src/providers/types";

type InspiredesignWorkflowMeta = {
  reasonCodeDistribution?: Record<string, number>;
  selection: {
    urls: string[];
    capture_mode: string;
    include_prototype_guidance: boolean;
  };
  metrics: {
    reference_count: number;
    fetched_references: number;
    captured_references: number;
    failed_fetches: number;
    failed_captures: number;
  };
  artifact_manifest: {
    files: string[];
  };
};

type InspiredesignWorkflowEvidence = {
  references: Array<{
    url: string;
    fetchStatus: string;
    captureStatus: string;
    fetchFailure?: string;
    captureFailure?: string;
  }>;
};

const tempDirs: string[] = [];

const makeOutputDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "inspiredesign-workflow-"));
  tempDirs.push(dir);
  return dir;
};

const makeFailure = (
  provider: string,
  source: ProviderSource,
  error: Partial<ProviderError> = {}
): ProviderFailureEntry => ({
  provider,
  source,
  error: {
    code: "unavailable",
    message: "provider failed",
    retryable: false,
    ...error
  }
});

const makeAggregate = (overrides: Partial<ProviderAggregateResult> = {}): ProviderAggregateResult => ({
  ok: true,
  records: [],
  trace: { requestId: "inspiredesign-workflow", ts: new Date().toISOString() },
  partial: false,
  failures: [],
  metrics: { attempted: 1, succeeded: 1, failed: 0, retries: 0, latencyMs: 1 },
  sourceSelection: "web",
  providerOrder: ["web/default"],
  ...overrides
});

const toRuntime = (handlers: {
  fetch?: ProviderExecutor["fetch"];
  getAntiBotSnapshots?: ProviderExecutor["getAntiBotSnapshots"];
}): ProviderExecutor => ({
  search: async () => makeAggregate(),
  fetch: handlers.fetch ?? (async () => makeAggregate()),
  ...(handlers.getAntiBotSnapshots ? { getAntiBotSnapshots: handlers.getAntiBotSnapshots } : {})
});

const makeCapture = (title: string): InspiredesignCaptureEvidence => ({
  title,
  snapshot: {
    content: `${title} snapshot`,
    refCount: 5,
    warnings: []
  },
  clone: {
    componentPreview: `<section>${title}</section>`,
    cssPreview: ".hero { display: grid; }",
    warnings: []
  }
});

describe("inspiredesign workflow", () => {
  afterEach(() => {
    workflowTestUtils.resetProviderSignalState();
    vi.restoreAllMocks();
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("returns a path artifact bundle when no references are supplied", async () => {
    const runtime = toRuntime({});
    const output = await runInspiredesignWorkflow(runtime, {
      brief: "  Create a premium knowledge base  ",
      mode: "path",
      outputDir: makeOutputDir()
    });

    const meta = output.meta as InspiredesignWorkflowMeta;

    expect(output).toMatchObject({
      mode: "path",
      path: expect.any(String)
    });
    expect(meta.selection).toEqual({
      urls: [],
      capture_mode: "off",
      include_prototype_guidance: false
    });
    expect(meta.metrics.reference_count).toBe(0);
    expect(meta.artifact_manifest.files).toContain("design.md");
  });

  it("defaults to compact mode when inspiredesign input omits an explicit render mode", async () => {
    const runtime = toRuntime({});

    const output = await runInspiredesignWorkflow(runtime, {
      brief: "Design a compact default output"
    });

    expect(output.mode).toBe("compact");
  });

  it("parses valid inspiredesign envelopes and forwards every optional runtime override", async () => {
    const fetch = vi.fn(async (input: { url: string }) => makeAggregate({
      records: [
        normalizeRecord("web/default", "web", {
          url: input.url,
          title: "Reference title",
          content: "Reference content with enough detail for a design excerpt."
        })
      ]
    }));
    const captureReference = vi.fn(async (url: string) => makeCapture(`Captured ${url}`));
    const runtime = toRuntime({ fetch });

    const output = await runInspiredesignWorkflow(runtime, buildWorkflowResumeEnvelope("inspiredesign", {
      brief: "Design a docs workspace",
      urls: [" https://example.com/reference ", "https://example.com/reference"],
      captureMode: "deep",
      includePrototypeGuidance: true,
      mode: "context",
      timeoutMs: 45000,
      outputDir: makeOutputDir(),
      ttlHours: 24,
      useCookies: true,
      challengeAutomationMode: "browser_with_helper",
      cookiePolicyOverride: "required"
    }), {
      captureReference
    });

    const meta = output.meta as InspiredesignWorkflowMeta;
    const context = output.context as {
      urls: string[];
      prototypeGuidanceMarkdown: string | null;
      evidence: InspiredesignWorkflowEvidence;
    };

    expect(fetch).toHaveBeenCalledWith(
      { url: "https://example.com/reference" },
      expect.objectContaining({
        timeoutMs: expect.any(Number),
        runtimePolicy: expect.objectContaining({
          useCookies: true,
          challengeAutomationMode: "browser_with_helper",
          cookiePolicyOverride: "required"
        }),
        suspendedIntent: expect.objectContaining({
          kind: "workflow.inspiredesign"
        })
      })
    );
    expect(captureReference).toHaveBeenCalledTimes(1);
    expect(output.mode).toBe("context");
    expect(context.urls).toEqual(["https://example.com/reference"]);
    expect(context.prototypeGuidanceMarkdown).toContain("# 6. Optional Prototype Plan");
    expect(context.evidence.references[0]).toMatchObject({
      fetchStatus: "captured",
      captureStatus: "captured"
    });
    expect(meta.selection.capture_mode).toBe("deep");
    expect(meta.selection.include_prototype_guidance).toBe(true);
  });

  it("defaults invalid envelope fields back to the compact off-capture path", async () => {
    const fetch = vi.fn(async (input: { url: string }) => makeAggregate({
      records: [
        normalizeRecord("web/default", "web", {
          url: input.url,
          title: "Fallback title",
          content: "Fallback content"
        })
      ]
    }));
    const runtime = toRuntime({ fetch });

    const output = await runInspiredesignWorkflow(runtime, {
      kind: "inspiredesign",
      input: {
        brief: "  Design a calm control surface  ",
        urls: [" https://example.com/control ", 42],
        mode: "invalid-mode",
        captureMode: "invalid-capture",
        includePrototypeGuidance: "yes",
        timeoutMs: "fast",
        outputDir: "",
        ttlHours: "24",
        useCookies: "true",
        challengeAutomationMode: 1,
        cookiePolicyOverride: false
      }
    } as never);

    const meta = output.meta as InspiredesignWorkflowMeta;

    expect(output.mode).toBe("compact");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      { url: "https://example.com/control" },
      expect.objectContaining({
        suspendedIntent: expect.objectContaining({
          kind: "workflow.inspiredesign"
        })
      })
    );
    expect(meta.selection).toEqual({
      urls: ["https://example.com/control"],
      capture_mode: "off",
      include_prototype_guidance: false
    });
  });

  it("drops invalid string runtime overrides from inspiredesign envelopes", async () => {
    const fetch = vi.fn(async (input: { url: string }, options?: { runtimePolicy?: Record<string, unknown> }) => makeAggregate({
      records: [
        normalizeRecord("web/default", "web", {
          url: input.url,
          title: "Validated title",
          content: "Validated content"
        })
      ],
      meta: options?.runtimePolicy ? { runtimePolicy: options.runtimePolicy } : undefined
    }));
    const captureReference = vi.fn(async (url: string, options?: Record<string, unknown>) => ({
      ...makeCapture(`Captured ${url}`),
      clone: {
        componentPreview: JSON.stringify(options ?? {}),
        cssPreview: ".validated { display: block; }",
        warnings: []
      }
    }));
    const runtime = toRuntime({ fetch });

    await runInspiredesignWorkflow(runtime, {
      kind: "inspiredesign",
      input: {
        brief: "Validate resume envelope enums",
        urls: ["https://example.com/resume"],
        captureMode: "deep",
        challengeAutomationMode: "invalid-mode",
        cookiePolicyOverride: "invalid-policy"
      }
    } as never, {
      captureReference
    });

    expect(fetch).toHaveBeenCalledWith(
      { url: "https://example.com/resume" },
      expect.objectContaining({
        runtimePolicy: expect.not.objectContaining({
          challengeAutomationMode: "invalid-mode",
          cookiePolicyOverride: "invalid-policy"
        })
      })
    );
    expect(captureReference).toHaveBeenCalledWith(
      "https://example.com/resume",
      expect.not.objectContaining({
        challengeAutomationMode: "invalid-mode",
        cookiePolicyOverride: "invalid-policy"
      })
    );
  });

  it("rejects invalid inspiredesign workflow envelopes", async () => {
    await expect(
      runInspiredesignWorkflow(toRuntime({}), {
        kind: "inspiredesign",
        input: []
      } as never)
    ).rejects.toThrow("Inspiredesign workflow envelope is invalid.");
  });

  it("rejects inspiredesign workflow envelopes with mismatched kinds", async () => {
    await expect(
      runInspiredesignWorkflow(toRuntime({}), {
        kind: "research",
        input: {
          brief: "Design a landing page"
        }
      } as never)
    ).rejects.toThrow("Inspiredesign workflow envelope kind mismatch. Expected inspiredesign but received research.");
  });

  it("rejects malformed inspiredesign envelope inputs after parsing optional fields", async () => {
    await expect(
      runInspiredesignWorkflow(toRuntime({}), {
        kind: "inspiredesign",
        input: {
          brief: 42
        }
      } as never)
    ).rejects.toThrow("Inspiredesign workflow requires a non-empty brief.");
  });

  it("rejects empty briefs and invalid inspiredesign urls", async () => {
    await expect(
      runInspiredesignWorkflow(toRuntime({}), {
        brief: "   ",
        mode: "json"
      })
    ).rejects.toThrow("Inspiredesign workflow requires a non-empty brief.");

    await expect(
      runInspiredesignWorkflow(toRuntime({}), {
        brief: "Design a landing page",
        urls: ["notaurl"],
        mode: "json"
      })
    ).rejects.toThrow("Inspiredesign workflow received an invalid URL: notaurl");
  });

  it("records fetch failures and missing deep-capture callbacks in the evidence payload", async () => {
    const runtime = toRuntime({
      fetch: async () => makeAggregate({
        ok: false,
        records: [],
        failures: [
          makeFailure("web/default", "web", {
            code: "challenge_detected",
            message: "challenge detected",
            reasonCode: "challenge_detected"
          })
        ],
        metrics: { attempted: 1, succeeded: 0, failed: 1, retries: 0, latencyMs: 1 },
        error: {
          code: "challenge_detected",
          message: "challenge detected",
          retryable: false,
          reasonCode: "challenge_detected"
        }
      })
    });

    const output = await runInspiredesignWorkflow(runtime, {
      brief: "Design a fallback-safe landing page",
      urls: ["https://example.com/blocked"],
      captureMode: "deep",
      mode: "json",
      outputDir: makeOutputDir()
    });

    const evidence = output.evidence as InspiredesignWorkflowEvidence;

    expect(evidence.references[0]).toMatchObject({
      url: "https://example.com/blocked",
      fetchStatus: "failed",
      captureStatus: "failed",
      captureFailure: "Deep capture requested, but no browser capture callback was available."
    });
    expect(evidence.references[0]?.fetchFailure).toEqual(expect.any(String));
    expect(output.meta).toMatchObject({
      primaryConstraintSummary: expect.any(String),
      reasonCodeDistribution: {
        challenge_detected: 1
      },
      primaryConstraint: expect.objectContaining({
        reasonCode: "challenge_detected"
      })
    });
    expect(output.meta).not.toHaveProperty("primary_constraint");
  });

  it("records unusable and non-error deep capture failures without aborting the workflow", async () => {
    const runtime = toRuntime({
      fetch: async (input: { url: string }) => makeAggregate({
        records: [
          normalizeRecord("web/default", "web", {
            url: input.url,
            title: "",
            content: ""
          })
        ]
      })
    });
    const captureReference = vi.fn(async (url: string) => {
      if (url.endsWith("/empty")) {
        return null;
      }
      throw "boom";
    });

    const output = await runInspiredesignWorkflow(runtime, {
      brief: "Design a resilient workflow surface",
      urls: ["https://example.com/empty", "https://example.com/error"],
      captureMode: "deep",
      mode: "json",
      outputDir: makeOutputDir()
    }, {
      captureReference
    });

    const evidence = output.evidence as InspiredesignWorkflowEvidence;

    expect(evidence.references[0]).toMatchObject({
      url: "https://example.com/empty",
      captureStatus: "failed",
      captureFailure: "Deep capture did not return usable snapshot, DOM, or clone evidence."
    });
    expect(evidence.references[1]).toMatchObject({
      url: "https://example.com/error",
      captureStatus: "failed",
      captureFailure: "Deep capture failed."
    });
  });

  it("preserves Error messages from deep capture failures", async () => {
    const runtime = toRuntime({
      fetch: async (input: { url: string }) => makeAggregate({
        records: [
          normalizeRecord("web/default", "web", {
            url: input.url,
            title: "Reference title",
            content: "Reference content"
          })
        ]
      })
    });
    const captureReference = vi.fn(async () => {
      throw new Error("capture exploded");
    });

    const output = await runInspiredesignWorkflow(runtime, {
      brief: "Design a resilient workflow surface",
      urls: ["https://example.com/error-object"],
      captureMode: "deep",
      mode: "json",
      outputDir: makeOutputDir()
    }, {
      captureReference
    });

    const evidence = output.evidence as InspiredesignWorkflowEvidence;

    expect(evidence.references[0]).toMatchObject({
      url: "https://example.com/error-object",
      fetchStatus: "captured",
      captureStatus: "failed",
      captureFailure: "capture exploded"
    });
    expect(output.meta).toMatchObject({
      primaryConstraintSummary: "Deep capture failed for 1 reference.",
      reasonCodeDistribution: {
        env_limited: 1
      },
      metrics: {
        reasonCodeDistribution: {
          env_limited: 1
        }
      },
      primaryConstraint: expect.objectContaining({
        summary: "Deep capture failed for 1 reference.",
        reasonCode: "env_limited",
        guidance: expect.objectContaining({
          reason: "Deep capture failed for 1 reference.",
          recommendedNextCommands: expect.arrayContaining([
            "Rerun inspiredesign after configuring providers.cookieSource for the protected references you need to capture."
          ])
        })
      })
    });
  });

  it("recomputes the remaining timeout budget before deep capture", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-17T10:00:00.000Z"));

    try {
      const fetch = vi.fn(async (input: { url: string }) => {
        vi.setSystemTime(new Date("2026-04-17T10:00:03.000Z"));
        return makeAggregate({
          records: [
            normalizeRecord("web/default", "web", {
              url: input.url,
              title: "Reference title",
              content: "Reference content"
            })
          ]
        });
      });
      const captureReference = vi.fn(async (url: string, options?: { timeoutMs?: number }) => {
        return {
          ...makeCapture(`Captured ${url}`),
          snapshot: {
            content: `${url} snapshot (${options?.timeoutMs})`,
            refCount: 5,
            warnings: []
          }
        };
      });
      const runtime = toRuntime({ fetch });

      await runInspiredesignWorkflow(runtime, {
        brief: "Design a budget-aware capture flow",
        urls: ["https://example.com/reference"],
        captureMode: "deep",
        mode: "json",
        timeoutMs: 5000,
        outputDir: makeOutputDir()
      }, {
        captureReference
      });

      expect(fetch).toHaveBeenCalledWith(
        { url: "https://example.com/reference" },
        expect.objectContaining({ timeoutMs: 5000 })
      );
      expect(captureReference).toHaveBeenCalledWith(
        "https://example.com/reference",
        expect.objectContaining({
          timeoutMs: expect.any(Number)
        })
      );
      expect(captureReference.mock.calls[0]?.[1]?.timeoutMs).toBe(2000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("forwards deep-capture runtime policy overrides to the capture callback", async () => {
    const runtime = toRuntime({
      fetch: async (input: { url: string }) => makeAggregate({
        records: [
          normalizeRecord("web/default", "web", {
            url: input.url,
            title: "Reference title",
            content: "Reference content"
          })
        ]
      })
    });
    const captureReference = vi.fn(async (url: string) => makeCapture(`Captured ${url}`));

    await runInspiredesignWorkflow(runtime, {
      brief: "Preserve capture runtime policy",
      urls: ["https://example.com/reference"],
      captureMode: "deep",
      mode: "json",
      useCookies: false,
      challengeAutomationMode: "browser",
      cookiePolicyOverride: "off"
    }, {
      captureReference
    });

    expect(captureReference).toHaveBeenCalledWith(
      "https://example.com/reference",
      expect.objectContaining({
        useCookies: false,
        challengeAutomationMode: "browser",
        cookiePolicyOverride: "off"
      })
    );
  });
});
