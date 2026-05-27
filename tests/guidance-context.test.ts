import { describe, expect, it } from "vitest";
import { createInspiredesignGuidanceContext } from "../src/guidance/context";

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

  it("suppresses Pinterest hard failures only when the same Pinterest URL survives as ranked evidence", () => {
    const source = {
      brief: "Design a premium studio landing page",
      urls: ["https://www.pinterest.com/pin/61572719900827789/"],
      requestedProviders: ["social/pinterest"],
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
      discovery: {
        ...source.discovery,
        acceptedUrls: ["https://www.pinterest.com/pin/61572719900827789/"]
      },
      quality: {
        ...source.quality,
        rankedReferenceUrls: ["https://www.pinterest.com/pin/61572719900827789/"]
      }
    }).reasonCode).toBe("design_ready");
    expect(createInspiredesignGuidanceContext({
      ...source,
      requestedProviders: [],
      quality: {
        ...source.quality,
        rankedReferenceUrls: ["https://www.pinterest.com/pin/61572719900827789/"]
      }
    }).providerUnavailable).toBe(false);
    expect(createInspiredesignGuidanceContext({
      ...source,
      urls: ["https://example.com/reference"],
      quality: {
        ...source.quality,
        rankedReferenceUrls: ["https://www.pinterest.com/pin/61572719900827789/"]
      }
    }).providerUnavailable).toBe(true);
    expect(createInspiredesignGuidanceContext({
      ...source,
      urls: ["not a url", "https://www.pinterest.com/pin/61572719900827789/"],
      requestedProviders: ["social/not-pinterest"],
      quality: {
        ...source.quality,
        rankedReferenceUrls: ["https://www.pinterest.com/pin/61572719900827789/"]
      }
    }).providerUnavailable).toBe(false);
    expect(createInspiredesignGuidanceContext({
      ...source,
      urls: ["https://www.pinterest.com/pin/61572719900827789/"],
      requestedProviders: ["social/pinterest"],
      quality: {
        ...source.quality,
        rankedReferenceUrls: ["not a url"]
      }
    }).providerUnavailable).toBe(true);
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
});
