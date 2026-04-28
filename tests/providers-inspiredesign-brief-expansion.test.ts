import { afterEach, describe, expect, it, vi } from "vitest";

const briefExpansionModulePath = "../src/inspiredesign/brief-expansion";
const briefTemplatePath = "../skills/opendevbrowser-design-agent/assets/templates/inspiredesign-advanced-brief.v1.json";

const loadBriefExpansion = async () => import(briefExpansionModulePath);

afterEach(() => {
  vi.resetModules();
  vi.doUnmock(briefTemplatePath);
});

describe("inspiredesign brief expansion", () => {
  it("maps dashboard briefs to the dashboard prompt format and route defaults", async () => {
    const { expandInspiredesignBrief } = await loadBriefExpansion();
    const result = expandInspiredesignBrief("Design a dashboard for operators managing internal analytics.");

    expect(result.templateVersion).toBe("inspiredesign-advanced-brief.v1");
    expect(result.format.id).toBe("b2b-dashboard-app-shell");
    expect(result.format.route).toEqual({
      profile: "ops-control",
      themeStrategy: "single-theme",
      navigationModel: "sidebar",
      layoutApproach: "workspace-shell"
    });
    expect(result.advancedBrief).toContain("Selected prompt format: B2B dashboard or app shell");
    expect(result.advancedBrief).toContain("Route defaults:");
    expect(result.advancedBrief).toContain("profile: ops-control");
  });

  it("selects the members-club concierge format for premium access briefs", async () => {
    const { expandInspiredesignBrief } = await loadBriefExpansion();
    const result = expandInspiredesignBrief("Create a concierge experience for an invite-only members club.");

    expect(result.format.id).toBe("members-club-concierge");
    expect(result.format.businessFocus).toContain("membership programs");
    expect(result.format.motionGrammar).toContain("subtle reveal");
    expect(result.advancedBrief).toContain("Anti-patterns:");
    expect(result.advancedBrief).toContain("No coupon language.");
  });

  it("routes fashion design studio briefs away from the generic creative-tool studio format", async () => {
    const { expandInspiredesignBrief } = await loadBriefExpansion();
    const result = expandInspiredesignBrief("Create a modern premium fashion design studio landing page.");

    expect(result.format.id).toBe("maison-campaign-world");
    expect(result.format.businessFocus).toContain("fashion design studios");
    expect(result.advancedBrief).toContain("Selected prompt format: Maison campaign world");
    expect(result.advancedBrief).not.toContain("creative software");
  });

  it("does not route negative dashboard wording to a dashboard or app shell", async () => {
    const { expandInspiredesignBrief } = await loadBriefExpansion();
    const result = expandInspiredesignBrief(
      "Create a premium public church landing page from a Hillsong-style homepage reference. This is not a dashboard, not an app shell, and not an internal analytics tool."
    );

    expect(result.format.id).not.toBe("b2b-dashboard-app-shell");
    expect(result.format.route.profile).not.toBe("ops-control");
    expect(result.format.route.navigationModel).not.toBe("sidebar");
    expect(result.advancedBrief).toContain("Selected prompt format: Premium editorial landing page");
    expect(result.advancedBrief).not.toContain("Selected prompt format: B2B dashboard or app shell");
  });

  it("routes public AI consulting landing briefs away from research atlas documentation", async () => {
    const { expandInspiredesignBrief } = await loadBriefExpansion();
    const result = expandInspiredesignBrief(
      "Create a premium public BCG-style AI consulting landing page for enterprise AI advisory services, transformation, client proof, case studies, and a clear CTA."
    );

    expect(result.format.id).toBe("premium-editorial-landing-page");
    expect(result.format.id).not.toBe("luminous-research-atlas");
    expect(result.format.route.profile).toBe("product-story");
    expect(result.format.route.navigationModel).toBe("global-header");
  });

  it("removes negated dashboard phrases with modifiers before scoring", async () => {
    const { expandInspiredesignBrief } = await loadBriefExpansion();
    const result = expandInspiredesignBrief(
      "Create a public church website for a global congregation. Not a SaaS dashboard, not a dashboard or internal analytics tool, and not a data-heavy operator workspace."
    );

    expect(result.format.id).not.toBe("b2b-dashboard-app-shell");
    expect(result.format.route.profile).not.toBe("ops-control");
    expect(result.format.route.navigationModel).not.toBe("sidebar");
  });

  it("still routes positive SaaS dashboard briefs to the dashboard format", async () => {
    const { expandInspiredesignBrief } = await loadBriefExpansion();
    const result = expandInspiredesignBrief(
      "Design a SaaS dashboard for internal analytics teams managing operator workflows."
    );

    expect(result.format.id).toBe("b2b-dashboard-app-shell");
    expect(result.format.route.profile).toBe("ops-control");
    expect(result.format.route.navigationModel).toBe("sidebar");
  });

  it("keeps the source brief grounded inside the expanded brief and exposes richer contract sections", async () => {
    const { expandInspiredesignBrief } = await loadBriefExpansion();
    const result = expandInspiredesignBrief("Refresh the existing product without losing its identity.");

    expect(result.format.id).toBe("existing-product-redesign");
    expect(result.advancedBrief).toContain("Source brief:");
    expect(result.advancedBrief).toContain("Refresh the existing product without losing its identity.");
    expect(result.advancedBrief).toContain("Business focus:");
    expect(result.advancedBrief).toContain("Responsive collapse rules:");
    expect(result.advancedBrief).toContain("Treat missing details as open constraints");
  });

  it("falls back to the first format when the configured default format is missing", async () => {
    vi.doMock(briefTemplatePath, () => ({
      default: {
        version: "test-template",
        defaultFormatId: "missing-format",
        commonRules: ["Keep the layout disciplined."],
        outputRequirements: ["Return a reusable system."],
        formats: [
          {
            id: "fallback-format",
            label: "Fallback format",
            bestFor: ["landing pages"],
            businessFocus: ["marketing"],
            keywords: ["landing"],
            matchSignals: {
              positive: ["landing"]
            },
            lead: "Build a premium landing page system.",
            archetype: "fallback archetype",
            layoutArchetype: "fallback layout",
            typographySystem: "fallback type",
            surfaceTreatment: "fallback surface",
            shapeLanguage: "fallback shape",
            componentGrammar: "fallback components",
            motionGrammar: "fallback motion",
            paletteIntent: "fallback palette",
            visualDensity: "airy",
            designVariance: "balanced",
            focusAreas: ["Hierarchy"],
            responsiveCollapseRules: ["Collapse to one lane."],
            guardrails: ["Keep the first viewport focused."],
            antiPatterns: ["No noise."],
            deliverables: ["Design direction"],
            route: {
              profile: "product-story",
              themeStrategy: "single-theme",
              navigationModel: "global-header",
              layoutApproach: "fallback-layout"
            }
          }
        ]
      }
    }));

    const { expandInspiredesignBrief } = await loadBriefExpansion();
    const result = expandInspiredesignBrief("Design a landing page for a new product.");

    expect(result.templateVersion).toBe("test-template");
    expect(result.format.id).toBe("fallback-format");
    expect(result.advancedBrief).toContain("Selected prompt format: Fallback format");
  });

  it("throws when the template does not define any formats", async () => {
    vi.doMock(briefTemplatePath, () => ({
      default: {
        version: "test-template",
        defaultFormatId: "missing-format",
        commonRules: [],
        outputRequirements: [],
        formats: []
      }
    }));

    const { expandInspiredesignBrief } = await loadBriefExpansion();

    expect(() => expandInspiredesignBrief("Design anything.")).toThrow(
      "Inspiredesign brief template must define at least one format."
    );
  });
});
