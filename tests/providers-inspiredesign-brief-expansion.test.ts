import { afterEach, describe, expect, it, vi } from "vitest";

const briefExpansionModulePath = "../src/inspiredesign/brief-expansion";
const briefTemplatePath = "../skills/opendevbrowser-design-agent/assets/templates/inspiredesign-advanced-brief.v1.json";

const loadBriefExpansion = async () => import(briefExpansionModulePath);

afterEach(() => {
  vi.resetModules();
  vi.doUnmock(briefTemplatePath);
});

describe("inspiredesign brief expansion", () => {
  it("maps dashboard briefs to the dashboard prompt format", async () => {
    const { expandInspiredesignBrief } = await loadBriefExpansion();
    const result = expandInspiredesignBrief("Design a dashboard for operators managing internal analytics.");

    expect(result.templateVersion).toBe("inspiredesign-advanced-brief.v1");
    expect(result.format.id).toBe("b2b-dashboard-app-shell");
    expect(result.advancedBrief).toContain("Selected prompt format: B2B dashboard or app shell");
    expect(result.advancedBrief).toContain("information hierarchy");
    expect(result.advancedBrief).toContain("Execution rules:");
  });

  it("keeps the source brief grounded inside the expanded brief", async () => {
    const { expandInspiredesignBrief } = await loadBriefExpansion();
    const result = expandInspiredesignBrief("Refresh the existing product without losing its identity.");

    expect(result.format.id).toBe("existing-product-redesign");
    expect(result.advancedBrief).toContain("Source brief:");
    expect(result.advancedBrief).toContain("Refresh the existing product without losing its identity.");
    expect(result.advancedBrief).toContain("Treat missing details as open constraints");
  });

  it("retains markdown section breaks in the expanded brief", async () => {
    const { expandInspiredesignBrief } = await loadBriefExpansion();
    const result = expandInspiredesignBrief("Design a premium consumer landing page.");

    expect(result.advancedBrief).toContain(
      "Selected prompt format: Premium editorial landing page\n\nSource brief:\nDesign a premium consumer landing page.\n\nPrompt objective:"
    );
    expect(result.advancedBrief).toContain("\n\nFocus areas:\n- hero composition");
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
            matchKeywords: ["landing"],
            lead: "Build a premium landing page system.",
            focusAreas: ["Hierarchy"],
            guardrails: ["Keep the first viewport focused."],
            deliverables: ["Design direction"]
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
