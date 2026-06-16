import { describe, expect, it } from "vitest";
import {
  buildProductVideoPresentation,
  evaluateProductVideoPresentationReadiness,
  renderProductVideoCopyMarkdown,
  type ProductVideoPresentation,
  type ProductVideoPresentationInput,
  type ProductVideoPresentationReasonCode,
  type ProductVideoPresentationSourceRecord
} from "../src/providers/product-video-presentation";

const EBAY_NOISY_CONTENT = [
  "Type Vertical Mouse Maximum DPI 1200 Connectivity Wireless Features Adjustable DPI, Ergonomic.",
  "Quantity 1 available.",
  "Condition: New: A brand-new, unused, unopened, undamaged item in its original packaging.",
  "May not ship to Canada.",
  "Seller feedback is 98% positive.",
  "Buy It Now and add to cart.",
  "Returns accepted within 30 days."
].join(" ");

const MARKETPLACE_ONLY_CONTENT = [
  "Quantity 1 available.",
  "Condition: New: A brand-new, unused, unopened, undamaged item in its original packaging.",
  "May not ship to Canada.",
  "Seller feedback is 98% positive.",
  "Buy It Now and checkout today.",
  "Returns accepted within 30 days."
].join(" ");

const BAD_MARKETPLACE_FRAGMENTS = [
  /Quantity 1/i,
  /Condition: New/i,
  /May not ship to Canada/i,
  /Seller feedback/i,
  /Buy It Now/i,
  /original packaging/i,
  /Returns accepted/i
] as const;

const DEFAULT_TEST_TITLE_FALLBACK = "Product";

const ALLOWED_REASON_CODES: readonly ProductVideoPresentationReasonCode[] = [
  "marketplace_chrome_rejected",
  "positive_spec_promoted",
  "insufficient_clean_feature_evidence",
  "copy_omitted_by_request",
  "missing_visual_assets",
  "unsupported_claim_rejected",
  "raw_fragment_rejected",
  "selected_record_changed",
  "copy_generation_blocked"
];

const productRecord = (overrides: Partial<ProductVideoPresentationSourceRecord> = {}): ProductVideoPresentationSourceRecord => ({
  id: "record-1",
  provider: "shopping/ebay",
  url: "https://www.ebay.com/itm/123",
  title: "Logitech Lift Vertical Ergonomic Mouse",
  content: "Clean source record.",
  attributes: {},
  ...overrides
});

const cleanInput = (overrides: Partial<ProductVideoPresentationInput> = {}): ProductVideoPresentationInput => ({
  title: "Logitech Lift Vertical Ergonomic Mouse",
  brand: "Logitech",
  provider: "shopping/ebay",
  productUrl: "https://www.ebay.com/itm/123",
  price: { amount: 79.99, currency: "USD", formatted: "$79.99" },
  includeCopy: true,
  images: ["images/image-01.webp"],
  screenshots: ["screenshots/screenshot-01.png"],
  sourceRecord: productRecord(),
  metadata: {
    specs: {
      type: "Vertical Mouse",
      maximum_dpi: "1200",
      connectivity: "Wireless",
      features: ["Adjustable DPI", "Ergonomic"]
    }
  },
  ...overrides
});

const renderedPresentationText = (presentation: ProductVideoPresentation): string => [
  presentation.copy,
  presentation.features.join("\n"),
  presentation.copyMarkdown,
  presentation.featuresMarkdown
].join("\n");

const generatedCopyAndFeatures = (presentation: ProductVideoPresentation): string => [
  presentation.copy,
  presentation.features.join("\n")
].join("\n");

describe("product-video-presentation", () => {
  it("evaluates pass, partial, and fail readiness statuses", () => {
    const pass = buildProductVideoPresentation(cleanInput());
    const partial = buildProductVideoPresentation(cleanInput({ images: [], screenshots: [] }));
    const fail = buildProductVideoPresentation(cleanInput({
      metadata: {},
      sourceRecord: productRecord({ content: MARKETPLACE_ONLY_CONTENT })
    }));

    expect(pass.presentationReadiness.status).toBe("pass");
    expect(partial.presentationReadiness.status).toBe("partial");
    expect(partial.presentationReadiness.reasonCodes).toContain("missing_visual_assets");
    expect(fail.presentationReadiness.status).toBe("fail");
    expect(fail.presentationReadiness.reasonCodes).toEqual(expect.arrayContaining([
      "marketplace_chrome_rejected",
      "insufficient_clean_feature_evidence",
      "copy_generation_blocked"
    ]));
  });

  it("rejects noisy eBay marketplace chrome while promoting clean specs from the same record", () => {
    const presentation = buildProductVideoPresentation(cleanInput({
      metadata: {},
      sourceRecord: productRecord({ content: EBAY_NOISY_CONTENT })
    }));
    const finalText = generatedCopyAndFeatures(presentation);

    expect(presentation.presentationReadiness.status).toBe("pass");
    expect(presentation.presentationReadiness.reasonCodes).toEqual(expect.arrayContaining([
      "marketplace_chrome_rejected",
      "positive_spec_promoted"
    ]));
    expect(presentation.rejectedCandidates.some((entry) => entry.reasonCode === "marketplace_chrome_rejected")).toBe(true);
    expect(finalText).toMatch(/Vertical Mouse/i);
    expect(finalText).toMatch(/1200 DPI/i);
    expect(finalText).toMatch(/Wireless connectivity/i);
    expect(finalText).toMatch(/Adjustable DPI/i);
    for (const fragment of BAD_MARKETPLACE_FRAGMENTS) {
      expect(finalText).not.toMatch(fragment);
    }
  });

  it("keeps include_copy=false as a partial readiness note instead of silent empty copy", () => {
    const presentation = buildProductVideoPresentation(cleanInput({ includeCopy: false }));

    expect(presentation.presentationReadiness.status).toBe("partial");
    expect(presentation.presentationReadiness.reasonCodes).toContain("copy_omitted_by_request");
    expect(presentation.copy).toBe("");
    expect(presentation.copyMarkdown).toContain("include\\_copy=false");
    expect(presentation.copyMarkdown).toContain("Generate or supply copy before production use");
    expect(presentation.features.length).toBeGreaterThan(0);
  });

  it("emits the stable readiness schema with known reason codes and criteria", () => {
    const presentation = buildProductVideoPresentation(cleanInput({
      copyCandidates: ["The best vertical mouse ever, guaranteed to cure wrist pain."],
      selectedRecordId: "record-2",
      originalPrimaryRecordId: "record-1"
    }));
    const readiness = presentation.presentationReadiness;

    expect(Object.keys(readiness).sort()).toEqual(["criteria", "reasonCodes", "status", "warnings"].sort());
    expect(readiness.reasonCodes.every((code) => ALLOWED_REASON_CODES.includes(code))).toBe(true);
    expect(readiness.reasonCodes).toEqual(expect.arrayContaining([
      "positive_spec_promoted",
      "unsupported_claim_rejected",
      "selected_record_changed"
    ]));
    for (const criterion of readiness.criteria) {
      expect(Object.keys(criterion).sort()).toEqual(["label", "observed", "passed", "threshold"].sort());
    }
    expect(presentation.productVideoReadiness).toEqual(readiness);
  });

  it("rejects unsupported candidate claims without rendering them", () => {
    const presentation = buildProductVideoPresentation(cleanInput({
      copyCandidates: ["The best vertical mouse ever, guaranteed to cure wrist pain."]
    }));
    const finalText = renderedPresentationText(presentation);

    expect(presentation.rejectedCandidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ reasonCode: "unsupported_claim_rejected" })
    ]));
    expect(finalText).not.toMatch(/best vertical mouse ever/i);
    expect(finalText).not.toMatch(/cure wrist pain/i);
  });

  it("does not use URL-shaped values as presentation titles", () => {
    const presentation = buildProductVideoPresentation(cleanInput({
      title: "https://example.test/noisy-product",
      productUrl: "https://example.test/noisy-product",
      sourceRecord: productRecord({
        title: "https://example.test/noisy-product"
      })
    }));

    expect(presentation.title).toBe(DEFAULT_TEST_TITLE_FALLBACK);
    expect(presentation.copy).toContain(`${DEFAULT_TEST_TITLE_FALLBACK} combines captured product details`);
    expect(presentation.copy).not.toContain("https://example.test/noisy-product");
  });

  it("attaches evidence references to every promoted spec claim", () => {
    const presentation = buildProductVideoPresentation(cleanInput({
      metadata: {},
      sourceRecord: productRecord({ content: EBAY_NOISY_CONTENT })
    }));

    expect(presentation.promotedClaims.length).toBeGreaterThanOrEqual(4);
    for (const claim of presentation.promotedClaims) {
      expect(claim.reasonCode).toBe("positive_spec_promoted");
      expect(claim.evidenceReferences[0]).toEqual(expect.objectContaining({
        recordId: "record-1",
        provider: "shopping/ebay",
        source: "source_content",
        path: "content"
      }));
      expect(claim.evidenceReferences[0]?.excerpt.length).toBeGreaterThan(0);
    }
    expect(presentation.evidenceReferences.length).toBe(presentation.promotedClaims.length);
  });

  it("preserves explicit DPI suffixes without duplicating the unit", () => {
    const presentation = buildProductVideoPresentation(cleanInput({
      metadata: {
        specs: {
          maximum_dpi: "1600 DPI",
          connectivity: "Wireless",
          features: ["Compact shell", "Quiet buttons"]
        }
      }
    }));
    const finalText = generatedCopyAndFeatures(presentation);

    expect(finalText).toContain("1600 DPI tracking supports everyday pointer control.");
    expect(finalText).not.toContain("DPI DPI");
  });

  it("summarizes rejected candidates with reason codes and evidence references", () => {
    const presentation = buildProductVideoPresentation(cleanInput({
      metadata: {},
      sourceRecord: productRecord({ content: MARKETPLACE_ONLY_CONTENT })
    }));

    expect(presentation.rejectedCandidates.length).toBeGreaterThan(0);
    for (const rejected of presentation.rejectedCandidates) {
      expect(rejected.reasonCode).toBe("marketplace_chrome_rejected");
      expect(rejected.reason).toMatch(/marketplace|checkout|shipping|condition|seller|returns/i);
      expect(rejected.evidenceReferences[0]).toEqual(expect.objectContaining({
        recordId: "record-1",
        provider: "shopping/ebay",
        source: "source_content",
        path: "content"
      }));
    }
    expect(presentation.candidateSummaries[0]).toEqual(expect.objectContaining({
      recordId: "record-1",
      cleanSpecCount: 0,
      rejectedCandidateCount: presentation.rejectedCandidates.length
    }));
  });

  it("does not promote marketplace-only evidence into generated copy or features", () => {
    const presentation = buildProductVideoPresentation(cleanInput({
      metadata: {},
      sourceRecord: productRecord({ content: MARKETPLACE_ONLY_CONTENT })
    }));
    const finalText = generatedCopyAndFeatures(presentation);

    expect(presentation.presentationReadiness.status).toBe("fail");
    expect(presentation.copy).toBe("");
    expect(presentation.features).toEqual([]);
    expect(presentation.featuresMarkdown).toContain("clean product-benefit evidence was not found");
    for (const fragment of BAD_MARKETPLACE_FRAGMENTS) {
      expect(finalText).not.toMatch(fragment);
    }
  });

  it("collects structured specs from source attributes, nested details, and metadata features", () => {
    const presentation = buildProductVideoPresentation(cleanInput({
      metadata: { features: ["Quiet buttons."] },
      sourceRecord: productRecord({
        content: "",
        attributes: {
          product_type: "Trackball Mouse",
          max_dpi: 1600,
          connectivity: "Bluetooth",
          features: ["Thumb control.", "Compact shell."],
          specs: {
            maximum_dpi: 1600,
            ignored: "marketplace detail"
          },
          details: {
            type: "Trackball Mouse"
          }
        }
      })
    }));
    const values = presentation.promotedClaims.map((claim) => claim.specValue);
    const referenceSources = presentation.evidenceReferences.map((reference) => reference.source);
    const finalText = generatedCopyAndFeatures(presentation);

    expect(presentation.presentationReadiness.status).toBe("pass");
    expect(values).toEqual(expect.arrayContaining(["Trackball Mouse", "1600", "Bluetooth", "Thumb control", "Compact shell", "Quiet buttons"]));
    expect(referenceSources).toEqual(expect.arrayContaining(["source_attribute", "metadata_feature"]));
    expect(finalText).not.toMatch(/\b(?:Thumb control|Compact shell|Quiet buttons)\. supports\b/i);
  });

  it("keeps two distinct feature facts partial instead of passing from combined feature inflation", () => {
    const presentation = buildProductVideoPresentation(cleanInput({
      metadata: {},
      sourceRecord: productRecord({
        content: "",
        attributes: {
          features: ["Thumb control", "Compact shell"]
        }
      })
    }));

    expect(presentation.promotedClaims.map((claim) => claim.specValue)).toEqual(["Thumb control", "Compact shell"]);
    expect(presentation.presentationReadiness.status).toBe("partial");
    expect(presentation.presentationReadiness.reasonCodes).toContain("insufficient_clean_feature_evidence");
  });

  it("keeps feature-only evidence partial even when there are enough feature claims", () => {
    const presentation = buildProductVideoPresentation(cleanInput({
      metadata: {
        features: ["Thumb control", "Compact shell", "Quiet buttons"]
      },
      sourceRecord: productRecord({
        content: "",
        attributes: {}
      })
    }));

    expect(presentation.promotedClaims.map((claim) => claim.specKey)).toEqual(["features", "features", "features"]);
    expect(presentation.presentationReadiness.status).toBe("partial");
    expect(presentation.presentationReadiness.criteria[0]?.observed).toContain("1 evidence dimension");
    expect(presentation.presentationReadiness.reasonCodes).toContain("insufficient_clean_feature_evidence");
  });

  it("handles metadata-only input without a source record and preserves supplied candidate summaries", () => {
    const candidateSummaries = [{
      recordId: "selected-record",
      provider: "shopping/manual",
      title: "Manual Mouse Evidence",
      cleanSpecCount: 4,
      rejectedCandidateCount: 0
    }];
    const presentation = buildProductVideoPresentation(cleanInput({
      sourceRecord: undefined,
      productUrl: undefined,
      provider: undefined,
      price: undefined,
      candidateSummaries,
      metadata: {
        specs: {
          type: "Vertical Mouse",
          maximum_dpi: 1200,
          connectivity: "USB-C",
          features: ["Ergonomic shell", "Adjustable DPI"]
        }
      }
    }));

    expect(presentation.presentationReadiness.status).toBe("pass");
    expect(presentation.productUrl).toBeUndefined();
    expect(presentation.provider).toBeUndefined();
    expect(presentation.price).toBeUndefined();
    expect(presentation.candidateSummaries).toEqual(candidateSummaries);
    expect(presentation.evidenceReferences.every((reference) => reference.recordId === undefined)).toBe(true);

    const noSummary = buildProductVideoPresentation(cleanInput({
      sourceRecord: undefined,
      candidateSummaries: undefined
    }));
    expect(noSummary.candidateSummaries).toEqual([]);
  });

  it("falls back from marketplace title chrome and blocks copy for failed evidence", () => {
    const presentation = buildProductVideoPresentation({
      title: "Buy It Now from seller checkout page",
      includeCopy: true,
      sourceRecord: productRecord({
        title: undefined,
        content: MARKETPLACE_ONLY_CONTENT
      })
    });

    expect(presentation.title).toBe(DEFAULT_TEST_TITLE_FALLBACK);
    expect(presentation.presentationReadiness.status).toBe("fail");
    expect(presentation.copyMarkdown).toContain("Presentation copy is blocked");
  });

  it("skips marketplace-like values even when they appear in spec-shaped fields", () => {
    const presentation = buildProductVideoPresentation(cleanInput({
      metadata: {
        specs: {
          type: "Vertical Mouse",
          maximum_dpi: "1200",
          connectivity: "Wireless",
          features: "Adjustable DPI",
          warranty: "Lifetime marketplace promise"
        }
      },
      sourceRecord: productRecord({
        content: "Features Shipping may not be available.",
        attributes: {
          features: ["Seller feedback included"],
          specs: "not a spec object",
          specifications: ["not a spec object"]
        }
      })
    }));
    const values = presentation.promotedClaims.map((claim) => claim.specValue).join("\n");

    expect(presentation.presentationReadiness.status).toBe("pass");
    expect(values).not.toMatch(/Shipping may not be available/i);
    expect(values).not.toMatch(/Seller feedback/i);
    expect(values).not.toMatch(/Lifetime marketplace promise/i);
  });

  it("rejects unsupported claims from spec-shaped metadata and attributes", () => {
    const presentation = buildProductVideoPresentation(cleanInput({
      metadata: {
        specs: {
          type: "Vertical Mouse",
          maximum_dpi: "1200",
          connectivity: "Wireless",
          features: ["Guaranteed #1 comfort", "Risk-free returns promise"]
        }
      },
      sourceRecord: productRecord({
        content: "",
        attributes: {
          features: ["Clinically proven wrist cure"],
          specs: {
            features: ["Lifetime warranty comfort"]
          }
        }
      })
    }));
    const finalText = renderedPresentationText(presentation);

    expect(presentation.presentationReadiness.status).toBe("pass");
    expect(presentation.presentationReadiness.reasonCodes).toContain("unsupported_claim_rejected");
    expect(presentation.rejectedCandidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ reasonCode: "unsupported_claim_rejected", source: "metadata_feature" }),
      expect.objectContaining({ reasonCode: "unsupported_claim_rejected", source: "source_attribute" })
    ]));
    expect(finalText).not.toMatch(/Guaranteed #1 comfort/i);
    expect(finalText).not.toMatch(/Risk-free returns promise/i);
    expect(finalText).not.toMatch(/Clinically proven wrist cure/i);
    expect(finalText).not.toMatch(/Lifetime warranty comfort/i);
  });

  it("rejects over-broad page fragments from feature candidates before promotion", () => {
    const rawFeatureFragment = [
      "Aurora Trackball Mouse Brand: Aurora Labs",
      "Type: Vertical Trackball Mouse",
      "Maximum DPI: 1600",
      "Connectivity: Wireless",
      "Features: Thumb rest."
    ].join(" ");
    const presentation = buildProductVideoPresentation(cleanInput({
      metadata: {
        specs: {
          type: "Vertical Trackball Mouse",
          maximum_dpi: "1600",
          connectivity: "Wireless",
          features: ["Compact shell", "Quiet buttons"]
        },
        features: [rawFeatureFragment]
      },
      featureCandidates: [rawFeatureFragment]
    }));
    const finalText = generatedCopyAndFeatures(presentation);

    expect(presentation.presentationReadiness.status).toBe("pass");
    expect(presentation.presentationReadiness.reasonCodes).toContain("raw_fragment_rejected");
    expect(presentation.rejectedCandidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ reasonCode: "raw_fragment_rejected", source: "metadata_feature" }),
      expect.objectContaining({ reasonCode: "raw_fragment_rejected", source: "feature_candidate" })
    ]));
    expect(finalText).toMatch(/Vertical Trackball Mouse design/i);
    expect(finalText).toMatch(/1600 DPI tracking/i);
    expect(finalText).toMatch(/Wireless connectivity/i);
    expect(finalText).not.toMatch(/Brand: Aurora Labs/i);
    expect(finalText).not.toMatch(/Features: Thumb rest/i);
  });

  it("evaluates direct final-leak facts and renders empty reason-code summaries", () => {
    const leakReadiness = evaluateProductVideoPresentationReadiness({
      includeCopy: true,
      promotedClaimCount: 3,
      promotedSpecKeyCount: 2,
      visualAssetCount: 1,
      marketplaceRejectedCount: 0,
      unsupportedRejectedCount: 0,
      rawFragmentRejectedCount: 0,
      finalMarketplaceLeakCount: 1,
      selectedRecordChanged: false
    });
    const markdown = renderProductVideoCopyMarkdown({
      title: "Clean Mouse",
      copy: "Clean copy.",
      includeCopy: true,
      readiness: { status: "pass", warnings: [], reasonCodes: [], criteria: [] }
    });

    expect(leakReadiness.status).toBe("fail");
    expect(leakReadiness.reasonCodes).toEqual(expect.arrayContaining([
      "marketplace_chrome_rejected",
      "copy_generation_blocked"
    ]));
    expect(leakReadiness.warnings).toContain("marketplace chrome appeared in generated presentation text");
    expect(markdown).toContain("Reason codes: none");
    expect(markdown).toContain("- None reported.");
  });

  it("rejects marketplace and unsupported candidates from every public candidate source", () => {
    const presentation = buildProductVideoPresentation(cleanInput({
      metadata: {
        specs: {
          type: "Vertical Mouse",
          maximum_dpi: "1200",
          connectivity: "Wireless",
          features: "Adjustable DPI"
        },
        description: "Free returns and risk-free checkout.",
        features: ["Shipping may not be available to Canada."]
      },
      featureCandidates: ["Seller feedback is excellent."],
      copyCandidates: ["Guaranteed number one vertical mouse."]
    }));
    const rejectedSources = presentation.rejectedCandidates.map((entry) => entry.source);

    expect(presentation.presentationReadiness.status).toBe("pass");
    expect(rejectedSources).toEqual(expect.arrayContaining([
      "metadata_description",
      "metadata_feature",
      "feature_candidate",
      "copy_candidate"
    ]));
    expect(presentation.rejectedCandidates.map((entry) => entry.reasonCode)).toEqual(expect.arrayContaining([
      "marketplace_chrome_rejected",
      "unsupported_claim_rejected"
    ]));
  });
});
