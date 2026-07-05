import { describe, expect, it } from "vitest";
import {
  buildProductVideoPresentation,
  countPublicProductVideoIdentityViolations,
  countPublicProductVideoTextViolations,
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

const CONCATENATED_MARKETPLACE_SPEC_RUN = [
  "MPN 910005447 Item Length 4.7in.",
  "Tracking Method Optical Number of Buttons 4 Brand Logitech",
  "Type Vertical Mouse Maximum DPI 4000",
  "Connectivity Wireless Charger Included No",
  "Features Ergonomic Item Width 3.1in. Country of Origin China"
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
  "site_chrome_rejected",
  "positive_spec_promoted",
  "insufficient_clean_feature_evidence",
  "copy_omitted_by_request",
  "missing_visual_assets",
  "unsupported_claim_rejected",
  "raw_fragment_rejected",
  "selected_record_changed",
  "title_fallback_used",
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

  it("extracts clean facts from concatenated marketplace spec runs without promoting neighbor labels", () => {
    const presentation = buildProductVideoPresentation(cleanInput({
      metadata: {},
      sourceRecord: productRecord({ content: CONCATENATED_MARKETPLACE_SPEC_RUN })
    }));
    const values = presentation.promotedClaims.map((claim) => `${claim.specKey}:${claim.specValue}`);
    const publicText = [
      generatedCopyAndFeatures(presentation),
      presentation.promotedClaims.map((claim) => claim.specValue).join("\n")
    ].join("\n");

    expect(presentation.presentationReadiness.status).toBe("pass");
    expect(presentation.presentationReadiness.reasonCodes).toContain("raw_fragment_rejected");
    expect(values).toEqual(expect.arrayContaining([
      "type:Vertical Mouse",
      "maximum_dpi:4000",
      "connectivity:Wireless",
      "features:Ergonomic"
    ]));
    expect(publicText).toContain("Wireless connectivity supports a cleaner setup.");
    expect(publicText).toContain("Ergonomic.");
    expect(publicText).not.toMatch(/Wireless Charger Included No/i);
    expect(publicText).not.toMatch(/Charger Included No connectivity/i);
    expect(publicText).not.toMatch(/Tracking Method|Item Length|Country of Origin/i);
  });

  it("fails closed when a neighboring boolean spec is the only promoted value", () => {
    const presentation = buildProductVideoPresentation(cleanInput({
      metadata: {
        specs: {
          connectivity: "Wireless Charger Included No"
        }
      },
      sourceRecord: productRecord({ content: "" })
    }));
    const publicText = renderedPresentationText(presentation);

    expect(presentation.presentationReadiness.status).toBe("fail");
    expect(presentation.presentationReadiness.reasonCodes).toEqual(expect.arrayContaining([
      "raw_fragment_rejected",
      "insufficient_clean_feature_evidence",
      "copy_generation_blocked"
    ]));
    expect(presentation.promotedClaims).toEqual([]);
    expect(publicText).not.toMatch(/Wireless Charger Included No/i);
    expect(publicText).not.toMatch(/Charger Included No connectivity/i);
  });

  it("does not treat prose mentions of spec labels as clean labeled specs", () => {
    const presentation = buildProductVideoPresentation(cleanInput({
      metadata: {
        specs: {
          type: "Vertical Trackball Mouse",
          maximum_dpi: "1600",
          features: ["thumb rest", "quiet buttons"]
        }
      },
      sourceRecord: productRecord({
        content: "Aurora Trackball Mouse has wireless connectivity and precision tracking."
      })
    }));
    const finalText = generatedCopyAndFeatures(presentation);

    expect(presentation.presentationReadiness.status).toBe("pass");
    expect(finalText).toMatch(/Thumb rest\./);
    expect(finalText).toMatch(/Quiet buttons\./);
    expect(finalText).not.toMatch(/and precision tracking connectivity supports/i);
    expect(presentation.promotedClaims.some((claim) => (
      claim.specKey === "connectivity" && /precision tracking/i.test(claim.specValue)
    ))).toBe(false);
  });

  it("skips empty content spec headings while promoting later labeled values", () => {
    const presentation = buildProductVideoPresentation(cleanInput({
      metadata: {},
      sourceRecord: productRecord({
        content: "Features. Type Vertical Mouse Maximum DPI 1200 Connectivity USB-C Features Quiet buttons."
      })
    }));
    const values = presentation.promotedClaims.map((claim) => claim.specValue);

    expect(presentation.presentationReadiness.status).toBe("pass");
    expect(values).toEqual(expect.arrayContaining(["Vertical Mouse", "1200", "USB-C", "Quiet buttons"]));
    expect(values).not.toContain("");
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

  it("rejects standalone best claims from identity, feature, and copy paths", () => {
    const unsupportedIdentity = "Best vertical mouse for every desk";
    const presentation = buildProductVideoPresentation(cleanInput({
      title: unsupportedIdentity,
      brand: unsupportedIdentity,
      sourceRecord: productRecord({ title: unsupportedIdentity }),
      metadata: {
        specs: {
          type: "Vertical Trackball Mouse",
          maximum_dpi: "1600",
          connectivity: "Wireless",
          features: ["Best vertical mouse comfort for long sessions", "Quiet buttons"]
        }
      },
      copyCandidates: ["Best vertical mouse pick for every workflow."]
    }));
    const finalText = renderedPresentationText(presentation);

    expect(presentation.title).toBe(DEFAULT_TEST_TITLE_FALLBACK);
    expect(presentation.presentationReadiness.reasonCodes).toEqual(expect.arrayContaining([
      "title_fallback_used",
      "unsupported_claim_rejected"
    ]));
    expect(presentation.rejectedCandidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ reasonCode: "unsupported_claim_rejected", source: "metadata_feature" }),
      expect.objectContaining({ reasonCode: "unsupported_claim_rejected", source: "copy_candidate" })
    ]));
    expect(countPublicProductVideoIdentityViolations(["Best vertical mouse for every desk"])).toEqual({
      marketplace: 0,
      siteChrome: 0,
      unsupported: 1,
      rawFragment: 0
    });
    expect(presentation.brand).toBeUndefined();
    expect(finalText).not.toMatch(/Best vertical mouse/i);
  });

  it("rejects number one claims from title and brand identity paths", () => {
    const unsupportedIdentity = "Number one vertical mouse for every desk";
    const presentation = buildProductVideoPresentation(cleanInput({
      title: unsupportedIdentity,
      brand: unsupportedIdentity,
      sourceRecord: productRecord({ title: unsupportedIdentity })
    }));
    const finalText = renderedPresentationText(presentation);

    expect(presentation.title).toBe(DEFAULT_TEST_TITLE_FALLBACK);
    expect(presentation.brand).toBeUndefined();
    expect(presentation.presentationReadiness.reasonCodes).toContain("title_fallback_used");
    expect(countPublicProductVideoIdentityViolations([unsupportedIdentity])).toEqual({
      marketplace: 0,
      siteChrome: 0,
      unsupported: 1,
      rawFragment: 0
    });
    expect(finalText).not.toMatch(/Number one vertical mouse/i);
  });

  it("cleans marketplace accessory caveats from specific public identity titles", () => {
    const expectedTitle = "Logitech MX Vertical Wireless Mouse Ergonomic, Graphite";
    const caveatTitles = [
      `${expectedTitle} - *NO DONGLE*`,
      `${expectedTitle} (NO DONGLE)`,
      `${expectedTitle} no receiver`
    ] as const;

    for (const rawTitle of caveatTitles) {
      const presentation = buildProductVideoPresentation(cleanInput({
        title: rawTitle,
        sourceRecord: productRecord({ title: rawTitle })
      }));
      const publicText = [
        presentation.title,
        presentation.copy,
        presentation.copyMarkdown,
        ...presentation.candidateSummaries.map((summary) => summary.title ?? "")
      ].join("\n");

      expect(presentation.title).toBe(expectedTitle);
      expect(presentation.presentationReadiness.reasonCodes).not.toContain("title_fallback_used");
      expect(publicText).toContain(expectedTitle);
      expect(publicText).not.toMatch(/NO DONGLE|no receiver/i);
      expect(presentation.candidateSummaries).toEqual(expect.arrayContaining([
        expect.objectContaining({ title: expectedTitle })
      ]));
    }
  });

  it("preserves legitimate terminal punctuation and balanced parenthetical title text", () => {
    for (const title of [
      "Fallback description title.",
      "Apple AirPods Pro (2nd Generation) with MagSafe Case (USB-C)"
    ]) {
      const presentation = buildProductVideoPresentation(cleanInput({
        title,
        sourceRecord: productRecord({ title })
      }));

      expect(presentation.title).toBe(title);
      expect(presentation.presentationReadiness.reasonCodes).not.toContain("title_fallback_used");
    }
  });

  it("counts public text violation categories for defensive final-output gating", () => {
    expect(countPublicProductVideoTextViolations([
      "Buy It Now checkout text",
      "Find a Store",
      "Guaranteed #1 comfort",
      "Best vertical mouse for every desk",
      "Brand Aurora Type Mouse Maximum DPI 1200",
      "Clean product benefit"
    ])).toEqual({
      marketplace: 1,
      siteChrome: 1,
      unsupported: 2,
      rawFragment: 1
    });
    expect(countPublicProductVideoIdentityViolations([
      "Best Buy essentials Wireless Mouse",
      "Find a Store",
      "Guaranteed #1 comfort mouse",
      "Brand Aurora Type Mouse Maximum DPI 1200",
      "Seller checkout title",
      "Store",
      "Mac",
      "iPad",
      "iPhone",
      "Watch",
      "Vision",
      "AirPods"
    ])).toEqual({
      marketplace: 1,
      siteChrome: 8,
      unsupported: 1,
      rawFragment: 1
    });
  });

  it("rejects site navigation and catalog chrome from public identity fields", () => {
    const presentation = buildProductVideoPresentation(cleanInput({
      title: "Find a Store",
      brand: "TV & Home",
      sourceRecord: productRecord({ title: "Accessories" }),
      metadata: {
        specs: {
          type: "Vertical Mouse",
          maximum_dpi: "2400",
          connectivity: "Bluetooth",
          features: ["quiet buttons"]
        }
      }
    }));
    const publicText = renderedPresentationText(presentation);

    expect(presentation.presentationReadiness.status).toBe("partial");
    expect(presentation.presentationReadiness.reasonCodes).toEqual(expect.arrayContaining([
      "title_fallback_used",
      "positive_spec_promoted"
    ]));
    expect(presentation.title).toBe(DEFAULT_TEST_TITLE_FALLBACK);
    expect(presentation.brand).toBeUndefined();
    expect(publicText).not.toMatch(/Find a Store|TV & Home|Accessories/i);
  });

  it("rejects standalone root navigation labels from public identity fields", () => {
    const presentation = buildProductVideoPresentation(cleanInput({
      title: "Store",
      brand: "AirPods",
      sourceRecord: productRecord({ title: "iPhone" }),
      metadata: {
        specs: {
          type: "Desk Dock",
          connectivity: "USB-C",
          features: [
            "Magnetic cable rail keeps workspaces tidy",
            "Weighted base keeps accessories stable"
          ]
        }
      }
    }));
    const publicText = renderedPresentationText(presentation);

    expect(presentation.presentationReadiness.status).toBe("partial");
    expect(presentation.presentationReadiness.reasonCodes).toEqual(expect.arrayContaining([
      "title_fallback_used",
      "positive_spec_promoted"
    ]));
    expect(presentation.title).toBe(DEFAULT_TEST_TITLE_FALLBACK);
    expect(presentation.brand).toBeUndefined();
    expect(publicText).not.toMatch(/\b(?:Store|AirPods|iPhone)\b/i);
  });

  it("keeps clean product identity and prose that use ordinary best, type, and features words", () => {
    const presentation = buildProductVideoPresentation(cleanInput({
      title: "Best Buy essentials Wireless Mouse",
      brand: "Best Buy essentials",
      metadata: {
        specs: {
          type: "Wireless Mouse",
          maximum_dpi: "1200",
          connectivity: "Bluetooth",
          features: ["a new type of side grip that features quiet control"]
        }
      },
      sourceRecord: productRecord({
        title: "Best Buy essentials Wireless Mouse"
      })
    }));
    const publicText = [
      presentation.title,
      presentation.brand ?? "",
      generatedCopyAndFeatures(presentation)
    ].join("\n");

    expect(presentation.presentationReadiness.status).toBe("pass");
    expect(presentation.title).toBe("Best Buy essentials Wireless Mouse");
    expect(presentation.brand).toBe("Best Buy essentials");
    expect(publicText).toContain("A new type of side grip that features quiet control.");
  });

  it("rejects marketplace taxonomy and malformed prose fragments before public promotion", () => {
    const presentation = buildProductVideoPresentation(cleanInput({
      metadata: {
        specs: {
          type: ["& Touchpads", "of applications"],
          maximum_dpi: "1600",
          connectivity: "Wireless",
          features: ["Keyboard & Mouse Bundles"]
        }
      },
      sourceRecord: productRecord({ content: "" })
    }));
    const publicText = generatedCopyAndFeatures(presentation);
    const promotedValues = presentation.promotedClaims.map((claim) => claim.specValue).join("\n");

    expect(presentation.presentationReadiness.status).toBe("partial");
    expect(presentation.presentationReadiness.reasonCodes).toEqual(expect.arrayContaining([
      "site_chrome_rejected",
      "raw_fragment_rejected",
      "insufficient_clean_feature_evidence"
    ]));
    expect(promotedValues).not.toMatch(/& Touchpads|Keyboard & Mouse Bundles|of applications/i);
    expect(publicText).not.toMatch(/& Touchpads|Keyboard & Mouse Bundles|of applications design/i);
  });

  it("counts exact marketplace taxonomy and malformed prose public leaks", () => {
    expect(countPublicProductVideoTextViolations([
      "& Touchpads",
      "Keyboard & Mouse Bundles",
      "of applications design gives the product a clear presentation category."
    ])).toEqual({
      marketplace: 0,
      siteChrome: 1,
      unsupported: 0,
      rawFragment: 2
    });
  });

  it("rejects site navigation and catalog chrome before public feature promotion", () => {
    const presentation = buildProductVideoPresentation(cleanInput({
      provider: "web/default",
      productUrl: "https://www.apple.com/shop/product/MXK53AM/A/magic-mouse-usb-c-white-multi-touch-surface",
      metadata: {
        specs: {
          type: "Multi-Touch Mouse",
          connectivity: "USB-C",
          maximum_dpi: "1300",
          features: [
            "Tech Specs",
            "TV & Home",
            "Accessories",
            "Apple Vision Pro",
            "Find a Store",
            "Order Status",
            "Multi-Touch surface",
            "Rechargeable battery",
            "Canada (English)",
            "Canada (Français)",
            "Other country or region"
          ]
        },
        features: [
          "Shop the Latest",
          "All products",
          "Apple Trade In"
        ]
      }
    }));
    const finalText = generatedCopyAndFeatures(presentation);

    expect(presentation.presentationReadiness.status).toBe("pass");
    expect(presentation.presentationReadiness.reasonCodes).toContain("site_chrome_rejected");
    expect(presentation.rejectedCandidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ reasonCode: "site_chrome_rejected", source: "metadata_feature" })
    ]));
    expect(finalText).toContain("Multi-Touch surface.");
    expect(finalText).toContain("Rechargeable battery.");
    expect(finalText).not.toMatch(/Tech Specs|TV & Home|Accessories|Apple Vision Pro|Find a Store|Order Status|Shop the Latest|Apple Trade In|Canada \(English\)|Canada \(Français\)|Other country or region/i);
  });

  it("rejects concatenated site catalog labels extracted from content specs", () => {
    const presentation = buildProductVideoPresentation(cleanInput({
      provider: "web/default",
      productUrl: "https://www.apple.com/shop/product/MXK53AM/A/magic-mouse-usb-c-white-multi-touch-surface",
      metadata: {},
      sourceRecord: productRecord({
        provider: "web/default",
        url: "https://www.apple.com/shop/product/MXK53AM/A/magic-mouse-usb-c-white-multi-touch-surface",
        content: [
          "Type Multi-Touch Mouse.",
          "Maximum DPI 1300.",
          "Connectivity USB-C.",
          "Features Accessories Mac iPad iPhone Watch.",
          "Features Multi-Touch surface."
        ].join(" ")
      })
    }));
    const finalText = generatedCopyAndFeatures(presentation);

    expect(presentation.presentationReadiness.status).toBe("pass");
    expect(presentation.presentationReadiness.reasonCodes).toContain("site_chrome_rejected");
    expect(presentation.rejectedCandidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ reasonCode: "site_chrome_rejected", source: "source_content" })
    ]));
    expect(finalText).toContain("Multi-Touch surface.");
    expect(finalText).not.toMatch(/Accessories Mac iPad iPhone Watch/i);
  });

  it("does not promote eBay product-section headings as feature claims", () => {
    const presentation = buildProductVideoPresentation(cleanInput({
      provider: "shopping/ebay",
      productUrl: "https://www.ebay.com/itm/127791799394",
      metadata: {},
      sourceRecord: productRecord({
        provider: "shopping/ebay",
        url: "https://www.ebay.com/itm/127791799394",
        content: [
          "Connectivity Wireless Color White Model Logitech MX Master 3S Brand Logitech",
          "Type Standard Mouse Charger Included No MPN 910-006570 Country of Origin China",
          "UPC 0097855174802 Maximum DPI 8000 Features Rechargeable Tracking Method Optical Number of Buttons 7",
          "Category breadcrumb Electronics Computers/Tablets & Networking",
          "About this product Product Identifiers Brand Logitech MPN 910-006570",
          "Product Key Features Color White Tracking Method Optical Number of Buttons 7 Connectivity Wireless Maximum DPI 8000 Features Rechargeable Type Standard Mouse",
          "Additional Product Features Manufacturer Color Pale Gray",
          "Item description from the seller About this seller"
        ].join(" ")
      })
    }));
    const finalText = generatedCopyAndFeatures(presentation);

    expect(presentation.presentationReadiness.status).toBe("pass");
    expect(finalText).toContain("Wireless connectivity supports a cleaner setup.");
    expect(finalText).toContain("8000 DPI tracking supports everyday pointer control.");
    expect(finalText).toContain("Rechargeable.");
    expect(finalText).not.toMatch(/Additional Product|Product Key Features|Color White|Manufacturer|Category breadcrumb|About this seller/i);
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
    expect(presentation.copy).toContain(`${DEFAULT_TEST_TITLE_FALLBACK} presentation highlights verified product details`);
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

  it("normalizes malformed feature delimiters before generating public copy", () => {
    const presentation = buildProductVideoPresentation(cleanInput({
      metadata: {
        specs: {
          type: "Accessory Kit",
          maximum_dpi: "1200",
          connectivity: "USB-C",
          features: ["USB-C adapters and, SD cards"]
        }
      }
    }));
    const finalText = generatedCopyAndFeatures(presentation);

    expect(finalText).toContain("USB-C adapters and SD cards.");
    expect(finalText).not.toContain("and and");
  });

  it("preserves coordinated feature clauses while normalizing feature lists", () => {
    const presentation = buildProductVideoPresentation(cleanInput({
      metadata: {
        specs: {
          type: "Audio Accessory",
          maximum_dpi: "1200",
          connectivity: "Bluetooth",
          features: [
            "Durable metal construction and a 16mm capsule reduce vibrations and focus on mouth sounds, rejecting fan noise",
            "With Active Noise Cancellation and water-resistant features, these earbuds keep playback focused",
            "Style, functionality, and convenience"
          ]
        }
      }
    }));
    const finalText = generatedCopyAndFeatures(presentation);

    expect(finalText).toContain("Durable metal construction and a 16mm capsule reduce vibrations");
    expect(finalText).toContain("With Active Noise Cancellation and water-resistant features, these earbuds keep playback focused.");
    expect(finalText).toContain("Style, functionality and convenience.");
    expect(finalText).not.toContain("Durable metal construction, a 16mm capsule");
    expect(finalText).not.toContain("Active Noise Cancellation, water-resistant features");
  });

  it("preserves terminal punctuation and recognizes dense colonless raw fragments", () => {
    const presentation = buildProductVideoPresentation(cleanInput({
      metadata: {
        specs: {
          type: "Accessory Kit",
          maximum_dpi: "1200",
          connectivity: "USB-C",
          features: ["Quiet control."]
        }
      },
      featureCandidates: ["Brand Aurora Type Mouse Features Quiet grip"]
    }));
    const finalText = generatedCopyAndFeatures(presentation);

    expect(presentation.presentationReadiness.reasonCodes).toContain("raw_fragment_rejected");
    expect(finalText).toContain("Quiet control.");
    expect(finalText).not.toContain("Quiet control..");
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

  it("does not promote label-prefixed metadata feature fragments over clean typed content specs", () => {
    const presentation = buildProductVideoPresentation(cleanInput({
      metadata: {
        features: [
          "Type: Modular desk dock",
          "Connectivity: USB-C hub and 15W wireless charging support compact workspaces",
          "Features: Magnetic cable rail keeps desks uncluttered",
          "Maximum DPI: 1600"
        ]
      },
      sourceRecord: productRecord({
        content: "Type: Modular desk dock. Connectivity: USB-C hub and 15W wireless charging support compact workspaces. Features: Magnetic cable rail keeps desks uncluttered. Maximum DPI: 1600."
      })
    }));
    const finalText = generatedCopyAndFeatures(presentation);

    expect(presentation.presentationReadiness.status).toBe("pass");
    expect(presentation.promotedClaims.map((claim) => claim.specKey)).toEqual(expect.arrayContaining([
      "type",
      "connectivity",
      "features",
      "maximum_dpi"
    ]));
    expect(finalText).toContain("Modular desk dock design gives the product a clear presentation category.");
    expect(finalText).toContain("USB-C hub and 15W wireless charging support compact workspaces connectivity supports a cleaner setup.");
    expect(finalText).toContain("Magnetic cable rail keeps desks uncluttered.");
    expect(finalText).not.toMatch(/Type:|Connectivity:|Features:|Maximum DPI:/);
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
      "aurora trackball mouse brand aurora labs",
      "type vertical trackball mouse",
      "maximum dpi 1600",
      "connectivity wireless",
      "features thumb rest."
    ].join(" ");
    const presentation = buildProductVideoPresentation(cleanInput({
      metadata: {
        specs: {
          type: "Vertical Trackball Mouse",
          maximum_dpi: "1600",
          connectivity: "Wireless",
          features: [rawFeatureFragment, "Compact shell", "Quiet buttons"]
        },
        features: [rawFeatureFragment]
      },
      sourceRecord: productRecord({
        attributes: {
          specs: {
            features: rawFeatureFragment
          }
        }
      }),
      featureCandidates: [rawFeatureFragment]
    }));
    const finalText = generatedCopyAndFeatures(presentation);

    expect(presentation.presentationReadiness.status).toBe("pass");
    expect(presentation.presentationReadiness.reasonCodes).toContain("raw_fragment_rejected");
    expect(presentation.rejectedCandidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ reasonCode: "raw_fragment_rejected", source: "metadata_feature" }),
      expect.objectContaining({ reasonCode: "raw_fragment_rejected", source: "source_attribute" }),
      expect.objectContaining({ reasonCode: "raw_fragment_rejected", source: "feature_candidate" })
    ]));
    expect(finalText).toMatch(/Vertical Trackball Mouse design/i);
    expect(finalText).toMatch(/1600 DPI tracking/i);
    expect(finalText).toMatch(/Wireless connectivity/i);
    expect(finalText).not.toMatch(/brand aurora labs/i);
    expect(finalText).not.toMatch(/features thumb rest/i);
  });

  it("does not use raw spec-shaped titles as presentation titles", () => {
    const rawTitle = "Brand Aurora Labs Type Vertical Trackball Mouse Maximum DPI 1600 Connectivity Wireless Features Thumb rest";
    const presentation = buildProductVideoPresentation(cleanInput({
      title: rawTitle,
      productUrl: "https://example.test/noisy-product",
      sourceRecord: productRecord({
        title: rawTitle
      })
    }));

    expect(presentation.title).toBe(DEFAULT_TEST_TITLE_FALLBACK);
    expect(presentation.presentationReadiness.status).toBe("partial");
    expect(presentation.presentationReadiness.reasonCodes).toContain("title_fallback_used");
    expect(presentation.candidateSummaries[0]?.title).toBeUndefined();
    expect(generatedCopyAndFeatures(presentation)).not.toMatch(/Brand Aurora Labs Type/i);
  });

  it("rejects label-only and non-supported section-heading public text", () => {
    const presentation = buildProductVideoPresentation(cleanInput({
      title: "Product Key Features",
      sourceRecord: productRecord({
        title: "Manufacturer",
        attributes: {
          specs: {
            features: "Product Key Features"
          }
        }
      }),
      metadata: {
        specs: {
          type: "Type",
          maximum_dpi: "1600",
          connectivity: "Wireless",
          features: ["Features", "Manufacturer"]
        }
      },
      featureCandidates: ["Color White"]
    }));
    const finalText = generatedCopyAndFeatures(presentation);

    expect(presentation.title).toBe(DEFAULT_TEST_TITLE_FALLBACK);
    expect(presentation.presentationReadiness.status).toBe("partial");
    expect(presentation.presentationReadiness.reasonCodes).toEqual(expect.arrayContaining([
      "raw_fragment_rejected",
      "title_fallback_used"
    ]));
    expect(finalText).not.toMatch(/Product Key Features/i);
    expect(finalText).not.toMatch(/Manufacturer/i);
    expect(finalText).not.toMatch(/Color White/i);
    expect(presentation.candidateSummaries[0]?.title).toBeUndefined();
  });

  it("strips own-label prefixes before promoting supported spec values", () => {
    const presentation = buildProductVideoPresentation(cleanInput({
      metadata: {
        specs: {
          type: "Type Standard Mouse",
          maximum_dpi: "Maximum DPI 8000",
          connectivity: "Connectivity Wireless",
          features: "Features Rechargeable"
        }
      }
    }));
    const finalText = generatedCopyAndFeatures(presentation);

    expect(presentation.presentationReadiness.status).toBe("pass");
    expect(finalText).toMatch(/Standard Mouse design/i);
    expect(finalText).toMatch(/8000 DPI tracking/i);
    expect(finalText).toMatch(/Wireless connectivity/i);
    expect(finalText).toMatch(/Rechargeable\./i);
    expect(finalText).not.toMatch(/Type Standard Mouse/i);
    expect(finalText).not.toMatch(/Maximum DPI 8000/i);
    expect(finalText).not.toMatch(/Connectivity Wireless/i);
    expect(finalText).not.toMatch(/Features Rechargeable/i);
  });

  it("omits raw spec-shaped brand text from public presentation output", () => {
    const rawBrand = "Aurora Labs Type Vertical Trackball Mouse Maximum DPI 1600";
    const presentation = buildProductVideoPresentation(cleanInput({ brand: rawBrand }));

    expect(presentation.brand).toBeUndefined();
    expect(renderedPresentationText(presentation)).not.toMatch(/Aurora Labs Type Vertical/i);
  });

  it("omits unsafe candidate summary titles from readiness metadata", () => {
    const presentation = buildProductVideoPresentation(cleanInput({
      candidateSummaries: [{
        recordId: "dirty-record",
        provider: "shopping/ebay",
        title: "Buy It Now seller checkout title",
        cleanSpecCount: 0,
        rejectedCandidateCount: 2
      }, {
        recordId: "clean-record",
        provider: "shopping/amazon",
        title: "Clean Mouse Candidate",
        cleanSpecCount: 4,
        rejectedCandidateCount: 0
      }, {
        cleanSpecCount: 2,
        rejectedCandidateCount: 1
      }]
    }));
    const serializedSummaries = JSON.stringify(presentation.candidateSummaries);
    const dirtySummary = presentation.candidateSummaries.find((summary) => summary.recordId === "dirty-record");
    const cleanSummary = presentation.candidateSummaries.find((summary) => summary.recordId === "clean-record");
    const anonymousSummary = presentation.candidateSummaries.find((summary) => (
      summary.cleanSpecCount === 2 && summary.rejectedCandidateCount === 1
    ));

    expect(serializedSummaries).not.toMatch(/Buy It Now/i);
    expect(dirtySummary?.title).toBeUndefined();
    expect(cleanSummary?.title).toBe("Clean Mouse Candidate");
    expect(anonymousSummary).toEqual({
      cleanSpecCount: 2,
      rejectedCandidateCount: 1
    });
  });

  it("evaluates direct final-leak facts and renders empty reason-code summaries", () => {
    const leakReadiness = evaluateProductVideoPresentationReadiness({
      includeCopy: true,
      promotedClaimCount: 3,
      promotedSpecKeyCount: 2,
      visualAssetCount: 1,
      marketplaceRejectedCount: 0,
      siteChromeRejectedCount: 0,
      unsupportedRejectedCount: 0,
      rawFragmentRejectedCount: 0,
      finalMarketplaceLeakCount: 1,
      finalSiteChromeLeakCount: 0,
      finalUnsupportedClaimLeakCount: 0,
      finalRawFragmentLeakCount: 0,
      selectedRecordChanged: false,
      titleFallbackUsed: false
    });
    const rawLeakReadiness = evaluateProductVideoPresentationReadiness({
      includeCopy: true,
      promotedClaimCount: 3,
      promotedSpecKeyCount: 2,
      visualAssetCount: 1,
      marketplaceRejectedCount: 0,
      siteChromeRejectedCount: 0,
      unsupportedRejectedCount: 0,
      rawFragmentRejectedCount: 0,
      finalMarketplaceLeakCount: 0,
      finalSiteChromeLeakCount: 0,
      finalUnsupportedClaimLeakCount: 1,
      finalRawFragmentLeakCount: 1,
      selectedRecordChanged: false,
      titleFallbackUsed: false
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
    expect(rawLeakReadiness.status).toBe("fail");
    expect(rawLeakReadiness.reasonCodes).toEqual(expect.arrayContaining([
      "unsupported_claim_rejected",
      "raw_fragment_rejected",
      "copy_generation_blocked"
    ]));
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
