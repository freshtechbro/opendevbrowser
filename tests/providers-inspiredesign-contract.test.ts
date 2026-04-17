import { describe, expect, it } from "vitest";
import type { JsonValue } from "../src/providers/types";
import {
  buildInspiredesignPacket,
  type InspiredesignReferenceEvidence
} from "../src/providers/inspiredesign-contract";
import { renderInspiredesign } from "../src/providers/renderer";

type InspiredesignEvidenceJson = {
  brief: string;
  briefHash: string;
  urls: string[];
  referenceCount: number;
  references: Array<{
    id: string;
    url: string;
    title?: string;
    excerpt?: string;
    fetchStatus: string;
    captureStatus: string;
    fetchFailure?: string;
    captureFailure?: string;
    capture: JsonValue;
  }>;
};

const makeReference = (
  overrides: Partial<InspiredesignReferenceEvidence> = {}
): InspiredesignReferenceEvidence => ({
  id: "ref-1",
  url: "https://example.com/ref-1",
  fetchStatus: "captured",
  captureStatus: "off",
  ...overrides
});

describe("inspiredesign packet + renderer", () => {
  it("builds an auth-focused dark packet without live references", () => {
    const packet = buildInspiredesignPacket({
      brief: "  Design a dark login experience for enterprise onboarding teams. Keep the flow calm and premium.  ",
      urls: [" https://example.com/login "],
      references: []
    });

    expect(packet.generationPlan.visualDirection.profile).toBe("auth-focused");
    expect(packet.generationPlan.visualDirection.themeStrategy).toBe("light-dark-parity");
    expect(packet.prototypeGuidanceMarkdown).toBeNull();
    expect(packet.designMarkdown).toContain("No live inspiration source was provided. The system is derived entirely from the brief.");
    expect(packet.implementationPlan.risksAndAmbiguities[0]).toContain("No live references were supplied");
  });

  it("builds a reference-rich packet with trimmed evidence, failures, and prototype guidance", () => {
    const packet = buildInspiredesignPacket({
      brief: "  Design a documentation hub that feels premium but remains implementation-aware.  ",
      urls: [
        " https://example.com/docs ",
        "https://example.com/docs",
        "https://example.com/cards"
      ],
      includePrototypeGuidance: true,
      references: [
        makeReference({
          id: "docs-home",
          url: "https://example.com/docs",
          title: "  Docs Home  ",
          excerpt: "  Rich product documentation with deep navigation and strong hero clarity.  ",
          captureStatus: "captured",
          capture: {
            title: "Docs Home",
            snapshot: {
              content: "Hero, sidebar navigation, feature cards",
              refCount: 9,
              warnings: ["network idle timeout"]
            },
            dom: {
              outerHTML: "<main>docs</main>",
              truncated: false
            },
            clone: {
              componentPreview: "<section>Docs hero</section>",
              cssPreview: ".docs-hero { display: grid; }",
              warnings: []
            }
          }
        }),
        makeReference({
          id: "cards",
          url: "https://example.com/cards",
          excerpt: "  Quiet editorial cards with generous whitespace and strong CTA focus.  ",
          fetchStatus: "captured",
          captureStatus: "off"
        }),
        makeReference({
          id: "notes-only",
          url: "https://example.com/notes",
          fetchStatus: "skipped",
          captureStatus: "failed",
          fetchFailure: "Manual notes only",
          captureFailure: "Browser capture unavailable"
        })
      ]
    });

    const evidence = packet.evidence as InspiredesignEvidenceJson;

    expect(packet.prototypeGuidanceMarkdown).toContain("# 6. Optional Prototype Plan");
    expect(packet.designContract.intent.referenceCount).toBe(3);
    expect(evidence.urls).toEqual([
      "https://example.com/docs",
      "https://example.com/cards"
    ]);
    expect(evidence.referenceCount).toBe(3);
    expect(evidence.references[0]).toMatchObject({
      id: "docs-home",
      title: "Docs Home",
      excerpt: "Rich product documentation with deep navigation and strong hero clarity.",
      fetchStatus: "captured",
      captureStatus: "captured",
      capture: expect.objectContaining({
        title: "Docs Home",
        snapshot: expect.any(Object),
        dom: expect.any(Object),
        clone: expect.any(Object)
      })
    });
    expect(evidence.references[2]).toMatchObject({
      fetchStatus: "skipped",
      captureStatus: "failed",
      fetchFailure: "Manual notes only",
      captureFailure: "Browser capture unavailable"
    });
    expect(packet.designMarkdown).toContain("### Source 1: Docs Home");
    expect(packet.designMarkdown).toContain("Capture warnings: network idle timeout");
    expect(packet.designMarkdown).toContain("Only operator brief context was available for this reference.");
    expect(packet.designMarkdown).toContain("Prototype guidance Markdown for the first HTML pass");
  });

  it("renders inspiredesign output across every supported mode", () => {
    const brief = "Design a premium product narrative landing page";
    const urls = ["https://example.com/product"];
    const packet = buildInspiredesignPacket({
      brief,
      urls,
      includePrototypeGuidance: true,
      references: [
        makeReference({
          id: "product-ref",
          url: "https://example.com/product",
          title: "Product reference",
          excerpt: "Hero-first product storytelling with tight proof sections.",
          captureStatus: "captured",
          capture: {
            snapshot: {
              content: "Hero, CTA, proof strip",
              refCount: 6,
              warnings: []
            },
            clone: {
              componentPreview: "<section>Hero</section>",
              cssPreview: ".hero { display: grid; }",
              warnings: []
            }
          }
        })
      ]
    });

    const modes = ["compact", "json", "md", "context", "path"] as const;
    for (const mode of modes) {
      const rendered = renderInspiredesign({
        mode,
        brief,
        urls,
        designContract: packet.designContract,
        generationPlan: packet.generationPlan,
        implementationPlan: packet.implementationPlan,
        designMarkdown: packet.designMarkdown,
        implementationPlanMarkdown: packet.implementationPlanMarkdown,
        prototypeGuidanceMarkdown: packet.prototypeGuidanceMarkdown,
        evidence: packet.evidence,
        meta: { requestId: "req-1" }
      });

      expect(rendered.files.some((file) => file.path === "design.md")).toBe(true);
      expect(rendered.files.some((file) => file.path === "prototype-guidance.md")).toBe(true);

      if (mode === "compact") {
        expect(rendered.response).toMatchObject({
          mode,
          summary: expect.stringContaining("Brief: Design a premium product narrative landing page")
        });
      } else if (mode === "json") {
        expect(rendered.response).toMatchObject({
          mode,
          brief,
          urls,
          prototypeGuidanceMarkdown: packet.prototypeGuidanceMarkdown
        });
      } else if (mode === "md") {
        expect(rendered.response).toMatchObject({
          mode,
          markdown: packet.designMarkdown,
          implementationPlanMarkdown: packet.implementationPlanMarkdown,
          prototypeGuidanceMarkdown: packet.prototypeGuidanceMarkdown
        });
      } else if (mode === "context") {
        expect(rendered.response).toMatchObject({
          mode,
          context: expect.objectContaining({
            brief,
            urls,
            designContract: packet.designContract,
            evidence: packet.evidence
          })
        });
      } else {
        expect(rendered.response).toMatchObject({
          mode: "path",
          meta: { requestId: "req-1" }
        });
      }
    }
  });

  it("omits the prototype guidance file when the packet does not include it", () => {
    const brief = "Design a product detail page";
    const packet = buildInspiredesignPacket({
      brief,
      urls: ["https://example.com/detail"],
      references: [
        makeReference({
          id: "detail-ref",
          url: "https://example.com/detail",
          title: "Detail reference"
        })
      ]
    });

    const rendered = renderInspiredesign({
      mode: "json",
      brief,
      urls: ["https://example.com/detail"],
      designContract: packet.designContract,
      generationPlan: packet.generationPlan,
      implementationPlan: packet.implementationPlan,
      designMarkdown: packet.designMarkdown,
      implementationPlanMarkdown: packet.implementationPlanMarkdown,
      prototypeGuidanceMarkdown: packet.prototypeGuidanceMarkdown,
      evidence: packet.evidence,
      meta: {}
    });

    expect(packet.generationPlan.visualDirection.profile).toBe("documentation");
    expect(rendered.files.some((file) => file.path === "prototype-guidance.md")).toBe(false);
    expect(rendered.response).toMatchObject({
      mode: "json",
      prototypeGuidanceMarkdown: null
    });
  });

  it("handles sparse capture evidence, empty task summaries, and truncated excerpts", () => {
    const longExcerpt = "Quiet editorial cards with disciplined spacing and strong CTA focus. ".repeat(6).trim();
    const expectedExcerpt = `${longExcerpt.slice(0, 217).trimEnd()}...`;
    const packet = buildInspiredesignPacket({
      brief: "   ",
      urls: ["https://example.com/minimal"],
      references: [
        makeReference({
          id: "minimal-capture",
          url: "https://example.com/minimal",
          title: "Minimal capture",
          excerpt: longExcerpt,
          captureStatus: "captured",
          capture: {
            title: "Captured title only"
          }
        })
      ]
    });

    const evidence = packet.evidence as InspiredesignEvidenceJson;
    const capture = evidence.references[0]?.capture as Record<string, unknown>;

    expect(packet.designContract.intent.task).toBe("");
    expect(packet.designMarkdown).toContain("- Purpose: ");
    expect(packet.designMarkdown).toContain(`layout and hierarchy observations: ${expectedExcerpt}`);
    expect(packet.designMarkdown).not.toContain("Capture warnings:");
    expect(capture).toEqual({
      title: "Captured title only"
    });
    expect("snapshot" in capture).toBe(false);
    expect("clone" in capture).toBe(false);
  });
});
