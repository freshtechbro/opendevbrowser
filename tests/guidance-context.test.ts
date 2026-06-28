import { describe, expect, it } from "vitest";
import {
  createCanvasGuidanceContext,
  createCliValidationGuidanceContext,
  createInspiredesignGuidanceContext,
  createProviderWorkflowGuidanceContext
} from "../src/guidance/context";

describe("guidance context adapters", () => {
  it("maps source-shaped Inspired Design provider failures to Pinterest recovery context", () => {
    const context = createInspiredesignGuidanceContext({
      brief: "Design a premium studio landing page",
      query: "premium photography studio Pinterest inspiration",
      requestedProviders: ["social/pinterest"],
      browserMode: "extension",
      useCookies: true,
      cookiePolicy: "required",
      discovery: {
        requested: true,
        acceptedUrls: [],
        failures: 1,
        failure: "No providers available"
      },
      metrics: {
        referenceCount: 0,
        failedCaptureCount: 0,
        visualEvidenceRequired: true
      },
      quality: {
        rankedReferenceCount: 0,
        rejectedReferenceCount: 0,
        missingScreenshotCount: 0,
        diagnosticOnlyReasons: []
      },
      primaryConstraint: { reasonCode: "env_limited", summary: "No providers available" }
    });

    expect(context.providerUnavailable).toBe(true);
    expect(context.siteRecipeId).toBe("social/pinterest");
    expect(context.reasonCode).toBe("provider_unavailable");
  });

  it("maps diagnostic-only, weak, failed, and auth-required signals without optional scores", () => {
    const baseSource = {
      brief: "Design a premium studio landing page",
      requestedProviders: ["web/default"],
      discovery: {
        requested: false,
        acceptedUrls: ["https://example.com/reference"],
        failures: 0
      },
      metrics: {
        referenceCount: 1,
        failedCaptureCount: 0,
        visualEvidenceRequired: true
      },
      quality: {
        rankedReferenceCount: 0,
        rejectedReferenceCount: 1,
        missingScreenshotCount: 0,
        diagnosticOnlyReasons: ["cookie_or_consent_modal"]
      }
    };

    expect(createInspiredesignGuidanceContext(baseSource).reasonCode).toBe("diagnostic_only");
    expect(createInspiredesignGuidanceContext({
      ...baseSource,
      quality: {
        ...baseSource.quality,
        rankedReferenceCount: 1,
        diagnosticOnlyReasons: []
      }
    }).reasonCode).toBe("weak_reference");
    expect(createInspiredesignGuidanceContext({
      ...baseSource,
      metrics: {
        ...baseSource.metrics,
        failedCaptureCount: 1
      },
      quality: {
        ...baseSource.quality,
        rankedReferenceCount: 1,
        authoritativeReferenceCount: 1,
        snapshotReadyReferenceCount: 1,
        topReferenceScore: 80,
        topReferenceConfidence: 0.8,
        diagnosticOnlyReasons: []
      }
    }).reasonCode).toBe("failed_capture");
    expect(createInspiredesignGuidanceContext({
      ...baseSource,
      metrics: {
        ...baseSource.metrics,
        failedCaptureCount: 0,
        visualEvidenceRequired: true
      },
      quality: {
        ...baseSource.quality,
        rankedReferenceCount: 1,
        topReferenceScore: 80,
        topReferenceConfidence: 0.8,
        missingScreenshotCount: 1,
        diagnosticOnlyReasons: []
      }
    }).reasonCode).toBe("failed_capture");
    expect(createInspiredesignGuidanceContext({
      ...baseSource,
      metrics: {
        ...baseSource.metrics,
        failedCaptureCount: 0,
        visualEvidenceRequired: false
      },
      quality: {
        ...baseSource.quality,
        rankedReferenceCount: 1,
        topReferenceScore: 80,
        topReferenceConfidence: 0.8,
        topReferenceIntentMatched: false,
        diagnosticOnlyReasons: []
      }
    }).reasonCode).toBe("off_brief_reference");
    expect(createInspiredesignGuidanceContext({
      ...baseSource,
      metrics: {
        ...baseSource.metrics,
        failedCaptureCount: 1,
        visualEvidenceRequired: false
      },
      quality: {
        ...baseSource.quality,
        rankedReferenceCount: 1,
        authoritativeReferenceCount: 1,
        snapshotReadyReferenceCount: 1,
        topReferenceScore: 80,
        topReferenceConfidence: 0.8,
        diagnosticOnlyReasons: []
      }
    }).reasonCode).toBe("design_ready");
    expect(createInspiredesignGuidanceContext({
      ...baseSource,
      discovery: {
        requested: true,
        acceptedUrls: [],
        failures: 0
      },
      metrics: {
        ...baseSource.metrics,
        referenceCount: 0
      },
      quality: {
        ...baseSource.quality,
        diagnosticOnlyReasons: []
      },
      primaryConstraint: { reasonCode: "auth_required" }
    }).providerUnavailable).toBe(true);
    expect(createInspiredesignGuidanceContext({
      ...baseSource,
      discovery: {
        requested: false,
        acceptedUrls: [],
        failures: 0,
        failure: "Explicit Pinterest URL could not be captured"
      },
      metrics: {
        ...baseSource.metrics,
        referenceCount: 0
      },
      quality: {
        ...baseSource.quality,
        diagnosticOnlyReasons: []
      }
    }).providerUnavailable).toBe(true);
    expect(createInspiredesignGuidanceContext({
      ...baseSource,
      metrics: {
        ...baseSource.metrics,
        referenceCount: 0,
        referenceEvidenceRequired: true
      },
      quality: {
        ...baseSource.quality,
        diagnosticOnlyReasons: []
      }
    }).reasonCode).toBe("zero_references");
  });

  it("maps all-rejected harvests and Pinterest URL hosts to recovery context", () => {
    const context = createInspiredesignGuidanceContext({
      brief: "Design a premium studio landing page",
      urls: ["https://www.pinterest.com/pin/61572719900827789/"],
      requestedProviders: [],
      discovery: {
        requested: false,
        acceptedUrls: [],
        failures: 0
      },
      metrics: {
        referenceCount: 2,
        failedCaptureCount: 0,
        visualEvidenceRequired: true
      },
      quality: {
        rankedReferenceCount: 0,
        rejectedReferenceCount: 2,
        missingScreenshotCount: 0,
        diagnosticOnlyReasons: []
      }
    });

    expect(context.reasonCode).toBe("zero_ranked_references");
    expect(context.siteRecipeId).toBe("social/pinterest");
  });

  it("maps ready evidence without inferring provider blockers or site recipes", () => {
    const context = createInspiredesignGuidanceContext({
      brief: "Design a premium studio landing page",
      urls: ["not a url", "https://example.com/reference"],
      requestedProviders: ["web/default"],
      discovery: {
        requested: true,
        acceptedUrls: ["https://example.com/reference"],
        failures: 1,
        failure: "one alternate source failed"
      },
      metrics: {
        referenceCount: 1,
        failedCaptureCount: 0,
        visualEvidenceRequired: true
      },
      quality: {
        rankedReferenceCount: 1,
        authoritativeReferenceCount: 1,
        snapshotReadyReferenceCount: 1,
        rejectedReferenceCount: 0,
        topReferenceScore: 88,
        topReferenceConfidence: 0.9,
        missingScreenshotCount: 0,
        diagnosticOnlyReasons: []
      }
    });

    expect(context.reasonCode).toBe("design_ready");
    expect(context.providerUnavailable).toBe(false);
    expect(context.siteRecipeId).toBeUndefined();
  });

  it("lets hard provider failures veto ranked user-supplied references before soft suppression", () => {
    const source = {
      brief: "Design a premium studio landing page",
      urls: ["https://www.pinterest.com/pin/61572719900827789/"],
      requestedProviders: ["social/pinterest"],
      discovery: {
        requested: true,
        acceptedUrls: ["https://www.pinterest.com/pin/61572719900827789/"],
        failures: 1,
        hardFailureReasonCodes: ["auth_required"]
      },
      metrics: {
        referenceCount: 1,
        failedCaptureCount: 0,
        visualEvidenceRequired: false
      },
      quality: {
        rankedReferenceCount: 1,
        rankedReferenceUrls: ["https://www.pinterest.com/pin/61572719900827789/"],
        authoritativeReferenceCount: 1,
        pinMediaReadyReferenceCount: 1,
        rejectedReferenceCount: 0,
        topReferenceScore: 88,
        topReferenceConfidence: 0.9,
        missingScreenshotCount: 0,
        diagnosticOnlyReasons: []
      }
    };

    const hardFailureContext = createInspiredesignGuidanceContext(source);
    expect(hardFailureContext.providerUnavailable).toBe(true);
    expect(hardFailureContext.reasonCode).toBe("provider_unavailable");

    const primaryConstraintContext = createInspiredesignGuidanceContext({
      ...source,
      discovery: {
        ...source.discovery,
        failures: 0,
        hardFailureReasonCodes: []
      },
      primaryConstraint: {
        reasonCode: "auth_required",
        summary: "Pinterest login was required during upstream discovery."
      }
    });
    expect(primaryConstraintContext.providerUnavailable).toBe(true);
    expect(primaryConstraintContext.reasonCode).toBe("provider_unavailable");

    const softFailureContext = createInspiredesignGuidanceContext({
      ...source,
      discovery: {
        ...source.discovery,
        hardFailureReasonCodes: []
      }
    });
    expect(softFailureContext.providerUnavailable).toBe(false);
    expect(softFailureContext.reasonCode).toBe("design_ready");

    expect(createInspiredesignGuidanceContext({
      ...source,
      discovery: {
        ...source.discovery,
        hardFailureReasonCodes: []
      },
      urls: ["https://example.com/reference"],
      quality: {
        ...source.quality,
        rankedReferenceUrls: ["https://www.pinterest.com/pin/61572719900827789/"]
      }
    }).providerUnavailable).toBe(false);

    expect(createInspiredesignGuidanceContext({
      ...source,
      discovery: {
        ...source.discovery,
        hardFailureReasonCodes: []
      },
      urls: ["https://www.pinterest.com/pin/61572719900827789/"],
      requestedProviders: ["social/pinterest"],
      quality: {
        ...source.quality,
        rankedReferenceUrls: ["not a url"]
      }
    }).providerUnavailable).toBe(false);
  });

  it("suppresses soft provider unavailable when a user-supplied Pinterest reference is ranked", () => {
    const context = createInspiredesignGuidanceContext({
      brief: "Design a premium studio landing page",
      urls: ["https://www.pinterest.com/pin/61572719900827789/?utm_source=brief#saved"],
      requestedProviders: ["social/pinterest"],
      discovery: {
        requested: true,
        acceptedUrls: [],
        failures: 1,
        failure: "Pinterest query discovery was unavailable"
      },
      metrics: {
        referenceCount: 1,
        failedCaptureCount: 0,
        visualEvidenceRequired: false
      },
      quality: {
        rankedReferenceCount: 1,
        rankedReferenceUrls: ["https://pinterest.com/pin/61572719900827789/"],
        authoritativeReferenceCount: 1,
        pinMediaReadyReferenceCount: 1,
        rejectedReferenceCount: 0,
        topReferenceScore: 88,
        topReferenceConfidence: 0.9,
        missingScreenshotCount: 0,
        diagnosticOnlyReasons: []
      }
    });

    expect(context.providerUnavailable).toBe(false);
    expect(context.reasonCode).toBe("design_ready");
    expect(context.siteRecipeId).toBe("social/pinterest");
    expect(context.referenceUrls).toEqual(["https://www.pinterest.com/pin/61572719900827789/?utm_source=brief#saved"]);
  });

  it("preserves provider hard failures when surviving ranked references have artifact authority", () => {
    const source = {
      brief: "Design a premium studio landing page",
      urls: ["https://example.com/reference"],
      requestedProviders: ["web/default"],
      discovery: {
        requested: true,
        acceptedUrls: ["https://example.com/reference"],
        failures: 1,
        hardFailureReasonCodes: ["auth_required"]
      },
      metrics: {
        referenceCount: 1,
        failedCaptureCount: 0,
        visualEvidenceRequired: false
      },
      quality: {
        rankedReferenceCount: 1,
        rankedReferenceUrls: ["https://example.com/reference"],
        authoritativeReferenceCount: 1,
        snapshotReadyReferenceCount: 1,
        rejectedReferenceCount: 0,
        topReferenceScore: 88,
        topReferenceConfidence: 0.9,
        missingScreenshotCount: 0,
        diagnosticOnlyReasons: []
      }
    };

    const context = createInspiredesignGuidanceContext(source);
    expect(context.providerUnavailable).toBe(true);
    expect(context.reasonCode).toBe("provider_unavailable");
    expect(context.evidence?.authoritativeReferenceCount).toBe(1);
    expect(createInspiredesignGuidanceContext({
      ...source,
      quality: {
        ...source.quality,
        authoritativeReferenceCount: 0,
        snapshotReadyReferenceCount: 0
      }
    }).providerUnavailable).toBe(true);
    expect(createInspiredesignGuidanceContext({
      ...source,
      quality: {
        ...source.quality,
        authoritativeReferenceCount: 1,
        snapshotReadyReferenceCount: 0
      }
    }).providerUnavailable).toBe(true);
  });

  it.each(["ip_blocked", "cooldown_active"] as const)(
    "treats %s as a hard provider blocker even when ranked references are artifact-backed",
    (reasonCode) => {
      const source = {
        brief: "Design a premium studio landing page",
        urls: ["https://example.com/reference"],
        requestedProviders: ["web/default"],
        discovery: {
          requested: true,
          acceptedUrls: ["https://example.com/reference"],
          failures: 1,
          hardFailureReasonCodes: [reasonCode]
        },
        metrics: {
          referenceCount: 1,
          failedCaptureCount: 0,
          visualEvidenceRequired: false
        },
        quality: {
          rankedReferenceCount: 1,
          rankedReferenceUrls: ["https://example.com/reference"],
          rejectedReferenceCount: 0,
          topReferenceScore: 88,
          topReferenceConfidence: 0.9,
          missingScreenshotCount: 0,
          diagnosticOnlyReasons: []
        }
      };

      expect(createInspiredesignGuidanceContext(source).providerUnavailable).toBe(true);
      expect(createInspiredesignGuidanceContext({
        ...source,
        quality: {
          ...source.quality,
          authoritativeReferenceCount: 1,
          pinMediaReadyReferenceCount: 1
        }
      }).providerUnavailable).toBe(true);
      expect(createInspiredesignGuidanceContext({
        ...source,
        discovery: {
          ...source.discovery,
          hardFailureReasonCodes: []
        },
        primaryConstraint: { reasonCode }
      }).providerUnavailable).toBe(true);
    }
  );

  it("uses artifact-authority recovery for ranked evidence without manifest-backed proof", () => {
    const contextSource = {
      brief: "Design a premium studio landing page",
      urls: ["https://example.com/reference"],
      requestedProviders: ["web/default"],
      discovery: {
        requested: false,
        acceptedUrls: ["https://example.com/reference"],
        failures: 0
      },
      metrics: {
        referenceCount: 1,
        failedCaptureCount: 0,
        visualEvidenceRequired: false
      },
      quality: {
        rankedReferenceCount: 1,
        rankedReferenceUrls: ["https://example.com/reference"],
        authoritativeReferenceCount: 0,
        snapshotReadyReferenceCount: 0,
        rejectedReferenceCount: 0,
        topReferenceScore: 88,
        topReferenceConfidence: 0.9,
        missingScreenshotCount: 0,
        diagnosticOnlyReasons: []
      }
    };
    const context = createInspiredesignGuidanceContext(contextSource);

    expect(context.providerUnavailable).toBe(false);
    expect(context.reasonCode).toBe("artifact_authority_missing");
    expect(context.evidence?.authoritativeReferenceCount).toBe(0);

    expect(createInspiredesignGuidanceContext({
      ...contextSource,
      quality: {
        ...contextSource.quality,
        rankedReferenceCount: 1,
        authoritativeReferenceCount: 1,
        snapshotReadyReferenceCount: 0,
        motionReadyReferenceCount: 0,
        pinMediaReadyReferenceCount: 0,
        topReferenceScore: 88,
        topReferenceConfidence: 0.9
      }
    }).reasonCode).toBe("artifact_authority_missing");
    expect(createInspiredesignGuidanceContext({
      ...contextSource,
      quality: {
        ...contextSource.quality,
        rankedReferenceCount: 1,
        topReferenceScore: 88,
        topReferenceConfidence: 0.9
      }
    }).reasonCode).toBe("artifact_authority_missing");
    expect(createInspiredesignGuidanceContext({
      ...contextSource,
      quality: {
        rankedReferenceCount: 1,
        rankedReferenceUrls: ["https://example.com/reference"],
        rejectedReferenceCount: 0,
        topReferenceScore: 88,
        topReferenceConfidence: 0.9,
        missingScreenshotCount: 0,
        diagnosticOnlyReasons: []
      }
    }).reasonCode).toBe("artifact_authority_missing");
  });

  it("maps provider, canvas, and CLI validation context wrappers", () => {
    expect(createProviderWorkflowGuidanceContext("provider_blocked")).toEqual({
      workflow: "provider",
      reasonCode: "provider_blocked"
    });
    expect(createCanvasGuidanceContext("canvas_missing_artifact")).toEqual({
      workflow: "canvas",
      reasonCode: "canvas_missing_artifact"
    });
    expect(createCliValidationGuidanceContext("invalid_flag")).toEqual({
      workflow: "cli",
      reasonCode: "invalid_flag"
    });
  });

  it("keeps brief-only Inspired Design handoffs ready when reference evidence was not required", () => {
    const context = createInspiredesignGuidanceContext({
      brief: "Design a premium studio landing page",
      requestedProviders: [],
      discovery: {
        requested: false,
        acceptedUrls: [],
        failures: 0
      },
      metrics: {
        referenceCount: 0,
        referenceEvidenceRequired: false,
        failedCaptureCount: 0,
        visualEvidenceRequired: false
      },
      quality: {
        rankedReferenceCount: 0,
        rejectedReferenceCount: 0,
        missingScreenshotCount: 0,
        diagnosticOnlyReasons: []
      }
    });

    expect(context.reasonCode).toBe("design_ready");
    expect(context.evidence?.referenceEvidenceRequired).toBe(false);
  });

  it("keeps capture-failure reasoning on all-attempt motion failures when reference evidence is optional", () => {
    const context = createInspiredesignGuidanceContext({
      brief: "Design a premium studio landing page",
      query: "editorial studio references",
      urls: [" https://example.com/reference ", "https://example.com/reference"],
      requestedProviders: [],
      browserMode: "managed",
      useCookies: false,
      cookiePolicy: "optional",
      discovery: {
        requested: false,
        acceptedUrls: [],
        failures: 0
      },
      metrics: {
        referenceCount: 0,
        referenceEvidenceRequired: false,
        failedCaptureCount: 0,
        visualEvidenceRequired: true
      },
      quality: {
        rankedReferenceCount: 0,
        rejectedReferenceCount: 1,
        missingScreenshotCount: 0,
        allAttemptFailedCaptureCount: 0,
        allAttemptMissingScreenshotCount: 0,
        allAttemptVisualFailureCount: 0,
        allAttemptMotionFailureCount: 1,
        diagnosticOnlyReasons: []
      }
    });

    expect(context.reasonCode).toBe("failed_capture");
    expect(context.referenceUrls).toEqual(["https://example.com/reference"]);
    expect(context.browserMode).toBe("managed");
    expect(context.cookiePolicy).toBe("optional");
    expect(context.useCookies).toBe(false);
  });

  it("keeps all-attempt missing screenshots visible when no reference ranks", () => {
    const context = createInspiredesignGuidanceContext({
      brief: "Design a premium studio landing page",
      requestedProviders: ["social/pinterest"],
      discovery: {
        requested: true,
        acceptedUrls: ["https://www.pinterest.com/pin/61572719900827789/"],
        failures: 0
      },
      metrics: {
        referenceCount: 0,
        referenceEvidenceRequired: false,
        failedCaptureCount: 0,
        visualEvidenceRequired: true
      },
      quality: {
        rankedReferenceCount: 0,
        rejectedReferenceCount: 1,
        missingScreenshotCount: 0,
        allAttemptMissingScreenshotCount: 1,
        diagnosticOnlyReasons: []
      }
    });

    expect(context.reasonCode).toBe("failed_capture");
    expect(context.evidence?.allAttemptMissingScreenshotCount).toBe(1);
  });

  it("keeps all-attempt visual failures visible when no reference ranks", () => {
    const context = createInspiredesignGuidanceContext({
      brief: "Design a premium studio landing page",
      requestedProviders: [],
      discovery: {
        requested: false,
        acceptedUrls: [],
        failures: 0
      },
      metrics: {
        referenceCount: 0,
        referenceEvidenceRequired: false,
        failedCaptureCount: 0,
        visualEvidenceRequired: true
      },
      quality: {
        rankedReferenceCount: 0,
        rejectedReferenceCount: 1,
        missingScreenshotCount: 0,
        allAttemptFailedCaptureCount: 0,
        allAttemptMissingScreenshotCount: 0,
        allAttemptVisualFailureCount: 1,
        allAttemptMotionFailureCount: 0,
        diagnosticOnlyReasons: []
      }
    });

    expect(context.reasonCode).toBe("failed_capture");
    expect(context.evidence?.allAttemptVisualFailureCount).toBe(1);
  });

  it("does not suppress soft provider diagnostics when no user URL was supplied", () => {
    const context = createInspiredesignGuidanceContext({
      brief: "Design a premium studio landing page",
      requestedProviders: ["social/pinterest"],
      discovery: {
        requested: true,
        acceptedUrls: ["https://www.pinterest.com/pin/61572719900827789/"],
        failures: 1,
        failure: "Pinterest search shell produced one concrete pin and one failed search page."
      },
      metrics: {
        referenceCount: 1,
        failedCaptureCount: 0,
        visualEvidenceRequired: false
      },
      quality: {
        rankedReferenceCount: 1,
        rankedReferenceUrls: ["https://pinterest.com/pin/61572719900827789/"],
        authoritativeReferenceCount: 1,
        pinMediaReadyReferenceCount: 1,
        rejectedReferenceCount: 0,
        topReferenceScore: 88,
        topReferenceConfidence: 0.9,
        missingScreenshotCount: 0,
        diagnosticOnlyReasons: []
      }
    });

    expect(context.providerUnavailable).toBe(false);
    expect(context.reasonCode).toBe("design_ready");
    expect(context.referenceUrls).toEqual(["https://www.pinterest.com/pin/61572719900827789/"]);
  });

  it("keeps hard failures active when no requested Pinterest URL survives as ranked evidence", () => {
    const context = createInspiredesignGuidanceContext({
      brief: "Design a premium studio landing page",
      requestedProviders: ["social/pinterest"],
      discovery: {
        requested: true,
        acceptedUrls: ["https://www.pinterest.com/pin/61572719900827789/"],
        failures: 1,
        hardFailureReasonCodes: ["auth_required"]
      },
      metrics: {
        referenceCount: 1,
        failedCaptureCount: 0,
        visualEvidenceRequired: false
      },
      quality: {
        rankedReferenceCount: 1,
        rankedReferenceUrls: ["https://www.pinterest.com/pin/61572719900827789/"],
        rejectedReferenceCount: 0,
        topReferenceScore: 88,
        topReferenceConfidence: 0.9,
        missingScreenshotCount: 0,
        diagnosticOnlyReasons: []
      }
    });

    expect(context.providerUnavailable).toBe(true);
    expect(context.reasonCode).toBe("provider_unavailable");
  });

  it("falls back to aggregate capture counts when all-attempt fields are omitted", () => {
    const failedCaptureContext = createInspiredesignGuidanceContext({
      brief: "Design a premium studio landing page",
      requestedProviders: [],
      discovery: {
        requested: false,
        acceptedUrls: [],
        failures: 0
      },
      metrics: {
        referenceCount: 0,
        referenceEvidenceRequired: false,
        failedCaptureCount: 1,
        visualEvidenceRequired: true
      },
      quality: {
        rankedReferenceCount: 0,
        rejectedReferenceCount: 1,
        missingScreenshotCount: 0,
        allAttemptMissingScreenshotCount: 0,
        allAttemptVisualFailureCount: 0,
        diagnosticOnlyReasons: []
      }
    });
    const missingScreenshotContext = createInspiredesignGuidanceContext({
      brief: "Design a premium studio landing page",
      requestedProviders: [],
      discovery: {
        requested: false,
        acceptedUrls: [],
        failures: 0
      },
      metrics: {
        referenceCount: 0,
        referenceEvidenceRequired: false,
        failedCaptureCount: 0,
        visualEvidenceRequired: true
      },
      quality: {
        rankedReferenceCount: 0,
        rejectedReferenceCount: 1,
        missingScreenshotCount: 1,
        allAttemptFailedCaptureCount: 0,
        allAttemptVisualFailureCount: 0,
        diagnosticOnlyReasons: []
      }
    });

    expect(failedCaptureContext.reasonCode).toBe("failed_capture");
    expect(missingScreenshotContext.reasonCode).toBe("failed_capture");

    const readyContext = createInspiredesignGuidanceContext({
      brief: "Design a premium studio landing page",
      requestedProviders: [],
      discovery: {
        requested: false,
        acceptedUrls: [],
        failures: 0
      },
      metrics: {
        referenceCount: 0,
        referenceEvidenceRequired: false,
        failedCaptureCount: 0,
        visualEvidenceRequired: true
      },
      quality: {
        rankedReferenceCount: 0,
        rejectedReferenceCount: 0,
        missingScreenshotCount: 0,
        allAttemptFailedCaptureCount: 0,
        allAttemptMissingScreenshotCount: 0,
        allAttemptVisualFailureCount: 0,
        diagnosticOnlyReasons: []
      }
    });

    expect(readyContext.reasonCode).toBe("design_ready");
  });

  it("matches user-supplied site recipe URLs without a requested provider", () => {
    const context = createInspiredesignGuidanceContext({
      brief: "Design a premium photography studio landing page",
      urls: ["http://www.pinterest.com/pin/61572719900827789/?utm_source=test#fragment"],
      requestedProviders: [],
      discovery: {
        requested: true,
        acceptedUrls: [],
        failures: 1,
        failure: "Pinterest search shell did not yield additional refs"
      },
      metrics: {
        referenceCount: 1,
        failedCaptureCount: 0,
        visualEvidenceRequired: false
      },
      quality: {
        rankedReferenceCount: 1,
        rankedReferenceUrls: ["https://pinterest.com/pin/61572719900827789/"],
        authoritativeReferenceCount: 1,
        pinMediaReadyReferenceCount: 1,
        rejectedReferenceCount: 0,
        topReferenceScore: 88,
        topReferenceConfidence: 0.9,
        missingScreenshotCount: 0,
        diagnosticOnlyReasons: []
      }
    });

    expect(context.providerUnavailable).toBe(false);
    expect(context.reasonCode).toBe("design_ready");
    expect(context.siteRecipeId).toBe("social/pinterest");
  });
});
